-- MIORA OS: the admin's "Request changes" notes from /review (2026-11-03).
-- Not raw.oversight (the ad overseer's APPROVE WITH CHANGES verdict, rewritten by oversee.py) and not raw.review
-- (approve / reject). Approve and reject do not read or write this table.
--
-- One row per request. Either pipeline can take it: handler is null until a claim, then 'grok' or 'claude'.
-- Claim is one conditional UPDATE (row lock; the loser matches 0 rows). The before-update trigger rejects any
-- other change. Service role bypasses RLS; the signed-in admin inserts from the app.
--
-- Poll (unclaimed):
--   select id, ad_id, ad_name, note, handler, created_at
--   from public.ad_revision_requests
--   where status = 'requested' and claimed_at is null and (handler is null or handler = 'grok') -- or 'claude'
--   order by created_at;
--
-- Claim (atomic; 0 rows = already taken). claimed_at is stamped by the trigger.
--   update public.ad_revision_requests
--   set status = 'in_progress', handler = 'grok', claimed_by = 'grok-bot' -- or handler 'claude', your worker id
--   where id = $1 and status = 'requested' and claimed_at is null and claimed_by is null
--     and (handler is null or handler = 'grok')
--   returning *;
--
-- Finish (only the claimer; result_note required):
--   update public.ad_revision_requests
--   set status = 'done', result_note = 're-cut, shorter hook, new file on the ad'
--   where id = $1 and status = 'in_progress' and claimed_by = 'grok-bot'
--   returning *;
--
-- supabase-js (service role), same filters:
--   const claim = await supabase.from('ad_revision_requests').update({
--     status: 'in_progress', handler: 'grok', claimed_by: 'grok-bot',
--   }).eq('id', id).eq('status', 'requested').is('claimed_at', null).is('claimed_by', null)
--     .or('handler.is.null,handler.eq.grok').select().maybeSingle();
--   if (!claim.data) { /* someone else claimed it */ }
--   const done = await supabase.from('ad_revision_requests').update({
--     status: 'done', result_note: 're-cut, shorter hook, new file on the ad',
--   }).eq('id', id).eq('status', 'in_progress').eq('claimed_by', 'grok-bot').select().maybeSingle();
--
-- Status only moves requested -> in_progress -> done. A new ask is a new row. After done, re-file the fixed ad
-- (same ads.id, status ready, new preview); the card returns to the decide queue because no open request remains.

create table if not exists public.ad_revision_requests (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,                         -- ads.id
  ad_name text not null,                       -- adName() at request time: problem_avatar_angle_concept_hook_id
  note text not null,                          -- what the admin wants changed
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'done')),
  handler text check (handler is null or handler in ('grok', 'claude')),
  claimed_by text,                             -- worker id of whoever won the claim ('grok-bot', 'claude-code', …)
  claimed_at timestamptz,                      -- set by the trigger on claim; null while unclaimed
  result_note text,                            -- required when status becomes done
  requested_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_revision_requests_note_chk check (char_length(btrim(note)) between 1 and 4000),
  constraint ad_revision_requests_shape_chk check (
       (status = 'requested' and claimed_by is null and claimed_at is null and result_note is null
          and (handler is null or handler in ('grok', 'claude')))
    or (status = 'in_progress' and handler in ('grok', 'claude') and claimed_by is not null
          and claimed_at is not null and result_note is null)
    or (status = 'done' and handler in ('grok', 'claude') and claimed_by is not null and claimed_at is not null
          and result_note is not null and char_length(btrim(result_note)) between 1 and 4000)
  )
);

create index if not exists ad_revision_requests_ad on public.ad_revision_requests (ad_id, created_at desc);
create index if not exists ad_revision_requests_open on public.ad_revision_requests (created_at)
  where status = 'requested' and claimed_at is null;

comment on table public.ad_revision_requests is
  'Review "Request changes" queue. status: requested | in_progress | done. handler: null | grok | claude. '
  'Claim with one UPDATE … WHERE status = ''requested'' AND claimed_at IS NULL AND claimed_by IS NULL '
  '(set status in_progress, handler, claimed_by). Finish with UPDATE status = done and result_note '
  'WHERE status = in_progress AND claimed_by = you. 0 rows means you lost the race. See the migration header.';

create or replace function public.ad_revision_requests_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.ad_id is distinct from old.ad_id or new.ad_name is distinct from old.ad_name
     or new.note is distinct from old.note or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at then
    raise exception 'ad_revision_requests: the request text and ad cannot be changed';
  end if;

  if old.status = 'requested' and new.status = 'in_progress' then
    if old.claimed_at is not null or old.claimed_by is not null then
      raise exception 'ad_revision_requests: already claimed';
    end if;
    if new.handler is null or new.handler not in ('grok', 'claude') then
      raise exception 'ad_revision_requests: handler must be grok or claude';
    end if;
    if old.handler is not null and new.handler is distinct from old.handler then
      raise exception 'ad_revision_requests: this request is assigned to %', old.handler;
    end if;
    if coalesce(btrim(new.claimed_by), '') = '' then
      raise exception 'ad_revision_requests: claimed_by is required';
    end if;
    new.claimed_by := btrim(new.claimed_by);
    new.claimed_at := now();
    new.result_note := null;
  elsif old.status = 'in_progress' and new.status = 'done' then
    if new.handler is distinct from old.handler or new.claimed_by is distinct from old.claimed_by
       or new.claimed_at is distinct from old.claimed_at then
      raise exception 'ad_revision_requests: the claim cannot change after it is taken';
    end if;
    if coalesce(btrim(new.result_note), '') = '' or char_length(btrim(new.result_note)) > 4000 then
      raise exception 'ad_revision_requests: result_note is required to finish (4000 characters max)';
    end if;
    new.result_note := btrim(new.result_note);
  elsif new.status is distinct from old.status or new.handler is distinct from old.handler
     or new.claimed_by is distinct from old.claimed_by or new.claimed_at is distinct from old.claimed_at
     or new.result_note is distinct from old.result_note then
    raise exception 'ad_revision_requests: status % -> % is not allowed', old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ad_revision_requests_guard on public.ad_revision_requests;
create trigger ad_revision_requests_guard
  before update on public.ad_revision_requests
  for each row execute function public.ad_revision_requests_guard();

alter table public.ad_revision_requests enable row level security;
drop policy if exists miora_admins_all on public.ad_revision_requests;
create policy miora_admins_all on public.ad_revision_requests
  for all to authenticated
  using (public.is_miora_admin())
  with check (public.is_miora_admin());
revoke all on public.ad_revision_requests from anon;
grant select, insert, update, delete on public.ad_revision_requests to authenticated, service_role;
