import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createServerSupabaseClient } from './supabase-admin.js';

const REQUIRED_COLUMNS = ['timestamp', 'meter_id'];
const ENERGY_TOTAL_COLUMNS = ['energy_total', 'energy_total_kWh'];

export function resolveUsageImportConfig(env = process.env) {
  const importDirectory = env.USAGE_IMPORT_DIR || '/data/import';
  const timezoneDefault = env.USAGE_IMPORT_TZ || 'UTC';
  const reprocessDays = clampInteger(env.USAGE_IMPORT_REPROCESS_DAYS, 3);
  const forceFullSync = env.USAGE_IMPORT_FORCE_FULL_SYNC === 'true';

  return {
    importDirectory,
    timezoneDefault,
    reprocessDays,
    forceFullSync,
  };
}

export async function importUsageFromEnv(client = createServerSupabaseClient(), env = process.env) {
  return importUsageDirectory(resolveUsageImportConfig(env), client);
}

export async function importUsageDirectory(config, client = createServerSupabaseClient()) {
  const meterSources = await loadActiveMeterSources(client, config.timezoneDefault);
  const importRecords = await loadUsageImportFileRecords(client);
  const csvFiles = await listCsvFiles(config.importDirectory);
  const filesToProcess = await selectFilesToProcess(csvFiles, importRecords, config);

  const readingBuckets = new Map();
  const fileResults = [];

  for (const filePath of filesToProcess) {
    const fileStat = await stat(filePath);

    try {
      const csvContent = await readFile(filePath, 'utf8');
      const records = parseUsageCsv(csvContent);
      const meterId = extractSingleMeterId(records);
      const meterSource = meterSources.get(meterId);

      if (!meterSource) {
        fileResults.push(
          buildFileResult({
            filePath,
            fileStat,
            meterSourceId: null,
            importStatus: 'error',
            rowCount: records.length,
            errorMessage: `No active meter_sources mapping found for meter_id "${meterId}".`,
          }),
        );
        continue;
      }

      addRecordsToBuckets(readingBuckets, meterSource, records, filePath);
      fileResults.push(
        buildFileResult({
          filePath,
          fileStat,
          meterSourceId: meterSource.id,
          importStatus: 'success',
          rowCount: records.length,
          errorMessage: null,
        }),
      );
    } catch (error) {
      fileResults.push(
        buildFileResult({
          filePath,
          fileStat,
          meterSourceId: null,
          importStatus: 'error',
          rowCount: 0,
          errorMessage: error instanceof Error ? error.message : 'Unknown import error.',
        }),
      );
    }
  }

  const dailySnapshots = buildDailyUsageSnapshots(readingBuckets);
  await upsertDailySnapshots(dailySnapshots, client);
  await upsertUsageImportFileResults(fileResults, client);
  await updateMeterSourceImportMetadata(fileResults, client);

  return {
    importDirectory: config.importDirectory,
    scannedFiles: csvFiles.length,
    processedFiles: filesToProcess.length,
    skippedFiles: csvFiles.length - filesToProcess.length,
    updatedDays: dailySnapshots.length,
    successCount: fileResults.filter((result) => result.importStatus === 'success').length,
    errorCount: fileResults.filter((result) => result.importStatus === 'error').length,
    files: fileResults,
  };
}

export function parseUsageCsv(csvContent) {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one reading row.');
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.includes(column)) {
      throw new Error(`CSV is missing required column "${column}".`);
    }
  }
  const energyTotalColumn = ENERGY_TOTAL_COLUMNS.find((column) => headers.includes(column));
  if (!energyTotalColumn) {
    throw new Error(`CSV is missing required energy total column. Expected one of: ${ENERGY_TOTAL_COLUMNS.join(', ')}.`);
  }

  const timestampIndex = headers.indexOf('timestamp');
  const meterIdIndex = headers.indexOf('meter_id');
  const energyTotalIndex = headers.indexOf(energyTotalColumn);

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const timestamp = (values[timestampIndex] ?? '').trim();
    const meterId = (values[meterIdIndex] ?? '').trim();
    const energyTotal = Number.parseFloat((values[energyTotalIndex] ?? '').trim());

    if (!isValidTimestamp(timestamp)) {
      throw new Error(`Row ${index + 2} has an invalid timestamp value.`);
    }

    if (!meterId) {
      throw new Error(`Row ${index + 2} is missing meter_id.`);
    }

    if (!Number.isFinite(energyTotal)) {
      throw new Error(`Row ${index + 2} has an invalid ${energyTotalColumn} value.`);
    }

    return {
      timestamp,
      meterId,
      energyTotal,
    };
  });
}

export function buildDailyUsageSnapshots(readingBuckets) {
  const snapshots = [];

  for (const bucket of readingBuckets.values()) {
    const readings = [...bucket.readings].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    if (readings.length < 2) {
      continue;
    }

    const firstReading = readings[0];
    const lastReading = readings[readings.length - 1];
    const usageValue = lastReading.energyTotal - firstReading.energyTotal;

    if (!Number.isFinite(usageValue) || usageValue < 0) {
      continue;
    }

    snapshots.push({
      utility_service_id: bucket.utilityServiceId,
      usage_date: bucket.usageDate,
      usage_kwh: roundToThree(usageValue),
      source: 'nextcloud-import',
    });
  }

  return snapshots.sort((left, right) => {
    if (left.utility_service_id === right.utility_service_id) {
      return left.usage_date.localeCompare(right.usage_date);
    }

    return left.utility_service_id.localeCompare(right.utility_service_id);
  });
}

