-- Two-factor enforced in the database too: once a MIORA admin has a verified authenticator, their session must be aal2
-- (code entered) for any table access. Admins without a factor are unaffected until they set one up. Service role bypasses RLS.
create or replace function public.is_miora_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.miora_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  and (
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
  );
$$;
revoke all on function public.is_miora_admin() from public, anon;
grant execute on function public.is_miora_admin() to authenticated, service_role;
