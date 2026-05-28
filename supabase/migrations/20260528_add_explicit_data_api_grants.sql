-- Supabase Data API visibility is controlled by explicit table grants.
-- RLS policies still decide which rows authenticated users can read.
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
