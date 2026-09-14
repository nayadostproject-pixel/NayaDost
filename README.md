# NayaDost Mining — Telegram Mini App + real TON Connect wallet

## Wallet connection (important)

Manual wallet-address entry is **disabled**.

The app uses **TON Connect** from inside the Telegram Mini App. Tapping **Connect Wallet** opens the TON Connect wallet picker; the user approves the connection in a compatible TON wallet (including the Wallet/Tonkeeper flow supported by TON Connect). The app receives the wallet address from TON Connect and asks the wallet for a `ton_proof` signature.

The backend verifies the proof, domain, nonce, timestamp, wallet state-init/address binding and Ed25519 signature before setting the user's wallet as verified. A direct `/api/wallet/connect` request is rejected.

This follows the TON Connect authentication flow documented by TON Foundation: a backend-issued one-time payload is signed by the wallet and verified server-side. The proof is not a token transfer and does not expose the user's private key.

## Production setup

1. Deploy the project on a **public HTTPS domain**.
2. Set `APP_URL=https://your-domain.example`.
3. Set `APP_DOMAIN=your-domain.example` (include the port only for local development such as `localhost:5173`).
4. Set `TELEGRAM_BOT_TOKEN` to the BotFather token for the Mini App bot. The server validates Telegram WebApp `initData` when this is configured.
5. Put the Mini App URL into BotFather / your Telegram Mini App configuration.
6. Make sure `/tonconnect-manifest.json` is publicly reachable. The server generates it from `APP_URL` and serves `/icon-180.png`.
7. Run `npm install` and then `npm start`.

## TON network

`TON_NETWORK=-239` means TON mainnet. The wallet proof and all production withdrawals should remain on mainnet unless you intentionally run a testnet environment.

## Important

- Never put a bot token, private key, mnemonic, admin secret, or withdrawal signing key in `public/index.html`.
- TON Connect does not give the application the user's private key.
- A real automatic blockchain withdrawal still requires a server-side TON payout wallet/signing system. The admin approval flow should be the gate before that signer sends funds.
- Automatic USDT deposit crediting requires a real TON indexer/API and transaction verification; do not credit users from an untrusted client request.


## Real miner level payment / unlock
- Locked levels no longer consume the user's NYD balance.
- The next level opens a real payment invoice and wallet transfer flow.
- Payment recipient is configured with `PAYMENT_TON_ADDRESS` / `PAYMENT_USDT_ADDRESS`.
- USDT uses the official TON USDT jetton master `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`.
- The server records an invoice, waits for blockchain confirmation through TONAPI, verifies the connected wallet is the sender, and only then increments `miner_level`.
- Mining reward/speed is therefore changed only after confirmed payment.
- Set `TONAPI_API_KEY` in production. The exact USDT receiving address from the owner's screenshot must be placed in `PAYMENT_USDT_ADDRESS`; it is intentionally not guessed.
- Level payment amount is derived from the existing level unlock value multiplied by the current NYD price; `LEVEL_PRICE_MULTIPLIER` can adjust it.


## Latest mining/referral UI changes
- Tap-to-mine now uses an animated tap/coin effect with rings, sparks, flash and floating NYD reward.
- Tap rewards are held as pending mining rewards until the user presses CLAIM.
- CLAIM credits pending mining rewards to the spendable balance and distributes configured multi-level referral rewards.
- Daily Check-in is a Tasks item and can be claimed once per UTC day.


## Failed to fetch fix
The old external/Netlify API override has been removed. The production app is intentionally same-origin: the Node/Express server must serve both `public/` and `/api`. This prevents the Mini App from silently calling an unrelated static host. The server includes CORS support, OPTIONS handling, and `GET /api/health` for diagnostics.

## Miner Store + real payments
- Miner levels are 1–1000. Every locked level shows **PAY & UNLOCK**; a user can purchase any higher level directly.
- Level payment amount is calculated from the level's NYD pack value × the current NYD price.
- **USDT** uses the official USDT-on-TON jetton master and sends the exact micro-USDT amount.
- **TON** converts the same pack USD value to TON using the live TON/USD rate when available.
- Payment is sent from the connected TON Connect wallet. The wallet opens with the exact amount; if the wallet does not support the structured request, the app falls back to the TON payment deep link.
- Payment confirmation is server-side only: the backend checks the TON Center indexed blockchain data for the exact recipient, sender and amount before unlocking the level. No client-side "paid" flag can unlock a level.
- The same normal TON owner address can receive both TON and USDT on TON. `PAYMENT_USDT_ADDRESS` defaults to `DEPOSIT_ADDRESS`; set it separately only if your USDT receiving owner address is different.
- Mining reward is recalculated from the purchased miner level on the backend, so changing local JavaScript cannot increase mining rewards.

