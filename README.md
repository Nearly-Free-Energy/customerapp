# Customerapp

App for customers and microgrid managers to monitor electricity usage.

## Local development

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev
```

For auth-enabled local development, add a `.env` file with:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are used by the Vercel Function backend for server-side token verification. For now, they should match the same Supabase project as the frontend values.
`SUPABASE_SERVICE_ROLE_KEY` is required for server-side account/profile/service access and for the onboarding and import scripts.

Step 2 adds a minimal protected identity endpoint at `/api/me`. The frontend now waits for backend verification before showing the signed-in dashboard.

Step 3 adds server-side customer/account/service lookup on top of that verified identity flow. A signed-in user must be present in the Supabase customer data tables before the dashboard is shown.

Useful commands:

```bash
npm test
npm run build
npm run release:check
npm run db:migrate:customers
npm run db:onboard:customer -- --email person@example.com --profile-name "Person Example" --account-number acct-1001 --account-name "Person Example Account" --services '[{"serviceType":"electric","serviceName":"Main Electric Service","serviceAddress":"123 Main St"}]'
npm run db:import:usage
```

`npm run release:check` is the required local gate before merging work to `main`. It runs the full test suite and a production build.

For custom Supabase email delivery setup, use [docs/supabase-smtp-runbook.md](/Users/atushabe/NearlyFreeEnergy/NFE%20Web%20App/docs/supabase-smtp-runbook.md).

## Customer data model

Apply the schema in [supabase/schema.sql](/Users/atushabe/NearlyFreeEnergy/NFE%20Web%20App/supabase/schema.sql) in Supabase before running the onboarding or migration scripts.
Apply incremental updates from [supabase/migrations/20260415_add_customer_rls_policies.sql](/Users/atushabe/NearlyFreeEnergy/NFE%20Web%20App/supabase/migrations/20260415_add_customer_rls_policies.sql) when updating an existing project.

The app now expects:

- `customer_profiles`
- `utility_accounts`
- `utility_services`
- `meter_sources`
- `usage_import_files`

The `/api/me` response now returns:

- `email`
- `profile`
- `account`
- `services`

## Supabase security model

- Row Level Security is enabled on all app tables in `public`.
- Authenticated customer reads are limited to the signed-in customer's own profile, account, services, linked microgrid topology, and usage snapshots.
- Operational tables such as `meter_sources` and `usage_import_files` remain server-only and are intended to be accessed through the service role.
- The server-side Supabase helper requires `SUPABASE_SERVICE_ROLE_KEY`; it no longer falls back to the anon key for privileged data access.

## Customer migration and onboarding

### One-time migration from the repo-backed map

1. Apply [supabase/schema.sql](/Users/atushabe/NearlyFreeEnergy/NFE%20Web%20App/supabase/schema.sql) in Supabase SQL Editor.
2. Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set locally.
3. Run:

```bash
npm run db:migrate:customers
```

This imports the current records from [legacy-customer-map.js](/Users/atushabe/NearlyFreeEnergy/NFE%20Web%20App/server/legacy-customer-map.js) and creates:

- one customer profile per email
- one account per profile
- one default electric service per account

The migration is idempotent and safe to rerun.

### Onboarding a new user

1. Invite the user or let them sign in through Supabase Auth.
2. Run the onboarding command with their email and account/service data.
3. After the profile/account/services exist, the user can access the dashboard.

Example:

```bash
npm run db:onboard:customer -- \
  --email jane@example.com \
  --profile-name "Jane Example" \
  --account-number acct-2001 \
  --account-name "Jane Example Main Account" \
  --services '[{"serviceType":"electric","serviceName":"Main Electric Service","serviceAddress":"123 Main St","meterSource":{"meterId":"meter-001","sourceType":"nextcloud_csv","meterName":"Main Three Phase","timezone":"America/Chicago"}},{"serviceType":"water","serviceName":"Main Water Service","serviceAddress":"123 Main St"}]'
```

Add `--append-services` if you want to keep existing services for that account and add new ones instead of replacing them.

## Usage import from Nextcloud CSV

Real usage data is imported from a Nextcloud-synced directory on the laptop running the importer. The importer reads CSV files from a bind-mounted read-only directory, computes daily kWh deltas from cumulative `energy_total`, and upserts those totals into `usage_daily_snapshots`.

Required environment variables for import runs:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
USAGE_IMPORT_DIR=/data/import
USAGE_IMPORT_REPROCESS_DAYS=3
USAGE_IMPORT_FORCE_FULL_SYNC=false
```

