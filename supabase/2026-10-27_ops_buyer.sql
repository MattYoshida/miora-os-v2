-- MIORA OS autonomous buyer (2026-10-27, the admin: "Full, within caps"): one summary row per account day, written hourly
-- by ~/example/jobs/ops/buyer.py and shown at the top of /ops. Autonomous actions themselves are ops_proposals rows with
-- approved_by = 'policy'. Admin-only RLS like every table.
create table if not exists public.ops_daily_report (
  day date primary key,                      -- the ad account's calendar day
  summary text not null,
  stats jsonb not null default '{}'::jsonb,  -- live, daily_max_usd, armed_budget, spend_today, cap, waiting, alerts, counts
  actions jsonb not null default '[]'::jsonb,-- today's policy-approved proposals (kind, status, entity, from/to, times)
  updated_at timestamptz not null default now()
);
create index if not exists ops_proposals_policy on public.ops_proposals (approved_by, approved_at desc);

do $$ declare t text; begin
  foreach t in array array['ops_daily_report'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists miora_admins_all on public.%I', t);
    execute format('create policy miora_admins_all on public.%I for all to authenticated using (public.is_miora_admin()) with check (public.is_miora_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;

-- 2026-10-28: 'unpark' = the buyer opened a parked angle (rotation, POLICY.json, live only). Logged, not a Meta write:
-- it flips registry_docs.adset_state and requests the set's queued ads; the ad set is switched on later by an activate.
alter table public.ops_proposals drop constraint if exists ops_proposals_kind_check;
alter table public.ops_proposals add constraint ops_proposals_kind_check
  check (kind in ('pause','archive','budget','refresh','activate','unpark'));
