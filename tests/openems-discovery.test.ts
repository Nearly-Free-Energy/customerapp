import { describe, expect, it, vi } from 'vitest';
import { discoverOpenEmsMeter } from '../server/openems-discovery.js';

describe('OpenEMS discovery', () => {
  it('marks the current Kampala day as a partial range', async () => {
    const queryDailyEnergy = vi.fn(async () => [{ date: '2026-08-14', value: 100 }]);
    const updateResult = {
      eq: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: { id: 'source-1' }, error: null }),
        }),
      }),
    };
    const client = {
      from: () => ({ update: () => updateResult }),
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
        queryDailyEnergy,
      },
    });

    expect(queryDailyEnergy).toHaveBeenCalledWith(expect.objectContaining({
      toDate: '2026-08-14',
      currentDate: '2026-08-14',
    }));
  });
});
