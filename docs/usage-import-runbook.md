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
USAGE_IMPORT_ALLOWED_METERS=100,2,3,6,9,10
```

For host-side Docker runs, also set:

```bash
USAGE_IMPORT_HOST_DIR="/Users/atushabe/NearlyFreeEnergy/Sezibwa Rentals/Customer_data"
USAGE_IMPORT_SYNC_STABILITY_MINUTES=15
USAGE_IMPORT_STATE_DIR="$HOME/Library/Application Support/nfe-usage-import"
USAGE_IMPORT_ALERT_EMAIL_TO="aaron.tushabe@nearlyfreeenergy.com"
USAGE_IMPORT_SMTP_HOST=...
USAGE_IMPORT_SMTP_PORT=465
USAGE_IMPORT_SMTP_SECURE=true
USAGE_IMPORT_SMTP_USER=...
USAGE_IMPORT_SMTP_PASSWORD=...
USAGE_IMPORT_SMTP_FROM=...
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

Current behavior on this laptop:

- run at `6:30 AM` local time
- run again when the LaunchAgent loads after boot/login
- skip if a successful import has already completed that calendar day
- keep the import mount read-only
- keep `USAGE_IMPORT_REPROCESS_DAYS=3` so corrected or late files are reprocessed
- keep `USAGE_IMPORT_ALLOWED_METERS=100,2,3,6,9,10`
- require the newest eligible CSV file to be at least `15 minutes` old
- use `USAGE_IMPORT_FORCE_FULL_SYNC=true` only for explicit backfills
- on this laptop, the `launchd` job calls `scripts/run-scheduled-usage-import.sh`

Log files:

- `~/Library/Logs/nfe-usage-import.log`
- `~/Library/Logs/nfe-usage-import.error.log`
- per-run logs under `~/Library/Application Support/nfe-usage-import/runs/`

State files:

- lock directory: `~/Library/Application Support/nfe-usage-import/import.lock`
- last success marker: `~/Library/Application Support/nfe-usage-import/last-success-date.txt`

Manual scheduled-wrapper test:

```bash
./scripts/run-scheduled-usage-import.sh
```

The wrapper will fail fast if:

- Docker Desktop is not running
- `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing
- the import folder is missing or unreadable
- no eligible CSV files are found for meters `100,2,3,6,9,10`
- the newest eligible CSV file is too recent and sync may still be in progress

Failure alerts:

- failure emails go to `aaron.tushabe@nearlyfreeenergy.com`
- the alert uses the configured SMTP settings
- the email includes the failure reason, import path, and recent log output
- successful imports also send an email to `aaron.tushabe@nearlyfreeenergy.com`
- duplicate on-load skips stay quiet; they do not send email

## Import rules

- CSV files must contain `timestamp`, `meter_id`, and `energy_total`
- each file must contain readings for exactly one `meter_id`
- date bucketing comes from each row's `timestamp`
- daily kWh is calculated as `last(energy_total) - first(energy_total)` for that date bucket
- if a day has fewer than two readings or produces a negative delta, no daily snapshot is written for that day

## Recovery

Because v1 stores only daily totals in Supabase, recomputation depends on the original CSV files still being present and unchanged in Nextcloud. For a full rebuild, rerun the importer against the historical folder with `USAGE_IMPORT_FORCE_FULL_SYNC=true`.

If the laptop crashes mid-run and leaves the lock behind, clear it manually:

```bash
rm -rf "$HOME/Library/Application Support/nfe-usage-import/import.lock"
```
