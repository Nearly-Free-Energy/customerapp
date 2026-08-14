do $$
declare
  updated_count integer;
begin
  with mappings(serial_number, legacy_meter_id) as (
    values
      ('200326019807', '8'),
      ('200326019929', '2'),
      ('200326020101', '3'),
      ('200326020128', '5'),
      ('200326020199', '4'),
      ('200326020209', '6'),
      ('221123297561', '100'),
      ('250902040216', '10'),
      ('250902040373', '9')
  )
  update public.meter_sources as meter_source
  set meter_id = mapping.serial_number,
      source_type = 'openems',
      openems_edge_id = 'sezibwa-rentals-gw-pi2',
      openems_energy_channel = 'meter' || mapping.serial_number || '/ActiveConsumptionEnergy',
      last_error = null,
      updated_at = now()
  from public.utility_services as utility_service,
       mappings as mapping
  where utility_service.id = meter_source.utility_service_id
    and meter_source.status = 'active'
    and meter_source.meter_id in (mapping.legacy_meter_id, mapping.serial_number)
    and right(utility_service.service_name, length(mapping.serial_number)) = mapping.serial_number;

  get diagnostics updated_count = row_count;
  if updated_count <> 9 then
    raise exception 'Expected to migrate 9 Sezibwa meter sources, migrated %', updated_count;
  end if;
end
$$;
