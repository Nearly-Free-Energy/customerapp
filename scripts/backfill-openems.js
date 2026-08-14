import { createOpenEmsClient } from '../server/openems-client.js';
import { buildMonthlyRanges, formatDateInTimeZone, syncOpenEmsRanges } from '../server/openems-sync.js';
import { createServerSupabaseClient } from '../server/supabase-admin.js';

const args = parseArgs(process.argv.slice(2));
const meterId = args.get('meter-id');
const fromDate = args.get('from');
const toDate = args.get('to') ?? formatDateInTimeZone(new Date(), 'Africa/Kampala');

if (!meterId || !fromDate) {
  throw new Error('Usage: npm run openems:backfill -- --meter-id <meter> --from YYYY-MM-DD [--to YYYY-MM-DD]');
}

const client = createServerSupabaseClient();
const { data: meterSource, error } = await client
  .from('meter_sources')
  .select('id, utility_service_id, meter_id, timezone, openems_edge_id, openems_energy_channel')
  .eq('meter_id', meterId)
  .eq('source_type', 'openems')
  .eq('status', 'active')
  .maybeSingle();

if (error) throw new Error(`Unable to load OpenEMS meter mapping: ${error.message}`);
if (!meterSource) throw new Error(`No active OpenEMS mapping exists for meter ${meterId}.`);

const openEmsClient = createOpenEmsClient();
const ranges = buildMonthlyRanges(fromDate, toDate);
const results = await syncOpenEmsRanges(meterSource, ranges, {
  client,
  openEmsClient,
  onResult: (result) => console.log(JSON.stringify(result)),
});

console.log(JSON.stringify({ meterId, ranges: results.length, updatedDays: results.reduce((sum, item) => sum + item.updatedDays, 0) }, null, 2));

function parseArgs(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, '');
    const value = values[index + 1];
    if (!key || !value) throw new Error(`Invalid argument near ${values[index] ?? '(end)'}.`);
    result.set(key, value);
  }
  return result;
}
