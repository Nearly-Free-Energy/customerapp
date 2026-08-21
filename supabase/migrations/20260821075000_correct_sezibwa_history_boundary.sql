update public.meter_sources
set openems_history_start_date = date '2026-08-14',
    updated_at = now()
where source_type = 'openems'
  and openems_edge_id = 'sezibwa-rentals-gw-pi2';

delete from public.usage_daily_snapshots as snapshot
using public.meter_sources as source
where snapshot.utility_service_id = source.utility_service_id
  and snapshot.usage_date = date '2026-08-13'
  and snapshot.source = 'openems'
  and source.source_type = 'openems'
  and source.openems_edge_id = 'sezibwa-rentals-gw-pi2';
