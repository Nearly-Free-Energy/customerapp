create table if not exists public.customer_utility_account_access (
  customer_profile_id uuid not null references public.customer_profiles(id) on delete cascade,
  utility_account_id uuid not null references public.utility_accounts(id) on delete cascade,
  access_role text not null default 'viewer',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_profile_id, utility_account_id)
);

create index if not exists idx_customer_utility_account_access_profile
on public.customer_utility_account_access(customer_profile_id);

create index if not exists idx_customer_utility_account_access_account
on public.customer_utility_account_access(utility_account_id);

alter table public.customer_utility_account_access enable row level security;

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

revoke all on function public.customer_can_access_utility_account(uuid) from public;
grant execute on function public.customer_can_access_utility_account(uuid) to authenticated;

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