### Render environment
The defaults are usable for testing, but production should set the real receiving address and NYD price source:
`DEPOSIT_ADDRESS`, `PAYMENT_TON_ADDRESS`, `PAYMENT_USDT_ADDRESS`, `NYD_PRICE_FALLBACK` or `NYD_PRICE_API_URL`.
`TONCENTER_API_KEY` is optional; the public TON Center v3 endpoint is rate-limited, so adding a key is recommended for a busy production app.


## Data persistence / balance protection
- SQLite uses `DB_PATH` when set; otherwise on Render it uses `/var/data/naya_dost.sqlite`.
- `render.yaml` uses a paid Render Starter web service with a 1 GB persistent disk mounted at `/var/data`.
- This is required because Render Free web services do not provide a persistent disk for SQLite.
- User balance, pending mining, taps, referrals, task claims, wallet verification, deposits, withdrawals and withdrawal history are stored in SQLite.
- The frontend always refreshes balance and today's mining count from the server on bootstrap; localStorage is only a UI cache.
- Today's mining limit is exactly 5000 taps, server-enforced.
- The two Telegram channel tasks are forced to `100 NYD` on startup, including existing databases.


## Task reward and verification
- The two Telegram channel tasks are stored server-side at 100 NYD each and can be repeated every 2 hours.
- Existing databases are migrated to 200 NYD at startup.
- Telegram rewards are only credited after the backend verifies membership with Bot API getChatMember.
- Configure EARN_CHANNEL_CHAT_ID and OFFICIAL_CHANNEL_CHAT_ID in production.
- Withdrawal history is stored in SQLite and read from the server.


### Balance persistence fix (important)
- The SQLite database is the authoritative source for balance; browser localStorage is only a temporary UI cache.
- The Mini App refreshes authoritative user state when it loads and whenever Telegram hides/shows the Mini App again.
- Do not deploy this build to a Render service without a persistent disk mounted at `/var/data`; otherwise SQLite data can disappear after a service restart/redeploy.
- If using Render Blueprint, sync/deploy `render.yaml`. If configuring the existing service manually, add a 1 GB persistent disk mounted at `/var/data` and set `DB_DIR=/var/data`.
- Verify persistence after deployment by earning a small amount, closing/reopening the Mini App, and checking that the same server balance returns.


### NYD price & Miner P&L
NYD price is fixed at $0.0005 per NYD (1000 NYD = $0.50). Miner pack NYD costs/levels are unchanged. The Miner Store now shows saved current balance, total withdrawn, NYD price, and today's P&L with balance/withdrawal chart lines.


## VIP Auto Miner
- One-time VIP unlock: **$25 USDT on TON**.
- VIP unlock is server-side and only activates after an on-chain USDT payment is verified.
- VIP rate: **0.100 NYD per second** with automatic balance credit/claim.
- VIP earnings continue while the user is away and are settled when the app/server processes the account.
- VIP payment recipient uses `PAYMENT_USDT_ADDRESS` (defaults to the configured TON USDT receiving owner address).


## Twitter task
- X account: @OfficialNayaDost
- Profile: https://x.com/NayaDost_ton


## Bug-fix build — 2026-09-14
Fixed in this build:
- 5000 daily taps is enforced consistently by frontend and backend.
- Mining reward is stored in `pending_mining` and Claim moves it to `balance`.
- X task uses `@NayaDost_ton` and `https://x.com/NayaDost_ton`.
- Website task uses canonical id `site` (old `website` id is migrated).
- Telegram/website links use Telegram Mini App link APIs with browser fallback.
- Telegram first/last name and username are copied into the profile from server state.
- Claim button is protected against double-clicks.
- API calls retry and timeout instead of hanging indefinitely.
- Startup has a visible loading screen instead of a blank black screen.
- Pool Wallet is renamed to Available Balance to make claim/withdraw state clear.
- VIP payment remains exactly 25.00 USDT on TON; level payments display server-calculated exact amounts.

### Required Render environment for Telegram task verification
`TELEGRAM_BOT_TOKEN` must be set. For each channel task, the bot must be able to call `getChatMember`.
Set `EARN_CHANNEL_CHAT_ID` to the actual Telegram chat/channel id for the invite-only payment channel, and `OFFICIAL_CHANNEL_CHAT_ID` to the official channel id (or use a public `@username` channel). An invite URL alone cannot be used as a Bot API chat id.

### Required payment environment
Set `PAYMENT_USDT_ADDRESS` to the intended USDT-on-TON receiving wallet and keep `USDT_MASTER` set to the correct USDT jetton master.
