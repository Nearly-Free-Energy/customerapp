import { describe, expect, it, vi } from 'vitest';
import {
  convertEnergyToKwh,
  createOpenEmsClient,
  findEnergyChannelCandidates,
  OpenEmsError,
  parseRangeEnergyResponse,
} from '../server/openems-client.js';

describe('OpenEMS JSON-RPC client', () => {
  it('queries each Kampala day as an authenticated historical range', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          payload: {
            jsonrpc: '2.0',
            id: request.params.payload.id,
            result: { data: { '_sum/GridBuyActiveEnergy': 1250 } },
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
      currentDate: '2026-08-06',
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
          method: 'queryHistoricTimeseriesEnergy',
          params: {
            fromDate: '2026-08-05',
            toDate: '2026-08-06',
            timezone: 'Africa/Kampala',
          },
        },
      },
    });
  });

  it('returns one range result for every requested day', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const fromDate = request.params.payload.params.fromDate;
      return new Response(JSON.stringify({
        result: {
          payload: {
            result: { data: { 'meter0/Energy': fromDate === '2026-08-13' ? 120 : 30 } },
          },
        },
      }), { status: 200 });
    });
    const client = createOpenEmsClient(
      { baseUrl: 'https://openems.example.test', username: 'worker', password: 'secret', timeoutMs: 1000 },
      { fetchImpl },
    );

    await expect(client.queryDailyEnergy({
      edgeId: 'edge0',
      channel: 'meter0/Energy',
      fromDate: '2026-08-13',
      toDate: '2026-08-14',
      timezone: 'Africa/Kampala',
      currentDate: '2026-08-14',
    })).resolves.toEqual([
      { date: '2026-08-13', value: 120 },
      { date: '2026-08-14', value: 30 },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const requests = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1].body)).params.payload.params);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromDate: '2026-08-13', toDate: '2026-08-14' }),
      expect.objectContaining({ fromDate: '2026-08-14', toDate: '2026-08-14' }),
    ]));
  });

  it('skips unavailable leading days but rejects an entirely invalid range', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const fromDate = request.params.payload.params.fromDate;
      if (fromDate === '2026-08-12') return new Response('', { status: 400 });
      return new Response(JSON.stringify({
        result: { payload: { result: { data: { 'meter0/Energy': 120 } } } },
      }), { status: 200 });
    });
    const client = createOpenEmsClient(
      { baseUrl: 'https://openems.example.test', username: 'worker', password: 'secret', timeoutMs: 1000 },
      { fetchImpl },
    );

    await expect(client.queryDailyEnergy({
      edgeId: 'edge0',
      channel: 'meter0/Energy',
      fromDate: '2026-08-12',
      toDate: '2026-08-13',
      timezone: 'Africa/Kampala',
      currentDate: '2026-08-14',
    })).resolves.toEqual([
      { date: '2026-08-12', value: null },
      { date: '2026-08-13', value: 120 },
    ]);

    await expect(client.queryDailyEnergy({
      edgeId: 'edge0',
      channel: 'meter0/Energy',
      fromDate: '2026-08-12',
      toDate: '2026-08-12',
      timezone: 'Africa/Kampala',
      currentDate: '2026-08-14',
    })).rejects.toThrow('HTTP 400');
  });

  it('rejects unavailable days after history has begun', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const fromDate = request.params.payload.params.fromDate;
      if (fromDate === '2026-08-14') return new Response('', { status: 400 });
      return new Response(JSON.stringify({
        result: { payload: { result: { data: { 'meter0/Energy': 120 } } } },
      }), { status: 200 });
    });
    const client = createOpenEmsClient(
      { baseUrl: 'https://openems.example.test', username: 'worker', password: 'secret', timeoutMs: 1000 },
      { fetchImpl },
    );

    await expect(client.queryDailyEnergy({
      edgeId: 'edge0',
      channel: 'meter0/Energy',
      fromDate: '2026-08-13',
      toDate: '2026-08-14',
      timezone: 'Africa/Kampala',
      currentDate: '2026-08-14',
    })).rejects.toThrow('HTTP 400');
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

  it('queries and parses range energy for a partial day', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        result: {
          payload: {
            id: request.params.payload.id,
            result: { data: { 'meter0/ActiveConsumptionEnergy': 125 } },
          },
        },
      }), { status: 200 });
    });
    const client = createOpenEmsClient(
      { baseUrl: 'https://openems.example.test', username: 'worker', password: 'secret', timeoutMs: 1000 },
      { fetchImpl },
    );

    await expect(client.queryRangeEnergy({
      edgeId: 'edge0',
      channel: 'meter0/ActiveConsumptionEnergy',
      fromDate: '2026-08-14',
      toDate: '2026-08-14',
      timezone: 'Africa/Kampala',
    })).resolves.toBe(125);

    const sentBody = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(sentBody.params.payload.method).toBe('queryHistoricTimeseriesEnergy');
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
    expect(() => parseRangeEnergyResponse({ data: { 'meter0/Energy': 'bad' } }, 'meter0/Energy')).toThrow(
      'malformed historical range energy',
    );
    expect(parseRangeEnergyResponse({ data: { 'meter0/Energy': null } }, 'meter0/Energy')).toBeNull();
    expect(() => parseRangeEnergyResponse({ data: {} }, 'meter0/Energy')).toThrow(
      'malformed historical range energy',
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
