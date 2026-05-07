import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importUsageDirectory, parseUsageCsv } from '../server/usage-import';

function createThenableResult(result: { data: unknown; error: Error | null }) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    then(resolve: (value: { data: unknown; error: Error | null }) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };

  return builder;
}

function createImporterClient() {
  const state = {
    usageDailySnapshots: [] as Array<Record<string, unknown>>,
    usageImportFiles: [] as Array<Record<string, unknown>>,
    meterSourceUpdates: [] as Array<Record<string, unknown>>,
  };

  const meterSources = [
    {
      id: 'meter-source-1',
      utility_service_id: 'service-electric',
      meter_id: '1',
      source_type: 'nextcloud_csv',
      meter_name: 'Main Three Phase',
      timezone: 'America/Chicago',
      status: 'active',
    },
  ];

  return {
    state,
    from(table: string) {
      if (table === 'meter_sources') {
        return {
          select() {
            return createThenableResult({ data: meterSources, error: null });
          },
          update(payload: Record<string, unknown>) {
            return {
              eq: async (_field: string, value: string) => {
                state.meterSourceUpdates.push({ id: value, ...payload });
                return { error: null };
              },
            };
          },
        };
      }

      if (table === 'usage_import_files') {
        return {
          select() {
            return createThenableResult({ data: [], error: null });
          },
          upsert: async (payload: Array<Record<string, unknown>>) => {
            state.usageImportFiles = payload;
            return { error: null };
          },
        };
      }

      if (table === 'usage_daily_snapshots') {
        return {
          upsert: async (payload: Array<Record<string, unknown>>) => {
            state.usageDailySnapshots = payload;
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe('usage import helpers', () => {
  let tempDirectory: string | null = null;

  afterEach(async () => {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
      tempDirectory = null;
    }
  });

  it('parses required CSV columns and rows', () => {
    const records = parseUsageCsv(`timestamp,meter_id,energy_total\n2026-03-22 00:00:00,1,100.0\n2026-03-22 00:15:00,1,100.5\n`);
    expect(records).toEqual([
      {
        timestamp: '2026-03-22 00:00:00',
        meterId: '1',
        energyTotal: 100,
      },
      {
        timestamp: '2026-03-22 00:15:00',
        meterId: '1',
        energyTotal: 100.5,
      },
    ]);
  });

  it('parses CSV rows that use energy_total_kWh', () => {
    const records = parseUsageCsv(
      `timestamp,meter_id,energy_total_kWh\n2026-03-22 00:00:00,100,3953.83\n2026-03-22 00:15:00,100,3954.12\n`,
    );

    expect(records).toEqual([
      {
        timestamp: '2026-03-22 00:00:00',
        meterId: '100',
        energyTotal: 3953.83,
      },
      {
        timestamp: '2026-03-22 00:15:00',
        meterId: '100',
        energyTotal: 3954.12,
      },
    ]);
  });

  it('imports daily usage snapshots by timestamp date even when a file crosses midnight', async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'nfe-usage-import-'));
    const csvPath = path.join(tempDirectory, 'meter_001_2026-03-22.csv');
    await writeFile(
      csvPath,
      [
        'timestamp,meter_id,energy_total',
        '2026-03-22 23:30:00,1,100.0',
        '2026-03-22 23:45:00,1,101.2',
        '2026-03-23 00:00:00,1,101.5',
        '2026-03-23 00:15:00,1,102.0',
      ].join('\n'),
    );

    const client = createImporterClient();
    const result = await importUsageDirectory(
      {
        importDirectory: tempDirectory,
        timezoneDefault: 'America/Chicago',
        reprocessDays: 3,
        forceFullSync: true,
      },
      client as never,
    );

    expect(result.updatedDays).toBe(2);
    expect(client.state.usageDailySnapshots).toEqual([
      {
        utility_service_id: 'service-electric',
        usage_date: '2026-03-22',
        usage_kwh: 1.2,
        source: 'nextcloud-import',
      },
      {
        utility_service_id: 'service-electric',
        usage_date: '2026-03-23',
        usage_kwh: 0.5,
        source: 'nextcloud-import',
      },
    ]);
    expect(client.state.usageImportFiles).toHaveLength(1);
    expect(client.state.meterSourceUpdates).toEqual([
      expect.objectContaining({
        id: 'meter-source-1',
        last_imported_file: csvPath,
        last_error: null,
      }),
    ]);
  });

  it('records an unmapped meter as an import error without writing snapshots', async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'nfe-usage-import-'));
    const csvPath = path.join(tempDirectory, 'meter_999_2026-03-22.csv');
    await writeFile(
      csvPath,
      ['timestamp,meter_id,energy_total', '2026-03-22 00:00:00,999,5.0', '2026-03-22 00:15:00,999,5.5'].join('\n'),
    );

    const client = createImporterClient();
    const result = await importUsageDirectory(
      {
        importDirectory: tempDirectory,
        timezoneDefault: 'America/Chicago',
        reprocessDays: 3,
        forceFullSync: true,
      },
      client as never,
    );

    expect(result.errorCount).toBe(1);
    expect(client.state.usageDailySnapshots).toEqual([]);
    expect(client.state.usageImportFiles).toEqual([
      expect.objectContaining({
        file_path: csvPath,
        meter_source_id: null,
        import_status: 'error',
      }),
    ]);
  });
});
