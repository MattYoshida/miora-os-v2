-- MIORA OS ads manager (2026-10-27): Meta snapshot, alerts and approval-gated proposals. Admin-only RLS like every table.
-- The app never calls Meta. Mac jobs in ~/example/jobs/ops/ write these tables with the service role:
--   meta_snapshot.py (hourly)      -> meta_entities
--   alerts.py (hourly)             -> ops_alerts
--   verdicts.py / fatigue.py       -> ops_proposals (status 'proposed')
--   execute_approved.py (10 min)   -> executes only proposals the admin approved in /ops (pause, archive, budget); never activates.

-- One row per Meta object (account, campaign, ad set, ad), as of the last snapshot. Money in dollars.
create table if not exists public.meta_entities (
  id text primary key,                       -- Meta id (account: act_…)
  level text not null check (level in ('account','campaign','adset','ad')),
  parent_id text,                            -- ad -> ad set, ad set -> campaign, campaign -> account
  campaign_id text,
  name text,
  status text,                               -- configured status (ACTIVE / PAUSED / ARCHIVED …)
  effective_status text,
  daily_budget numeric,                      -- dollars; null when the level has none
  lifetime_budget numeric,
  spend_today numeric not null default 0,
  impressions_today integer not null default 0,
  spend_day date,                            -- the account-timezone day spend_today belongs to
  issues jsonb not null default '[]'::jsonb, -- issues_info
  review_feedback jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,  -- account: spend_cap, amount_spent, currency, account_status …
  active_since timestamptz,                  -- first snapshot that saw it delivering (effective ACTIVE)
  last_spend_at timestamptz,                 -- last snapshot whose spend_today went up
  meta_created_time timestamptz,
  meta_updated_time timestamptz,
  missing_since timestamptz,                 -- no longer returned by Meta (archived/deleted); row kept
  updated_at timestamptz not null default now()
);
create index if not exists meta_entities_parent on public.meta_entities (parent_id);
create index if not exists meta_entities_level on public.meta_entities (level);

-- Alerts: one row per condition (key), open while the condition holds, resolved when it clears. Never deleted.
create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                  -- e.g. rejected:<ad id>, spend_spike:<day>, cap:80
  kind text not null,                        -- rejected | issues | spend_spike | spend_cap | no_delivery | account | stale_snapshot
  severity text not null default 'warn' check (severity in ('info','warn','bad')),
  entity_id text, entity_level text,
  title text not null, detail text,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz
);
create index if not exists ops_alerts_status on public.ops_alerts (status, last_seen desc);

-- Proposals: the only path to a Meta write. the admin's Approve tap in /ops is his yes for that one action.
-- 'activate' exists so a job can suggest switching something on, but nothing ever executes it (the admin does it in Ads Manager).
-- 'refresh' = queue new creative variants (no Meta write).
create table if not exists public.ops_proposals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pause','archive','budget','refresh','activate')),
  entity_id text not null,
  entity_level text check (entity_level in ('account','campaign','adset','ad')),
  entity_name text,
  from_value text,                           -- pause/archive: current status; budget: current daily budget (dollars)
  to_value text,                             -- pause: PAUSED; archive: ARCHIVED; budget: new daily budget (dollars)
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  source text,                               -- which job proposed it
  status text not null default 'proposed'
    check (status in ('proposed','approved','rejected','executed','failed','skipped')),
  approved_by text, approved_at timestamptz, -- set by the /ops server action (approve or reject)
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ops_proposals_status on public.ops_proposals (status, created_at desc);
create index if not exists ops_proposals_entity on public.ops_proposals (entity_id, kind);
-- one open (proposed or approved) proposal per entity + kind
create unique index if not exists ops_proposals_one_open on public.ops_proposals (entity_id, kind)
  where status in ('proposed','approved');

-- What was approved is what runs: a proposal's action can't be edited after it is created, and a decision can't be
-- reversed once executed. Status may only move proposed -> approved|rejected -> executed|failed|skipped
-- (approved -> rejected lets the admin cancel before the job runs; proposed -> skipped lets a job retire a stale one).
create or replace function public.ops_proposals_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.kind is distinct from old.kind or new.entity_id is distinct from old.entity_id
     or new.from_value is distinct from old.from_value or new.to_value is distinct from old.to_value then
    raise exception 'ops_proposals: the action of a proposal cannot be changed; create a new one';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'proposed' and new.status in ('approved','rejected','skipped'))
    or (old.status = 'approved' and new.status in ('rejected','executed','failed','skipped'))
  ) then
    raise exception 'ops_proposals: status % -> % is not allowed', old.status, new.status;
  end if;
  if new.status = 'approved' and (new.approved_by is null or new.approved_at is null) then
    raise exception 'ops_proposals: approval needs approved_by and approved_at';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ops_proposals_guard on public.ops_proposals;
create trigger ops_proposals_guard before update on public.ops_proposals for each row execute function public.ops_proposals_guard();

do $$ declare t text; begin
  foreach t in array array['meta_entities','ops_alerts','ops_proposals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists miora_admins_all on public.%I', t);
    execute format('create policy miora_admins_all on public.%I for all to authenticated using (public.is_miora_admin()) with check (public.is_miora_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;
