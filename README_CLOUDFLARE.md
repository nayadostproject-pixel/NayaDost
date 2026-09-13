# NayaDost Mining — Cloudflare Worker + D1

This build is prepared for the existing Worker URL:
`https://nayadost-app.nayadost-db.workers.dev/`

## Deploy

1. Install Wrangler: `npm i -g wrangler`
2. Login: `npx wrangler login`
3. Create D1: `npx wrangler d1 create naya-dost-db`
4. Put the returned database ID in `wrangler.toml`.
5. Create tables/data:
   `npx wrangler d1 execute naya-dost-db --remote --file=schema.sql`
6. Set secrets in Cloudflare (never commit them):
   `npx wrangler secret put TELEGRAM_BOT_TOKEN`
   `npx wrangler secret put ADMIN_KEY`
7. Deploy: `npx wrangler deploy`

After deployment test:
`/api/health` should return JSON with `ok:true`.

### Important

This Worker build implements the core D1-backed API for bootstrap, tap mining, claim, daily/external tasks, network reward claim, withdrawals/history, price and TON-proof nonce.

**TON proof signature verification is intentionally not enabled in this Worker build yet.** The Worker returns HTTP 501 for `/api/ton-proof/verify` rather than accepting an unverified wallet. For production wallet verification, keep the existing Node backend or add a properly audited TON proof verifier before enabling wallet-bound rewards/withdrawals.
