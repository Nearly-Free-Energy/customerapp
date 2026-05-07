# Usage Import Runbook

## Purpose

Import daily electricity usage into Supabase from a Nextcloud-synced directory of per-meter CSV files.

## Environment

Set these variables before running the importer:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
USAGE_IMPORT_DIR=/data/import
USAGE_IMPORT_REPROCESS_DAYS=3
USAGE_IMPORT_FORCE_FULL_SYNC=false
```

For host-side Docker runs, also set:

```bash
USAGE_IMPORT_HOST_DIR="/Users/atushabe/NearlyFreeEnergy/Sezibwa Rentals/Customer_data/meter_100"
```

## Manual backfill / validation

1. Confirm the Nextcloud desktop client has finished syncing the meter CSV folder.
2. Ensure each electric service has a `meter_sources` row with the external `meter_id`.
3. Run the importer:

```bash
./scripts/run-usage-import-docker.sh
```

4. Review the JSON summary for:
   - `processedFiles`
   - `updatedDays`
   - `errorCount`
5. Investigate any `No active meter_sources mapping found` errors by onboarding or updating the missing meter mapping.

## Daily scheduled runs

After manual validation is stable, schedule the same Docker command on the laptop. The scheduler should run only after the Nextcloud sync window has completed.

Suggested behavior:

- run once daily
- keep the import mount read-only
- keep `USAGE_IMPORT_REPROCESS_DAYS=3` so corrected or late files are reprocessed
- use `USAGE_IMPORT_FORCE_FULL_SYNC=true` only for explicit backfills
- on this laptop, the `launchd` job can call `scripts/run-scheduled-usage-import.sh` once per day

## Import rules

- CSV files must contain `timestamp`, `meter_id`, and `energy_total`
- each file must contain readings for exactly one `meter_id`
- date bucketing comes from each row's `timestamp`
- daily kWh is calculated as `last(energy_total) - first(energy_total)` for that date bucket
- if a day has fewer than two readings or produces a negative delta, no daily snapshot is written for that day

## Recovery

Because v1 stores only daily totals in Supabase, recomputation depends on the original CSV files still being present and unchanged in Nextcloud. For a full rebuild, rerun the importer against the historical folder with `USAGE_IMPORT_FORCE_FULL_SYNC=true`.
