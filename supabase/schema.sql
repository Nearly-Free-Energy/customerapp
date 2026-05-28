create extension if not exists pgcrypto;

create table if not exists customer_profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists utility_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references customer_profiles(id) on delete cascade,
  account_number text not null unique,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_utility_account_access (
  customer_profile_id uuid not null references customer_profiles(id) on delete cascade,
  utility_account_id uuid not null references utility_accounts(id) on delete cascade,
  access_role text not null default 'viewer',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_profile_id, utility_account_id)
);

create table if not exists utility_services (
  id uuid primary key default gen_random_uuid(),
  utility_account_id uuid not null references utility_accounts(id) on delete cascade,
  service_type text not null,
  service_name text not null,
  service_address text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (utility_account_id, service_type, service_name)
);

create table if not exists microgrids (
  id uuid primary key default gen_random_uuid(),
  microgrid_code text not null unique,
  display_name text not null,
  status text not null default 'active',
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists utility_service_microgrids (
  utility_service_id uuid not null references utility_services(id) on delete cascade,
  microgrid_id uuid not null references microgrids(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (utility_service_id, microgrid_id)
);

create table if not exists gateways (
  id uuid primary key default gen_random_uuid(),
  microgrid_id uuid not null references microgrids(id) on delete cascade,
  gateway_slug text not null unique,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists field_devices (
  id uuid primary key default gen_random_uuid(),
  gateway_id uuid not null references gateways(id) on delete cascade,
  device_slug text not null,
  device_type text not null,
  vendor_model text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gateway_id, device_slug)
);

create table if not exists meter_sources (
  id uuid primary key default gen_random_uuid(),
  utility_service_id uuid not null references utility_services(id) on delete cascade,
  meter_id text not null unique,
  source_type text not null default 'nextcloud_csv',
  meter_name text,
  timezone text not null default 'UTC',
  status text not null default 'active',
  last_successful_import_at timestamptz,
  last_imported_file text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (utility_service_id)
);

create table if not exists usage_import_files (
  id uuid primary key default gen_random_uuid(),
  meter_source_id uuid references meter_sources(id) on delete set null,
  file_path text not null unique,
  source_modified_at timestamptz,
  import_status text not null default 'pending',
  row_count integer not null default 0,
  imported_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists usage_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  utility_service_id uuid not null references utility_services(id) on delete cascade,
  microgrid_id uuid references microgrids(id) on delete set null,
  usage_date date not null,
  usage_kwh numeric(12,3),
  source text not null default 'estimated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (utility_service_id, usage_date)
);

create index if not exists idx_customer_profiles_email on customer_profiles(email);
create index if not exists idx_utility_accounts_profile on utility_accounts(customer_profile_id);
create index if not exists idx_customer_utility_account_access_profile on customer_utility_account_access(customer_profile_id);
create index if not exists idx_customer_utility_account_access_account on customer_utility_account_access(utility_account_id);
create index if not exists idx_utility_services_account on utility_services(utility_account_id);
create index if not exists idx_utility_service_microgrids_service on utility_service_microgrids(utility_service_id);
create index if not exists idx_utility_service_microgrids_microgrid on utility_service_microgrids(microgrid_id);
create index if not exists idx_gateways_microgrid on gateways(microgrid_id);
create index if not exists idx_field_devices_gateway on field_devices(gateway_id);
create index if not exists idx_meter_sources_service on meter_sources(utility_service_id);
create index if not exists idx_meter_sources_status on meter_sources(status);
create index if not exists idx_usage_import_files_status on usage_import_files(import_status);
create index if not exists idx_usage_import_files_meter_source on usage_import_files(meter_source_id);
create index if not exists idx_usage_daily_snapshots_service_date on usage_daily_snapshots(utility_service_id, usage_date);

-- Supabase Data API visibility is controlled by explicit table grants.
-- RLS policies below still decide which rows authenticated users can read.
grant select on table
  public.customer_profiles,
  public.utility_accounts,
  public.customer_utility_account_access,
  public.utility_services,
  public.utility_service_microgrids,
  public.microgrids,
  public.gateways,
  public.field_devices,
  public.usage_daily_snapshots
to authenticated;

grant select, insert, update, delete on table
  public.customer_profiles,
  public.utility_accounts,
  public.customer_utility_account_access,
  public.utility_services,
  public.microgrids,
  public.utility_service_microgrids,
  public.gateways,
  public.field_devices,
  public.meter_sources,
  public.usage_import_files,
  public.usage_daily_snapshots
to service_role;

-- Lock down API access by default. This app reads and writes these tables
-- through server-side code using the service role, so RLS can stay enabled
-- until we intentionally add end-user policies.
alter table customer_profiles enable row level security;
alter table utility_accounts enable row level security;
alter table customer_utility_account_access enable row level security;
alter table utility_services enable row level security;
alter table microgrids enable row level security;
alter table utility_service_microgrids enable row level security;
alter table gateways enable row level security;
alter table field_devices enable row level security;
alter table meter_sources enable row level security;
alter table usage_import_files enable row level security;
alter table usage_daily_snapshots enable row level security;

create or replace function public.current_customer_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select cp.id
  from public.customer_profiles cp
  where cp.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and cp.status = 'active'
  limit 1
$$;

create or replace function public.customer_owns_utility_account(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.utility_accounts ua
    where ua.id = target_account_id
      and ua.customer_profile_id = public.current_customer_profile_id()
      and ua.status = 'active'
  )
$$;

create or replace function public.customer_can_access_utility_account(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.customer_owns_utility_account(target_account_id)
    or exists (
      select 1
      from public.customer_utility_account_access cua
      join public.utility_accounts ua on ua.id = cua.utility_account_id
      where cua.utility_account_id = target_account_id
        and cua.customer_profile_id = public.current_customer_profile_id()
        and cua.status = 'active'
        and ua.status = 'active'
    )
$$;

create or replace function public.customer_owns_utility_service(target_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.utility_services us
    join public.utility_accounts ua on ua.id = us.utility_account_id
    where us.id = target_service_id
      and us.status = 'active'
      and ua.status = 'active'
      and public.customer_can_access_utility_account(ua.id)
  )
$$;

create or replace function public.customer_owns_microgrid(target_microgrid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.microgrids mg
    join public.utility_service_microgrids usm on usm.microgrid_id = mg.id
    join public.utility_services us on us.id = usm.utility_service_id
    join public.utility_accounts ua on ua.id = us.utility_account_id
    where mg.id = target_microgrid_id
      and mg.status = 'active'
      and us.status = 'active'
      and ua.status = 'active'
      and public.customer_can_access_utility_account(ua.id)
  )
$$;

create or replace function public.customer_owns_gateway(target_gateway_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.gateways g
    where g.id = target_gateway_id
      and g.status = 'active'
      and public.customer_owns_microgrid(g.microgrid_id)
  )
$$;

revoke all on function public.current_customer_profile_id() from public;
revoke all on function public.customer_owns_utility_account(uuid) from public;
revoke all on function public.customer_can_access_utility_account(uuid) from public;
revoke all on function public.customer_owns_utility_service(uuid) from public;
revoke all on function public.customer_owns_microgrid(uuid) from public;
revoke all on function public.customer_owns_gateway(uuid) from public;

grant execute on function public.current_customer_profile_id() to authenticated;
grant execute on function public.customer_owns_utility_account(uuid) to authenticated;
grant execute on function public.customer_can_access_utility_account(uuid) to authenticated;
grant execute on function public.customer_owns_utility_service(uuid) to authenticated;
grant execute on function public.customer_owns_microgrid(uuid) to authenticated;
grant execute on function public.customer_owns_gateway(uuid) to authenticated;

drop policy if exists customer_profiles_self_select on public.customer_profiles;
create policy customer_profiles_self_select
on public.customer_profiles
for select
to authenticated
using (id = public.current_customer_profile_id());

drop policy if exists utility_accounts_customer_select on public.utility_accounts;
create policy utility_accounts_customer_select
on public.utility_accounts
for select
to authenticated
using (
  status = 'active'
  and public.customer_can_access_utility_account(id)
);

drop policy if exists customer_utility_account_access_customer_select on public.customer_utility_account_access;
create policy customer_utility_account_access_customer_select
on public.customer_utility_account_access
for select
to authenticated
using (
  status = 'active'
  and customer_profile_id = public.current_customer_profile_id()
);

drop policy if exists utility_services_customer_select on public.utility_services;
create policy utility_services_customer_select
on public.utility_services
for select
to authenticated
using (
  status = 'active'
  and public.customer_owns_utility_service(id)
);

drop policy if exists usage_daily_snapshots_customer_select on public.usage_daily_snapshots;
create policy usage_daily_snapshots_customer_select
on public.usage_daily_snapshots
for select
to authenticated
using (public.customer_owns_utility_service(utility_service_id));

drop policy if exists utility_service_microgrids_customer_select on public.utility_service_microgrids;
create policy utility_service_microgrids_customer_select
on public.utility_service_microgrids
for select
to authenticated
using (public.customer_owns_utility_service(utility_service_id));

drop policy if exists microgrids_customer_select on public.microgrids;
create policy microgrids_customer_select
on public.microgrids
for select
to authenticated
using (
  status = 'active'
  and public.customer_owns_microgrid(id)
);

drop policy if exists gateways_customer_select on public.gateways;
create policy gateways_customer_select
on public.gateways
for select
to authenticated
using (
  status = 'active'
  and public.customer_owns_microgrid(microgrid_id)
);

drop policy if exists field_devices_customer_select on public.field_devices;
create policy field_devices_customer_select
on public.field_devices
for select
to authenticated
using (
  status = 'active'
  and public.customer_owns_gateway(gateway_id)
);
