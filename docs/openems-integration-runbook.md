# OpenEMS Integration Runbook

## Architecture

The Hetzner OpenEMS Backend remains the source of truth for meter readings. Vercel functions import daily energy into `usage_daily_snapshots`, and the customer portal reads the authorized snapshots from Supabase.

## Required configuration

Apply `supabase/migrations/20260805111153_add_openems_ingestion.sql`, then configure these values in both the Vercel Preview and Production environments:

```bash
OPENEMS_BASE_URL=https://openems.example.com/
OPENEMS_USERNAME=...
OPENEMS_PASSWORD=...
OPENEMS_SYNC_SECRET=...
OPENEMS_TIMEOUT_MS=20000
```

Use the Backend-to-Backend REST base URL. The worker appends `/jsonrpc` unless it is already present. Keep every value server-side; none should use the `VITE_` prefix.

For local discovery and backfills, put the same OpenEMS variables together with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the ignored `env.txt` file. The OpenEMS commands load that file automatically.

## Discover meter 200326019945

The OpenEMS Backend-to-Backend API does not enumerate Edge IDs. Obtain the Edge ID from the OpenEMS configuration or deployment metadata, then run:

```bash
npm run openems:discover -- --meter-id 200326019945 --edge-id EDGE_ID
```

Discovery reads the Edge configuration, probes cumulative import-energy channels over the latest 30 days, verifies that the selected channel reports non-negative Wh values, and saves an unambiguous mapping. If several candidates have equal confidence, no mapping is written. Select the verified channel explicitly:

```bash
npm run openems:discover -- \
  --meter-id 200326019945 \
  --edge-id EDGE_ID \
  --channel _sum/GridBuyActiveEnergy
```

Review the printed sample values against OpenEMS before continuing.

## Validate and backfill

Run a limited backfill first and compare its daily totals with OpenEMS:

```bash
npm run openems:backfill -- --meter-id 200326019945 --from 2026-08-01 --to 2026-08-05
```

After validation, use the meter commissioning date to import all available history. The command processes bounded calendar-month requests and prints progress after every range:

```bash
npm run openems:backfill -- --meter-id 200326019945 --from YYYY-MM-DD
```

## Hourly Supabase Cron

Do not enable the schedule until discovery and the full backfill have been verified.

1. In Supabase Vault, create `openems_sync_url` containing the production URL ending in `/api/internal/openems-sync`.
2. Create `openems_sync_secret` containing the same value as Vercel's `OPENEMS_SYNC_SECRET`.
3. Enable the Cron and `pg_net` integrations in the Supabase Dashboard.
4. Create an hourly SQL job named `openems-hourly-sync` with the following command:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'openems_sync_url'),
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret from vault.decrypted_secrets where name = 'openems_sync_secret'
    )
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
);
```

Set the schedule to `0 * * * *`. Monitor the first runs in Supabase Cron history and the Vercel function logs. The endpoint returns per-meter success, error, and updated-day counts.

## Operational behavior

- Scheduled runs import today plus the preceding three Kampala calendar days.
- The current day is stored with `is_partial = true`.
- Null periods do not overwrite existing snapshots.
- Invalid or negative readings fail that meter and are recorded in `meter_sources.last_error`.
- A failing meter does not stop other mapped meters.
- Portal-triggered synchronization is authorized against the selected service and has a short best-effort cooldown.
