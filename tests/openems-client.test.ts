import { describe, expect, it, vi } from 'vitest';
import {
  convertEnergyToKwh,
  createOpenEmsClient,
  findEnergyChannelCandidates,
  OpenEmsError,
  parseDailyEnergyResponse,
} from '../server/openems-client.js';

describe('OpenEMS JSON-RPC client', () => {
  it('wraps historical queries in Edge-RPC and authenticates with Basic Auth', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          payload: {
            jsonrpc: '2.0',
            id: request.params.payload.id,
            result: {
              timestamps: ['2026-08-04T21:00:00Z'],
              data: { '_sum/GridBuyActiveEnergy': [1250] },
            },
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = createOpenEmsClient(
      { baseUrl: 'https://openems.example.test', username: 'worker', password: 'secret', timeoutMs: 1000 },
      { fetchImpl },
    );

    const result = await client.queryDailyEnergy({
      edgeId: 'edge0',
      channel: '_sum/GridBuyActiveEnergy',
      fromDate: '2026-08-05',
      toDate: '2026-08-05',
      timezone: 'Africa/Kampala',
    });

    expect(result).toEqual([{ date: '2026-08-05', value: 1250 }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openems.example.test/jsonrpc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('worker:secret').toString('base64')}` }),
      }),
    );
    const sentBody = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(sentBody).toMatchObject({
      method: 'edgeRpc',
      params: {
        edgeId: 'edge0',
        payload: {
          method: 'queryHistoricTimeseriesEnergyPerPeriod',
          params: {
            timezone: 'Africa/Kampala',
            resolution: { value: 1, unit: 'DAYS' },
          },
        },
      },
    });
  });

  it('surfaces nested JSON-RPC failures', async () => {
    const client = createOpenEmsClient(
      { baseUrl: 'https://openems.example.test', username: 'worker', password: 'secret', timeoutMs: 1000 },
      { fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        result: { payload: { error: { code: 3000, message: 'Edge is not connected' } } },
      }), { status: 200 })) },
    );

    await expect(client.getEdgeConfig('edge0')).rejects.toThrow('Edge is not connected');
  });

  it('aborts requests that exceed the configured timeout', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const client = createOpenEmsClient(
      { baseUrl: 'https://openems.example.test', username: 'worker', password: 'secret', timeoutMs: 5 },
      { fetchImpl },
    );

    await expect(client.getEdgeConfig('edge0')).rejects.toThrow('OpenEMS request timed out.');
  });

  it('rejects malformed historical data and invalid energy', () => {
    expect(() => parseDailyEnergyResponse({ timestamps: [], data: {} }, 'meter0/Energy', 'Africa/Kampala')).toThrow(
      'malformed historical energy data',
    );
    expect(() => convertEnergyToKwh(-1)).toThrow(OpenEmsError);
    expect(convertEnergyToKwh(1250, 'Wh')).toBe(1.25);
    expect(convertEnergyToKwh(1.25, 'kWh')).toBe(1.25);
  });

  it('finds and ranks cumulative consumption channels', () => {
    const candidates = findEnergyChannelCandidates({
      components: {
        _sum: {
          alias: 'Site',
          channels: {
            GridBuyActiveEnergy: { unit: 'Wh', text: 'Grid buy active energy' },
            ProductionActivePower: { unit: 'W', text: 'Production power' },
          },
        },
      },
    });

    expect(candidates).toEqual([
      expect.objectContaining({ address: '_sum/GridBuyActiveEnergy', unit: 'Wh' }),
    ]);
  });

  it('probes standard Wh channels when Edge config omits channel metadata', () => {
    const candidates = findEnergyChannelCandidates({
      components: {
        '200326019945': { alias: 'Customer meter', factoryId: 'Meter.Chint.DDSU666', properties: {} },
        _sum: { alias: 'Sum', factoryId: 'Core.Sum', properties: {} },
      },
    }, '200326019945');

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '200326019945/ActiveConsumptionEnergy', unit: 'Wh' }),
      expect.objectContaining({ address: '_sum/ConsumptionActiveEnergy', unit: 'Wh' }),
    ]));
  });
});
