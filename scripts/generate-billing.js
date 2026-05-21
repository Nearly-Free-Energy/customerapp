/**
 * Generate MBE billing line items from two boundary billing snapshots.
 *
 * Usage:
 *   node scripts/generate-billing.js <start-date> <end-date>
 *   node scripts/generate-billing.js 2026-05-01 2026-06-01
 *
 * Required env vars:
 *   MBE_API_URL              Base URL of the MBE deployment (no trailing slash)
 *   MBE_INTERNAL_API_KEY     Shared secret — must match INTERNAL_API_KEY in MBE Vercel env
 *   BILLING_METER_MAP        Path to billing-meter-map.json (defaults to config/billing-meter-map.json)
 *   BILLING_SNAPSHOTS_DIR    Path to billing-snapshots folder
 *                            (defaults to USAGE_IMPORT_HOST_DIR/billing-snapshots)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const [startDate, endDate] = process.argv.slice(2);

  if (!startDate || !DATE_RE.test(startDate) || !endDate || !DATE_RE.test(endDate)) {
    console.error('Usage: node scripts/generate-billing.js <start-date> <end-date>');
    console.error('Example: node scripts/generate-billing.js 2026-05-01 2026-06-01');
    process.exitCode = 1;
    return;
  }

  if (startDate >= endDate) {
    console.error(`end-date (${endDate}) must be after start-date (${startDate}).`);
    process.exitCode = 1;
    return;
  }

  const mbeUrl = process.env.MBE_API_URL?.replace(/\/$/, '');
  if (!mbeUrl) {
    console.error('MBE_API_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.MBE_INTERNAL_API_KEY;
  if (!apiKey || apiKey.length < 32) {
    console.error('MBE_INTERNAL_API_KEY is not set or is shorter than 32 characters.');
    process.exitCode = 1;
    return;
  }

  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.join(scriptDir, '..');

  const mapPath =
    process.env.BILLING_METER_MAP ||
    path.join(repoRoot, 'config', 'billing-meter-map.json');

  let meterMap;
  try {
    meterMap = JSON.parse(await readFile(mapPath, 'utf8'));
  } catch {
    console.error(`Cannot read meter map at ${mapPath}.`);
    console.error('Copy config/billing-meter-map.example.json to config/billing-meter-map.json and fill in the UUIDs.');
    process.exitCode = 1;
    return;
  }

  if (!meterMap.microgridId || typeof meterMap.microgridId !== 'string') {
    console.error(`billing-meter-map.json is missing microgridId.`);
    process.exitCode = 1;
    return;
  }

  if (!meterMap.meters || typeof meterMap.meters !== 'object') {
    console.error(`billing-meter-map.json is missing meters object.`);
    process.exitCode = 1;
    return;
  }

  const snapshotsDir =
    process.env.BILLING_SNAPSHOTS_DIR ||
    path.join(process.env.USAGE_IMPORT_HOST_DIR || '', 'billing-snapshots');

  if (!snapshotsDir || snapshotsDir === 'billing-snapshots') {
    console.error('Cannot determine snapshots directory. Set BILLING_SNAPSHOTS_DIR or USAGE_IMPORT_HOST_DIR.');
    process.exitCode = 1;
    return;
  }

  const startSnapshotPath = path.join(snapshotsDir, `billing-snapshot-${startDate}.json`);
  const endSnapshotPath = path.join(snapshotsDir, `billing-snapshot-${endDate}.json`);

  let startSnapshot, endSnapshot;
  try {
    startSnapshot = JSON.parse(await readFile(startSnapshotPath, 'utf8'));
  } catch {
    console.error(`Cannot read start snapshot: ${startSnapshotPath}`);
    console.error('Run backfill_billing_snapshot.py if the snapshot predates the logger update (2026-05-20).');
    process.exitCode = 1;
    return;
  }

  try {
    endSnapshot = JSON.parse(await readFile(endSnapshotPath, 'utf8'));
  } catch {
    console.error(`Cannot read end snapshot: ${endSnapshotPath}`);
    console.error('The Pi writes this file at midnight on the 1st of each month. Check Nextcloud sync.');
    process.exitCode = 1;
    return;
  }

  console.log(`Start snapshot: ${startSnapshotPath} (marker: ${startSnapshot.backfilled ? 'backfilled' : 'live'})`);
  console.log(`End snapshot:   ${endSnapshotPath} (marker: ${endSnapshot.backfilled ? 'backfilled' : 'live'})`);

  const manualReadings = [];
  const skipped = [];

  for (const [meterId, householdId] of Object.entries(meterMap.meters)) {
    const startReading = startSnapshot.meters?.[meterId];
    const endReading = endSnapshot.meters?.[meterId];

    if (!startReading) {
      skipped.push({ meterId, reason: `missing from start snapshot (${startDate})` });
      continue;
    }
    if (!endReading) {
      skipped.push({ meterId, reason: `missing from end snapshot (${endDate})` });
      continue;
    }

    const startKwh = startReading.energy_total_kWh;
    const endKwh = endReading.energy_total_kWh;

    if (endKwh < startKwh) {
      skipped.push({ meterId, reason: `end kWh (${endKwh}) is less than start kWh (${startKwh}) — meter may have been reset` });
      continue;
    }

    manualReadings.push({ householdId, startKwh, endKwh });
  }

  if (skipped.length > 0) {
    console.log('\nSkipped meters:');
    for (const s of skipped) {
      console.log(`  meter ${s.meterId}: ${s.reason}`);
    }
  }

  if (manualReadings.length === 0) {
    console.error('\nNo valid readings to submit. Aborting.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nSubmitting ${manualReadings.length} reading(s) to MBE...`);

  // Step 1: create billing period
  const periodRes = await fetch(`${mbeUrl}/api/internal/billing-periods`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      microgrid_id: meterMap.microgridId,
      start_date: startDate,
      end_date: endDate,
    }),
  });

  if (!periodRes.ok) {
    const body = await periodRes.json().catch(() => ({}));
    console.error(`\nFailed to create billing period: ${periodRes.status} ${JSON.stringify(body)}`);
    process.exitCode = 1;
    return;
  }

  const { id: billingPeriodId } = await periodRes.json();
  console.log(`Billing period created: ${billingPeriodId}`);

  // Step 2: generate line items
  const genRes = await fetch(`${mbeUrl}/api/internal/billing/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ billingPeriodId, manualReadings }),
  });

  const genBody = await genRes.json().catch(() => ({}));

  if (!genRes.ok) {
    console.error(`\nFailed to generate billing: ${genRes.status} ${JSON.stringify(genBody)}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        message: 'Billing generation completed.',
        billingPeriodId,
        startDate,
        endDate,
        lineItems: genBody.lineItems,
        errors: genBody.errors,
      },
      null,
      2,
    ),
  );

  if (genBody.errors?.length > 0) {
    console.error(`\n${genBody.errors.length} household(s) failed to generate. Review errors above.`);
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
