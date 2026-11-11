# MIORA OS — ad review and media buying (sanitized slice)

This is a **sanitized snapshot** of two parts of MIORA OS, for code review. It is not the production app, and it does not contain production credentials, account ids, or the rest of the product.

The product name is MIORA OS. Everything that identified a live account, store, or machine has been replaced with placeholders (`example.com`, `YOUR` / `EXAMPLE_` ids, `changeme`). See `SANITIZED.md`.

## What is in this zip

**Ad review pipeline** (`/review`)

- Finished ads wait in a veto queue. The reviewer watches the creative, then approves, rejects, or requests a new cut.
- Approve checks a publish gate (claims, landing page, copy) and a lander-congruency score. Request changes writes `ad_revision_requests` for a later handler to claim. That queue is not the overseer's `raw.oversight` verdict.
- Copy limits and the recommended button live in `src/lib/copy-qa.ts` and `src/lib/copy-qa.json`.
- Cards are ordered by the overseer score stored on the ad (`raw.oversight`). This repo shows that score; the scorer itself runs outside this slice.
- Pre-flight measurements are read from `ad_preflight` (`supabase/2026-10-28_ad_preflight.sql`).
- Playback uses signed Storage links: `/api/video/[id]`, `/api/image/[id]`, `/api/thumb/[key]`. `scripts/review-preview.sh` is the local preview encoder.

**Media buying** (`/ops` and the money guard)

- `/ops` is the ads manager: account spend, campaign and ad-set status, alerts, and proposals to pause, archive, or change a budget. Approving a proposal only updates `ops_proposals`. A separate job (not in this zip) is what talks to Meta after a re-check.
- `src/lib/adsets.json` is the campaign and ad-set map (which angle and lander go to which set). Ids in that file are placeholders. `src/lib/adset-route.ts` is the router the review screen and the buyer share.
- `supabase/functions/money-guard/index.ts` is the spend guard. On a schedule it reads Meta, compares spend and live budgets with `ops_policy`, and can pause an in-scope campaign. It does not turn campaigns on and does not change budgets. Seed numbers in the SQL and `SAFE_POLICY` are **examples**, not production limits.
- Schema for the manager and the guard: `supabase/2026-10-27_ops.sql`, `supabase/2026-10-27_ops_buyer.sql`, `supabase/2026-10-28_money_guard.sql`. Admin sign-in uses `is_miora_admin()` in `supabase/2026-10-28_mfa_admin.sql`.

The Next.js screens never call Meta. Meta access tokens are only for the money-guard function.

## Run it locally

1. Copy `.env.example` to `.env.local` and fill in **your own** Supabase URL and keys. Leave Meta and the guard key empty until you are ready to run the function against a test ad account.
2. Apply the SQL files in `supabase/` to that project, in date order. They expect `is_miora_admin()` and an admin allowlist you create yourself.
3. `npm install` then `npm run dev`.

Sign-in is Supabase email and password (or an email link) plus the admin allowlist. Sign-ups are not opened by this slice.

The money-guard function deploys separately (`supabase/functions/money-guard`). In this snapshot its alerts are written to `ops_alerts` and `ops_push_log` only.

## Not included

Social publishing, Telegram bots and webhooks, Shopify and store-page sync, helpdesk, economics, learnings, angles, and the other dashboard pages are not in this zip. See `SANITIZED.md`.
