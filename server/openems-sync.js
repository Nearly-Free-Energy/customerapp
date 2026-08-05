import { createOpenEmsClient, convertEnergyToKwh, OpenEmsError } from './openems-client.js';
import { createServerSupabaseClient } from './supabase-admin.js';

const DEFAULT_TIMEZONE = 'Africa/Kampala';
const DEFAULT_OVERLAP_DAYS = 3;

export async function syncAllOpenEmsMeters(options = {}) {
  const client = options.client ?? createServerSupabaseClient();
  const openEmsClient = options.openEmsClient ?? createOpenEmsClient();
  const meterSources = await loadOpenEmsMeterSources(client);
  const results = [];

  for (const meterSource of meterSources) {
    try {
      results.push(await syncOpenEmsMeter(meterSource, { ...options, client, openEmsClient }));
    } catch (error) {
      const message = getErrorMessage(error);
      await updateMeterSourceFailure(meterSource.id, message, client);
      results.push({ meterId: meterSource.meter_id, serviceId: meterSource.utility_service_id, updatedDays: 0, error: message });
    }
  }

  return summarizeResults(results);
}

export async function syncOpenEmsService(serviceId, options = {}) {
  const client = options.client ?? createServerSupabaseClient();
  const meterSource = await loadOpenEmsMeterSourceForService(serviceId, client);
  if (!meterSource) {
    throw new OpenEmsError('This service is not configured for OpenEMS synchronization.', 'NOT_OPENEMS');
  }

  return syncOpenEmsMeter(meterSource, {
    ...options,
    client,
    openEmsClient: options.openEmsClient ?? createOpenEmsClient(),
  });
}

export async function syncOpenEmsMeter(meterSource, options = {}) {
  validateMeterSource(meterSource);
  const client = options.client ?? createServerSupabaseClient();
  const openEmsClient = options.openEmsClient ?? createOpenEmsClient();
  const now = options.now ?? new Date();
  const timezone = meterSource.timezone || DEFAULT_TIMEZONE;
  const today = formatDateInTimeZone(now, timezone);
  const fromDate = options.fromDate ?? addIsoDays(today, -(options.overlapDays ?? DEFAULT_OVERLAP_DAYS));
  const toDate = options.toDate ?? today;

  const readings = await openEmsClient.queryDailyEnergy({
    edgeId: meterSource.openems_edge_id,
    channel: meterSource.openems_energy_channel,
    fromDate,
    toDate,
    timezone,
  });

  const syncedAt = now.toISOString();
  const snapshots = readings.flatMap((reading) => {
    if (reading.value === null) return [];
    const usageKwh = convertEnergyToKwh(reading.value, 'Wh');
    return [{
      utility_service_id: meterSource.utility_service_id,
      usage_date: reading.date,
      usage_kwh: Number(usageKwh.toFixed(3)),
      source: 'openems',
      is_partial: reading.date === today,
      synced_at: syncedAt,
    }];
  });

  if (snapshots.length > 0) {
    const { error } = await client
      .from('usage_daily_snapshots')
      .upsert(snapshots, { onConflict: 'utility_service_id,usage_date' });
    if (error) throw new Error(`Unable to save OpenEMS usage snapshots: ${error.message}`);
  }

  const { error: metadataError } = await client
    .from('meter_sources')
    .update({ last_successful_import_at: syncedAt, last_error: null, updated_at: syncedAt })
    .eq('id', meterSource.id);
  if (metadataError) throw new Error(`Unable to update OpenEMS sync metadata: ${metadataError.message}`);

  return {
    meterId: meterSource.meter_id,
    serviceId: meterSource.utility_service_id,
    fromDate,
    toDate,
    updatedDays: snapshots.length,
    syncedAt,
    error: null,
  };
}

export function buildMonthlyRanges(fromDate, toDate) {
  if (fromDate > toDate) throw new Error('Backfill start date must not be after the end date.');
  const ranges = [];
  let cursor = fromDate;

  while (cursor <= toDate) {
    const [year, month] = cursor.split('-').map(Number);
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const monthEnd = addIsoDays(nextMonth, -1);
    const rangeEnd = monthEnd < toDate ? monthEnd : toDate;
    ranges.push({ fromDate: cursor, toDate: rangeEnd });
    cursor = addIsoDays(rangeEnd, 1);
  }

  return ranges;
}

export function formatDateInTimeZone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addIsoDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ISO date: ${date}.`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function loadOpenEmsMeterSources(client) {
  const { data, error } = await client
    .from('meter_sources')
    .select('id, utility_service_id, meter_id, timezone, openems_edge_id, openems_energy_channel')
    .eq('source_type', 'openems')
    .eq('status', 'active');
  if (error) throw new Error(`Unable to load OpenEMS meter mappings: ${error.message}`);
  return data ?? [];
}

async function loadOpenEmsMeterSourceForService(serviceId, client) {
  const { data, error } = await client
    .from('meter_sources')
    .select('id, utility_service_id, meter_id, timezone, openems_edge_id, openems_energy_channel')
    .eq('utility_service_id', serviceId)
    .eq('source_type', 'openems')
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`Unable to load the OpenEMS meter mapping: ${error.message}`);
  return data;
}

function validateMeterSource(meterSource) {
  if (!meterSource.openems_edge_id || !meterSource.openems_energy_channel) {
    throw new OpenEmsError(`Meter ${meterSource.meter_id} is missing its OpenEMS Edge or energy channel mapping.`, 'INVALID_MAPPING');
  }
}

async function updateMeterSourceFailure(meterSourceId, message, client) {
  await client
    .from('meter_sources')
    .update({ last_error: message, updated_at: new Date().toISOString() })
    .eq('id', meterSourceId);
}

function summarizeResults(results) {
  return {
    processedMeters: results.length,
    successCount: results.filter((result) => !result.error).length,
    errorCount: results.filter((result) => result.error).length,
    updatedDays: results.reduce((total, result) => total + result.updatedDays, 0),
    meters: results,
  };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unknown OpenEMS synchronization error.';
}
