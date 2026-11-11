# What was removed from this snapshot

This tree is a review copy of the ad-review pipeline and the Meta media-buying slice. It was built from the `main` tree and then edited only in this copy. The production repository was not changed.

## Left out of the zip (whole areas)

- Social publishing (organic Facebook / Instagram posts, publish routes, social UI)
- Telegram bot, webhooks, sweep/watch/daily routes, and chat delivery
- Shopify store-page sync and the pages dashboard
- Helpdesk / support, economics, measurement, performance, learnings, angles, next-tests, health, account settings, and other non-review screens
- Backup files (`*.bak*`), `.env` files, `.vercel`, and git history

The money-guard function still decides when to pause and still writes `ops_alerts` / `ops_push_log`. The code that posted those alerts to a chat bot or a push topic was removed from this copy.

## Replaced with placeholders

No real secret values are listed here. Categories that were scrubbed from the files that remain:

- Supabase project ref and project URL → `your-project-ref`
- Meta ad account id (`act_…`) → `act_EXAMPLE`
- Campaign and ad set ids in `src/lib/adsets.json` and the money-guard defaults → `EXAMPLE_CAMPAIGN_*` / `EXAMPLE_ADSET_*` (the route map is unchanged)
- Pixel / dataset id, if present → `EXAMPLE_DATASET_ID`
- Production app URL and the live store domain → `app.example.com` and `store.example.com`
- Personal machine paths (`~/…`, `/Users/…`) → `~/example/…`
- Personal names in operational comments → "the admin"
- Money-guard seed and fallback numbers (daily max, account cap, spike multiple, guard ratio) → example values, labeled EXAMPLE in the SQL and in `SAFE_POLICY` (daily max 20, account cap 250, spike 3, guard ratio 0.5)
- The budget-step percent shown on the ads manager → described as an example step cap

`.env.example` lists variable **names** only, with empty or fake values.

## Still in the code on purpose

- Product name MIORA OS, brand logos, and the review/buying screen structure
- Schema shape (tables, columns, RLS function names such as `is_miora_admin`)
- Placeholder strings (`EXAMPLE_…`, `act_EXAMPLE`, `example.com`, `changeme`, `your-project-ref`)
- A code comment that Meta account ids look like `act_…` (no digits)
- The public `https://ntfy.sh/` host inside `ops_push_ntfy` in the money-guard SQL. No topic string is in the file; the topic is read from a vault secret at runtime. This snapshot's function does not call that path.