For local non-Docker runs, point `USAGE_IMPORT_DIR` at the synced host directory directly. For Docker runs, mount the host directory read-only into `/data/import`.

Manual Docker run:

```bash
export USAGE_IMPORT_HOST_DIR="/absolute/path/to/Nextcloud/meters"
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
./scripts/run-usage-import-docker.sh
```

The importer image can also be run directly:

```bash
docker build -f Dockerfile.importer -t nfe-usage-importer .
docker run --rm \
  -e SUPABASE_URL \
  -e SUPABASE_SERVICE_ROLE_KEY \
  -e USAGE_IMPORT_DIR=/data/import \
  -e USAGE_IMPORT_REPROCESS_DAYS=3 \
  -v "/absolute/path/to/Nextcloud/meters:/data/import:ro" \
  nfe-usage-importer
```

Operational notes:

- original CSV files remain in Nextcloud as the recovery and recomputation source
- Supabase stores only daily totals in v1
- daily usage is computed from row timestamps, not the filename date
- the seeded demo fallback is now opt-in with `ENABLE_USAGE_DEMO_FALLBACK=true`

## Vercel deployment

This repository is set up for a trunk-based Vercel workflow:

- `main` is the only long-lived branch and the only deploy source.
- Vercel should treat this as a static Vite frontend.
- A merge to `main` should create a staged production deployment.
- That staged deployment is validated at its Vercel deployment URL first.
- Production is updated only by manually promoting the already-tested staged deployment.
- This workflow is designed to work on the Vercel Hobby plan.

### Repo-side Vercel config

The repository includes [`vercel.json`](/Users/atushabe/NearlyFreeEnergy/NFE%20Web%20App/vercel.json) to pin the expected Vercel behavior:

- framework: `vite`
- build command: `npm run build`
- output directory: `dist`

Also note:

- `.vercel/` is gitignored because it is local machine/project linkage metadata.
- The app now uses a minimal Vercel Function at `/api/me` for server-side identity verification.
- Customer identity is now mapped server-side from Supabase Postgres customer/account/service tables.

### Required Vercel project settings

Configure one Vercel project for this repo with:

- Production branch: `main`
- Production domain: your live customer-facing domain
- No dedicated preprod domain on Hobby; use the staged `.vercel.app` deployment URL as the temporary verification environment

On the Hobby plan, keep the workflow simple:

- merge to `main`
- let Vercel build the deployment
- validate the staged deployment at its generated `.vercel.app` URL
- manually promote the exact same deployment to production

Reference: [Vercel promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment)

### Hobby plan setup guide

1. Create a single Vercel project from this GitHub repository.
2. Confirm the framework is `Vite`.
3. Confirm the build command is `npm run build`.
4. Confirm the output directory is `dist`.
5. Set the Production Branch to `main`.
6. Turn off `Auto-assign Custom Production Domains` in `Settings -> Environments -> Production`.
7. Add only the live production custom domain.
8. Use the deployment URL generated by Vercel as the temporary verification environment for each release candidate.

For auth + backend verification, configure these environment variables in both Preview and Production:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Release policy

### Daily workflow

1. Pull the latest `main`.
2. Do the work locally.
3. Run `npm run release:check`.
4. Merge to `main` only if the local checks pass.

### Merge policy

- Keep merges to `main` small and self-contained.
- Avoid batching unrelated changes into a single merge.
- Treat every merge to `main` as a release candidate.

### Staged deployment policy

After the merge reaches `main`:

1. Wait for Vercel to finish the staged production deployment.
2. Open the staged `.vercel.app` deployment URL in Vercel and verify:
   - the site loads without console-breaking issues
   - the main navigation or primary user path works
   - the deployed build matches the intended change
   - there are no obvious visual regressions on desktop and mobile-width layouts
3. Confirm the live production domain still shows the previous production release.
4. If the staged deployment fails verification, do not promote. Fix locally, rerun `npm run release:check`, merge again, and validate the new staged deployment.

### Production policy

- Production promotion is always manual.
- Promote only the exact staged deployment that passed verification.
- Do not trigger a fresh rebuild for production.

### Rollback policy

If a bad release reaches production, roll back by promoting the previous known-good Vercel deployment rather than patching production directly.
