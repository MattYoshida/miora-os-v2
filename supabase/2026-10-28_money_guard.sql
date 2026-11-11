-- MIORA cloud money guard (2026-10-28). Runs in Supabase every 10 minutes, so spend stays protected while the admin's Mac
-- (the main buyer, ~/example/jobs/ops) is asleep or off. Edge Function source: supabase/functions/money-guard/.
--
--   ops_policy        mirror of ~/example/jobs/ops/POLICY.json (the Mac syncs it: ops/policy_sync.py, run by buyer.py)
--                     + cloud-only switches (guard_enabled, guard_campaign_ids) that the sync never overwrites
--   ops_guard_state   the function's memory: Meta backoff, last good read, conditions already pushed, last run
--   ops_push_log      phone-push rate limit shared by the cloud guard and the Mac (same key at most once per 2 h)
--   cron job 'money-guard'  pg_cron + pg_net POST to the function every 10 min (key from Vault, never in this file)
--
-- Turn off: update public.ops_policy set guard_enabled = false where id = 'main';   (function still runs, reads nothing)
--   or stop the schedule: select cron.unschedule('money-guard');
-- Secrets (set outside this file, never committed): Vault money_guard_key + ntfy_topic; function secrets MONEY_GUARD_KEY,
-- META_ACCESS_TOKEN, META_APP_SECRET, NTFY_TOPIC.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.ops_policy (
  id text primary key default 'main' check (id = 'main'),
  live boolean not null default false,
  auto_approve_protective boolean not null default true,
  daily_max_usd numeric not null,
  account_cap_usd numeric not null,
  cap_guard_pct numeric not null default 0.5 check  -- EXAMPLE ratio, not a production limit (cap_guard_pct > 0 and cap_guard_pct <= 1),
  spike_x numeric not null default 3,                -- EXAMPLE: pause when today's spend > spike_x * daily_max_usd
  -- cloud-only (the Mac sync never writes these):
  guard_enabled boolean not null default true,       -- false = the function reads nothing and writes nothing
  guard_campaign_ids text[] not null default array['EXAMPLE_CAMPAIGN_TEST'],  -- campaigns it may pause; '{all}' = any delivering campaign
  account_id text not null default 'act_EXAMPLE',
  raw jsonb not null default '{}'::jsonb,            -- the whole POLICY.json as last synced
  synced_from text,
  synced_at timestamptz,
  updated_at timestamptz not null default now()
);

-- EXAMPLE seed only, not production limits (live=false, $20/day, $250 cap, 50% guard).
insert into public.ops_policy (id, live, auto_approve_protective, daily_max_usd, account_cap_usd, cap_guard_pct, synced_from, synced_at)
values ('main', false, true, 20, 250, 0.5, 'example seed', now())
on conflict (id) do nothing;

create table if not exists public.ops_guard_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.ops_guard_state (id) values ('money-guard') on conflict (id) do nothing;

create table if not exists public.ops_push_log (
  key text primary key,                              -- alert key (shared with ops_alerts keys where it is the same condition)
  last_sent_at timestamptz not null,
  sent_count integer not null default 1,
  last_title text,
  source text                                        -- 'cloud-guard' | 'mac-alerts' | 'mac-execute' | 'test'
);

do $$ declare t text; begin
  foreach t in array array['ops_policy','ops_guard_state','ops_push_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists miora_admins_all on public.%I', t);
    execute format('create policy miora_admins_all on public.%I for all to authenticated using (public.is_miora_admin()) with check (public.is_miora_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;

-- Schedule: every 10 minutes. The shared key lives in Vault (created by the setup script, not here).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'money-guard') then
    perform cron.unschedule('money-guard');
  end if;
end $$;
select cron.schedule('money-guard', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://your-project-ref.supabase.co/functions/v1/money-guard',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-guard-key', (select decrypted_secret from vault.decrypted_secrets where name = 'money_guard_key')),
    body := '{"source":"pg_cron"}'::jsonb,
    timeout_milliseconds := 55000)
$cron$);

-- Phone push from the database (pg_net). ntfy.sh's free tier limits messages per sending IP, and Edge Functions share
-- egress IPs (the shared quota was already used up on 2026-10-28), so the function sends through Postgres instead.
-- The topic is Vault secret 'ntfy_topic'. Only the service role (the function) may call these.
create or replace function public.ops_push_ntfy(p_title text, p_message text, p_priority int default 3, p_tags text[] default '{}')
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare t text; rid bigint;
begin
  select decrypted_secret into t from vault.decrypted_secrets where name = 'ntfy_topic';
  if t is null or t = '' then raise exception 'ops_push_ntfy: vault secret ntfy_topic is missing'; end if;
  select net.http_post(
    url := 'https://ntfy.sh/',
    body := jsonb_build_object('topic', t, 'title', left(p_title, 120), 'message', left(p_message, 900),
                               'priority', greatest(1, least(5, coalesce(p_priority, 3))), 'tags', to_jsonb(coalesce(p_tags, '{}')),
                               'click', 'https://app.example.com/ops'),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000) into rid;
  return rid;
end $$;

-- Delivery results of earlier pushes (pg_net keeps responses for a few hours).
create or replace function public.ops_push_results(p_ids bigint[])
returns table (id bigint, status_code int, error_msg text) language sql security definer set search_path = public, pg_temp as $$
  select r.id, r.status_code, r.error_msg from net._http_response r where r.id = any(p_ids)
$$;

revoke all on function public.ops_push_ntfy(text, text, int, text[]) from public, anon, authenticated;
revoke all on function public.ops_push_results(bigint[]) from public, anon, authenticated;
grant execute on function public.ops_push_ntfy(text, text, int, text[]) to service_role;
grant execute on function public.ops_push_results(bigint[]) to service_role;
