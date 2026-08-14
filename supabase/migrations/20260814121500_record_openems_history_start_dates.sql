alter table public.meter_sources
  add column if not exists openems_history_start_date date;

update public.meter_sources
set openems_history_start_date = date '2026-08-13',
    updated_at = now()
where source_type = 'openems'
  and openems_edge_id = 'sezibwa-rentals-gw-pi2'
  and meter_id in (
    '200326019807', '200326019929', '200326020101',
    '200326020128', '200326020199', '200326020209',
    '221123297561', '250902040216', '250902040373'
  );
