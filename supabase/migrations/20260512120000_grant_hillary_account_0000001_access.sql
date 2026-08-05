with profile as (
  insert into public.customer_profiles (email, display_name, status)
  values ('arinda.hillary@nearlyfreeenergy.com', 'Hillary', 'active')
  on conflict (email) do update
  set display_name = excluded.display_name,
      status = excluded.status,
      updated_at = now()
  returning id
),
account as (
  select id
  from public.utility_accounts
  where account_number = '0000001'
    and status = 'active'
)
insert into public.customer_utility_account_access (
  customer_profile_id,
  utility_account_id,
  access_role,
  status
)
select profile.id, account.id, 'viewer', 'active'
from profile
cross join account
on conflict (customer_profile_id, utility_account_id) do update
set access_role = excluded.access_role,
    status = excluded.status,
    updated_at = now();
