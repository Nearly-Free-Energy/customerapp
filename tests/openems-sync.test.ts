import { describe, expect, it, vi } from 'vitest';
import { buildMonthlyRanges, syncAllOpenEmsMeters, syncOpenEmsMeter } from '../server/openems-sync.js';
import { normalizeUsageSource } from '../server/usage-data.js';

function createWriteClient(meterSources: Array<Record<string, unknown>> = []) {
  const state = { snapshots: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>> };
  return {
    state,
    from(table: string) {
      if (table === 'usage_daily_snapshots') {
        return {
          upsert: async (rows: Array<Record<string, unknown>>) => {
            state.snapshots.push(...rows);
            return { error: null };
          },
        };
      }
      if (table === 'meter_sources') {
        return {
          select() {
            const chain = {
              eq: vi.fn().mockReturnThis(),
              then(resolve: (value: unknown) => unknown) {
                return Promise.resolve({ data: meterSources, error: null }).then(resolve);
              },
            };
            return chain;
          },
          update(payload: Record<string, unknown>) {
            return {
              eq: async (_field: string, id: string) => {
                state.updates.push({ id, ...payload });
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

const meterSource = {
  id: 'source-1',
  utility_service_id: 'service-1',
  meter_id: '200326019945',
  timezone: 'Africa/Kampala',
  openems_edge_id: 'edge0',
  openems_energy_channel: '_sum/GridBuyActiveEnergy',
};

describe('OpenEMS synchronization', () => {
  it('upserts non-null daily kWh and marks the Kampala current day partial', async () => {
    const client = createWriteClient();
    const result = await syncOpenEmsMeter(meterSource, {
      client,
      now: new Date('2026-08-05T22:00:00Z'),
      openEmsClient: {
        queryDailyEnergy: vi.fn(async () => [
          { date: '2026-08-05', value: 2500 },
          { date: '2026-08-06', value: 500 },
          { date: '2026-08-07', value: null },
        ]),
      },
    });

    expect(result.updatedDays).toBe(2);
    expect(client.state.snapshots).toEqual([
      expect.objectContaining({ usage_date: '2026-08-05', usage_kwh: 2.5, source: 'openems', is_partial: false }),
      expect.objectContaining({ usage_date: '2026-08-06', usage_kwh: 0.5, source: 'openems', is_partial: true }),
    ]);
    expect(client.state.updates).toEqual([expect.objectContaining({ id: 'source-1', last_error: null })]);
  });

  it('does not write snapshots when OpenEMS only returns missing periods', async () => {
    const client = createWriteClient();
    await syncOpenEmsMeter(meterSource, {
      client,
      openEmsClient: {
        queryDailyEnergy: vi.fn(async () => [{ date: '2026-08-05', value: null }]),
      },
    });
    expect(client.state.snapshots).toEqual([]);
  });

  it('writes current-day range energy returned by the client', async () => {
    const client = createWriteClient();
    const result = await syncOpenEmsMeter(meterSource, {
      client,
      now: new Date('2026-08-14T10:00:00Z'),
      openEmsClient: {
        queryDailyEnergy: vi.fn(async () => [{ date: '2026-08-14', value: 125 }]),
      },
    });

    expect(result.updatedDays).toBe(1);
    expect(client.state.snapshots).toEqual([
      expect.objectContaining({ usage_date: '2026-08-14', usage_kwh: 0.125, is_partial: true }),
    ]);
  });

  it('continues with other meters and records a per-meter failure', async () => {
    const secondMeter = { ...meterSource, id: 'source-2', meter_id: 'second', utility_service_id: 'service-2', openems_edge_id: 'bad-edge' };
    const client = createWriteClient([meterSource, secondMeter]);
    const result = await syncAllOpenEmsMeters({
      client,
      openEmsClient: {
        queryDailyEnergy: vi.fn(async ({ edgeId }: { edgeId: string }) => {
          if (edgeId === 'bad-edge') throw new Error('offline');
          return [{ date: '2026-08-05', value: 1000 }];
        }),
      },
      now: new Date('2026-08-05T12:00:00Z'),
    });

    expect(result).toMatchObject({ processedMeters: 2, successCount: 1, errorCount: 1, updatedDays: 1 });
    expect(client.state.updates).toContainEqual(expect.objectContaining({ id: 'source-2', last_error: 'offline' }));
  });

  it('builds bounded monthly ranges for backfills', () => {
    expect(buildMonthlyRanges('2026-01-30', '2026-03-02')).toEqual([
      { fromDate: '2026-01-30', toDate: '2026-01-31' },
      { fromDate: '2026-02-01', toDate: '2026-02-28' },
      { fromDate: '2026-03-01', toDate: '2026-03-02' },
    ]);
  });

  it('preserves OpenEMS as the public usage source', () => {
    expect(normalizeUsageSource('openems')).toBe('openems');
  });
});
