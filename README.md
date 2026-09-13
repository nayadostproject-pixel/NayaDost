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
