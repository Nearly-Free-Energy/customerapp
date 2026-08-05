alter table public.meter_sources
  add column if not exists openems_edge_id text,
  add column if not exists openems_energy_channel text;

alter table public.usage_daily_snapshots
  add column if not exists is_partial boolean not null default false,
  add column if not exists synced_at timestamptz;

update public.meter_sources
set source_type = 'openems',
    updated_at = now()
where lower(source_type) = 'openems';

create index if not exists idx_meter_sources_openems_active
  on public.meter_sources(source_type, status)
  where source_type = 'openems' and status = 'active';
