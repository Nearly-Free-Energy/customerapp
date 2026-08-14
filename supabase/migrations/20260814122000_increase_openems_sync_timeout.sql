do $$
declare
  openems_sync_job_id bigint;
begin
  select jobid
  into openems_sync_job_id
  from cron.job
  where jobname = 'openems-hourly-sync'
     or command like '%openems_sync_url%'
     or command like '%/api/internal/openems-sync%'
  order by (jobname = 'openems-hourly-sync') desc
  limit 1;

  if openems_sync_job_id is null then
    raise exception 'OpenEMS sync cron job not found';
  end if;

  perform cron.alter_job(
    job_id := openems_sync_job_id,
    command := $command$
      select net.http_post(
        url := coalesce(
          (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'openems_sync_url'
            limit 1
          ),
          'https://portal.nearlyfreeenergy.com/api/internal/openems-sync'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'openems_sync_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $command$
  );
end
$$;
