import { discoverOpenEmsMeter } from '../server/openems-discovery.js';

const args = parseArgs(process.argv.slice(2));
const meterId = args.get('meter-id');
const edgeIds = (args.get('edge-id') ?? process.env.OPENEMS_EDGE_IDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!meterId) {
  throw new Error('Usage: npm run openems:discover -- --meter-id <meter> --edge-id <edge> [--channel <address>]');
}

const result = await discoverOpenEmsMeter({
  meterId,
  edgeIds,
  channel: args.get('channel'),
  timezone: args.get('timezone') ?? 'Africa/Kampala',
});

console.log(JSON.stringify(result, null, 2));
if (!result.saved) {
  console.error('No unambiguous channel was saved. Re-run with --channel using one of the validated candidates.');
  process.exitCode = 2;
}

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
