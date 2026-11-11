-- MIORA OS: measured pre-flight report per finished video ad (tools/qa/preflight.py, 2026-10-28).
-- One row per tracker ad (ads.id). Written by the Mac (service role) from preflight.py and the make_previews.py backlog.
-- verdict: pass | fix. complete = the Claude/Gemini parts (product truth + artifacts) ran too; false = measured parts only so far.
-- scores: {pacing, audio, format, product, artifacts, summary{overall, verdict, complete, fixes[], parts, ...}}
-- issues: [{t, at, section, check, severity fix|warn, measured, target, fix, source measured|claude|gemini|claude-frames}]
create table if not exists public.ad_preflight (
  ad_id text primary key,
  verdict text not null check (verdict in ('pass', 'fix')),
  complete boolean not null default false,
  scores jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  video text,
  made_at timestamptz not null default now()
);
create index if not exists ad_preflight_verdict on public.ad_preflight (verdict);

do $$ declare t text; begin
  foreach t in array array['ad_preflight'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists miora_admins_all on public.%I', t);
    execute format('create policy miora_admins_all on public.%I for all to authenticated using (public.is_miora_admin()) with check (public.is_miora_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;
