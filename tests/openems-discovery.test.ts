import { describe, expect, it, vi } from 'vitest';
import { discoverOpenEmsMeter } from '../server/openems-discovery.js';

describe('OpenEMS discovery', () => {
  it('recomputes the history boundary when saving a mapping', async () => {
    const queryRangeEnergy = vi.fn(async ({ fromDate }: { fromDate: string }) => (
      fromDate >= '2026-08-13' ? 100 : null
    ));
    let updatePayload: Record<string, unknown> | null = null;
    const updateResult = {
      eq: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: { id: 'source-1' }, error: null }),
        }),
      }),
    };
    const client = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload;
          return updateResult;
        },
      }),
    };

    await discoverOpenEmsMeter({
      meterId: '200326019945',
      edgeIds: ['edge0'],
      channel: 'meter0/Energy',
      timezone: 'Africa/Kampala',
    }, {
      client,
      now: new Date('2026-08-14T10:00:00Z'),
      openEmsClient: {
        getEdgeConfig: vi.fn(async () => ({
          components: { meter0: { channels: { Energy: { unit: 'Wh' } } } },
        })),
        queryRangeEnergy,
      },
    });

    expect(queryRangeEnergy).toHaveBeenCalled();
    expect(updatePayload).toEqual(expect.objectContaining({
      openems_history_start_date: '2026-08-13',
    }));
  });
});