function addRecordsToBuckets(readingBuckets, meterSource, records, filePath) {
  for (const record of records) {
    const usageDate = record.timestamp.slice(0, 10);
    const bucketKey = `${meterSource.utilityServiceId}:${usageDate}`;
    const bucket =
      readingBuckets.get(bucketKey) ??
      {
        utilityServiceId: meterSource.utilityServiceId,
        usageDate,
        readings: [],
      };

    bucket.readings.push({
      timestamp: record.timestamp,
      energyTotal: record.energyTotal,
      filePath,
    });
    readingBuckets.set(bucketKey, bucket);
  }
}

async function loadActiveMeterSources(client, timezoneDefault) {
  const { data, error } = await client
    .from('meter_sources')
    .select('id, utility_service_id, meter_id, source_type, meter_name, timezone, status')
    .eq('status', 'active');

  if (error) {
    throw new Error(`Unable to load meter sources: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((row) => [
      row.meter_id,
      {
        id: row.id,
        utilityServiceId: row.utility_service_id,
        meterId: row.meter_id,
        sourceType: row.source_type,
        meterName: row.meter_name,
        timezone: row.timezone || timezoneDefault,
        status: row.status,
      },
    ]),
  );
}

async function loadUsageImportFileRecords(client) {
  const { data, error } = await client
    .from('usage_import_files')
    .select('file_path, source_modified_at, import_status');

  if (error) {
    throw new Error(`Unable to load usage import file records: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((row) => [
      row.file_path,
      {
        sourceModifiedAt: row.source_modified_at ? new Date(row.source_modified_at).getTime() : null,
        importStatus: row.import_status,
      },
    ]),
  );
}

async function selectFilesToProcess(csvFiles, importRecords, config) {
  if (config.forceFullSync) {
    return csvFiles;
  }

  const cutoffTime = Date.now() - config.reprocessDays * 24 * 60 * 60 * 1000;
  const selectedFiles = [];

  for (const filePath of csvFiles) {
    const fileStat = await stat(filePath);
    const knownRecord = importRecords.get(filePath);

    const shouldProcess =
      !knownRecord ||
      knownRecord.importStatus !== 'success' ||
      knownRecord.sourceModifiedAt !== fileStat.mtime.getTime() ||
      fileStat.mtime.getTime() >= cutoffTime;

    if (shouldProcess) {
      selectedFiles.push(filePath);
    }
  }

  return selectedFiles;
}

async function listCsvFiles(rootDirectory) {
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDirectory, entry.name);
      if (entry.isDirectory()) {
        return listCsvFiles(fullPath);
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
        return [fullPath];
      }
      return [];
    }),
  );

  return paths.flat().sort((left, right) => left.localeCompare(right));
}

async function upsertDailySnapshots(snapshots, client) {
  if (snapshots.length === 0) {
    return;
  }

  const { error } = await client
    .from('usage_daily_snapshots')
    .upsert(snapshots, { onConflict: 'utility_service_id,usage_date' });

  if (error) {
    throw new Error(`Unable to upsert usage daily snapshots: ${error.message}`);
  }
}

async function upsertUsageImportFileResults(fileResults, client) {
  if (fileResults.length === 0) {
    return;
  }

  const payload = fileResults.map((result) => ({
    meter_source_id: result.meterSourceId,
    file_path: result.filePath,
    source_modified_at: result.sourceModifiedAt,
    import_status: result.importStatus,
    row_count: result.rowCount,
    imported_at: result.importedAt,
    error_message: result.errorMessage,
  }));

  const { error } = await client.from('usage_import_files').upsert(payload, { onConflict: 'file_path' });
  if (error) {
    throw new Error(`Unable to record usage import files: ${error.message}`);
  }
}

async function updateMeterSourceImportMetadata(fileResults, client) {
  const successfulResults = [...fileResults]
    .filter((result) => result.importStatus === 'success' && result.meterSourceId)
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  const latestResultByMeterSource = new Map();
  for (const result of successfulResults) {
    latestResultByMeterSource.set(result.meterSourceId, result);
  }

  for (const [meterSourceId, result] of latestResultByMeterSource.entries()) {
    const { error } = await client
      .from('meter_sources')
      .update({
        last_successful_import_at: result.importedAt,
        last_imported_file: result.filePath,
        last_error: null,
      })
      .eq('id', meterSourceId);

    if (error) {
      throw new Error(`Unable to update meter source import metadata: ${error.message}`);
    }
  }
}

function buildFileResult({ filePath, fileStat, meterSourceId, importStatus, rowCount, errorMessage }) {
  return {
    filePath,
    meterSourceId,
    importStatus,
    rowCount,
    sourceModifiedAt: fileStat.mtime.toISOString(),
    importedAt: new Date().toISOString(),
    errorMessage,
  };
}

function extractSingleMeterId(records) {
  const meterIds = [...new Set(records.map((record) => record.meterId))];
  if (meterIds.length !== 1) {
    throw new Error('CSV must contain readings for exactly one meter_id.');
  }

  return meterIds[0];
}

function parseCsvLine(line) {
  const values = [];
  let currentValue = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentValue += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(currentValue);
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  values.push(currentValue);
  return values;
}

function isValidTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
}

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}

function clampInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
