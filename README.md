# tron-connect

A small React dApp that connects Trust Wallet on Tron through Reown AppKit
(WalletConnect) and grants or revokes a USDT (TRC20) allowance for a configured
spender address.

Allowance checks and approval reports go through a small Express API that
re-verifies everything against TronGrid, and records it for an admin panel.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Get a WalletConnect Project ID from [dashboard.reown.com](https://dashboard.reown.com).

3. Create `.env` (or copy `.env.example`) and fill it in:

   ```
   VITE_WC_PROJECT_ID=your_project_id
   SPENDER=T...                 # base58 Tron address that receives the allowance
   SPENDER_PRIVATE_KEY=...      # optional: enables the admin deduct widget
   ADMIN_TOKEN=...              # required for /admin and /api/admin/*
   TRONGRID_API_KEY=            # optional, avoids TronGrid rate limits
   PORT=5181                    # API server; Vite proxies /api here
   ```

   `.env` is gitignored. Never commit the real Project ID, admin token or
   spender private key.

4. Start the web app and the API together:

   ```bash
   npm run dev
   ```

   - dApp: **http://localhost:5180**
   - admin: **http://localhost:5180/admin**
   - API: **http://localhost:5181**

   Run only one side with `npm run dev:web` or `npm run dev:api`.

5. In Reown Cloud, allowlist the origins you use:

   - `http://localhost:5180`
   - the LAN origin, if testing from a phone (`vite.config.ts` sets `host: true`)
   - your production origin (later)

   `metadata.url` is `window.location.origin` and has no trailing slash.

## How it works

- **Connect wallet** opens the AppKit modal. Inside Trust's in-app browser the
  Trust tile connects directly; on desktop choose WalletConnect and scan the QR
  with Trust.
- The browser never decides the allowance on its own. `GET /api/verify` reads
  `allowance(owner, spender)` from TronGrid server-side and returns the raw
  value. The client uses that result to choose the approval path, and every
  check is logged.
- **Approve USDT** flow:
  1. server-side allowance check;
  2. if already at `uint256` max → `done`, no signature;
  3. if a non-zero allowance exists → `approve(spender, 0)` ("reset"), confirm;
  4. `approve(spender, 2^256 - 1)`, confirm;
  5. report each confirmed tx to `POST /api/events`.
- **Revoke** sends `approve(spender, 0)` and reports it.
- `POST /api/events` does not trust the client. It fetches the transaction from
  TronGrid and requires: it exists, calls the USDT contract, was sent by the
  reported owner, and has a `SUCCESS` receipt. It then re-reads the allowance
  and stores the result.
- Balances (TRX/USDT) are read from TronGrid and are read-only.
- **Sign message** sends `tron_signMessage` through the connected wallet.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | – | Liveness |
| `GET` | `/api/config` | – | Spender, USDT contract, required allowance, network |
| `GET` | `/api/branding` | – | dApp name, description, URL and icon for the wallet prompt |
| `GET` | `/api/branding/icon` | – | Uploaded icon, or redirect to `/icon.svg` |
| `GET` | `/api/verify?owner=T...` | – | TronGrid allowance check (recorded) |
| `POST` | `/api/events` | – | Verify + record a reported approve/revoke tx |
| `GET` | `/api/admin/summary` | Bearer | Totals, wallets, checks, events |
| `GET` | `/api/admin/branding` | Bearer | Current branding + allowed URL origins |
| `PUT` | `/api/admin/branding` | Bearer | Update name/description/URL and upload an icon |
| `GET` | `/api/admin/export` | Bearer | Raw store as JSON download |
| `POST` | `/api/admin/deduct` | Bearer | Manual `transferFrom(owner, to, amount)` signed by `SPENDER_PRIVATE_KEY` |

Admin auth accepts `Authorization: Bearer <ADMIN_TOKEN>` or `X-Admin-Token`.

### `POST /api/events` body

```json
{
  "owner": "T...",
  "txId": "<64 hex chars>",
  "action": "approve",
  "amount": "<raw token units>"
}
```

A failing verification still returns the recorded event, with status
`failed`, and HTTP 422.

## Admin panel

Open **/admin**, paste `ADMIN_TOKEN`, and you get:

- totals: wallets, wallets with enough allowance, checks, approvals, revokes,
  reset steps, failed events;
- a **Branding** editor: dApp name, description, URL and icon upload (PNG,
  JPEG, WebP or SVG up to 1 MB). The name/icon/URL are read at page load and
  used in the wallet's connection prompt, so no redeploy is needed. The URL must
  be the origin the site is opened on, or an `ALLOWED_ORIGINS` entry;
- a wallet table with latest allowance and TRX/USDT balances;
- a **Details** row per wallet: on-chain activation, hex address, created and
  last-activity timestamps, TRX and USDT balances, staked TRX, energy and
  bandwidth usage, allowance-check count, approvals/revokes/resets/deductions,
  failed reports, all TRC20 token balances, and the last recorded event;
- a **Deduct USDT** widget inside each wallet's details: amount (with Max),
  destination (defaults to the spender), review + confirm, then a Tronscan link;
- transaction reports (confirmed and rejected) with Tronscan links;
- the recent allowance-check log including IP;
- auto-refresh every 10 seconds (on-chain data is cached server-side for 60s;
  the Refresh button forces a fresh TronGrid fetch) and a JSON export of the
  raw store.

The token is kept in `sessionStorage`; the server compares it in constant time.

## Files

- `server/index.ts`: Express API, static build serving, SPA fallback
- `server/tron.ts`: TronGrid allowance reads and transaction verification
- `server/store.ts`: JSON persistence (`data/store.json`, gitignored)
- `server/auth.ts`: `ADMIN_TOKEN` check
- `src/lib/appkit.ts`: AppKit + Tron adapter + Trust adapter setup
- `src/lib/api.ts`: typed client for the API
- `src/lib/usdt.ts`: allowance read, `approve` builder, sign/broadcast/confirm
- `src/lib/balances.ts`: TRX/USDT balance lookups
- `src/hooks/useUsdtApproval.ts`: approval/revoke state machine
- `src/components/ApprovePanel.tsx`, `AccountPanel.tsx`, `SignMessage.tsx`
- `src/components/AdminPanel.tsx`: admin dashboard
- `src/main.tsx`: routes `/` to the dApp and `/admin` to the dashboard
- `vite.config.ts`: React plugin, `global` shim, port 5180, `/api` proxy

## Production

```bash
npm run build
npm start
```

`npm start` runs the API on `PORT` and also serves `dist/`, including the
`/admin` SPA route. Put it behind TLS, keep `ADMIN_TOKEN` secret, and add the
public origin to Reown Cloud.

## Deploy to Vercel

The project is set up as one Vercel deployment: Vite static build plus Node
functions under `api/` (`health`, `config`, `verify`, `events`, and
`admin/*`) that all run the same Express app from `server/app.ts`.

1. Push the repo to Git and import it in Vercel (or run `npx vercel`). The
   framework preset is Vite; `vercel.json` sets `npm run build`, `dist`, the
   `/admin` rewrite and a 120s function limit for the deduct wait.

2. Add these **Environment Variables** in Vercel (Production + Preview):

   | Variable | Needed for |
   | --- | --- |
   | `VITE_WC_PROJECT_ID` | WalletConnect (must exist at build time) |
   | `VITE_APP_URL` | optional: custom domain used in the wallet prompt |
   | `SPENDER` | allowance check and approve target |
   | `ADMIN_TOKEN` | admin panel / API auth |
   | `SPENDER_PRIVATE_KEY` | optional, enables deductions |
   | `TRONGRID_API_KEY` | optional, higher TronGrid limits |
   | `ALLOWED_ORIGINS` | optional, extra origins accepted by the branding URL editor |

3. **Provision a Redis store** from the Vercel Marketplace (Upstash Redis) and
   connect it to the project. It injects `KV_REST_API_URL` +
   `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` +
   `UPSTASH_REDIS_REST_TOKEN`). Without it, `storage` shows `memory` in the
   admin panel and records disappear between cold starts.

4. Add the deployed origin to the Reown Cloud allowlist:

   ```
   https://your-project.vercel.app
   ```

   `metadata.url` is derived from `window.location.origin`, so no code change is
   needed. Add a custom domain there too if you attach one.

5. Redeploy after changing `VITE_WC_PROJECT_ID` — Vite inlines it at build time.
   Server-only variables take effect on the next deployment/restart.

Check `https://your-project.vercel.app/api/health`: it reports the storage mode
(`redis`, `memory` or `file`). `vercel logs` shows the startup warnings
(deductions enabled/disabled, missing spender, etc.).

## Notes

- **Wallet support varies.** Not every wallet supports the `tron` namespace or
  `tron_signTransaction`; Trust must be used through WalletConnect or its
  in-app browser.
- **Budget TRX.** Without staked energy, each approval burns roughly 10–15 TRX,
  so a reset + approve can cost around 20–30 TRX. `feeLimit` is 100 TRX and is
  only a cap, not a fee.
- **Transactions expire.** A transaction built by `tronweb` is valid for about a
  minute; if the wallet sits on the confirmation screen too long, rebuild and
  retry.
- **Two signatures are expected when an allowance already exists.** Resetting
  first is deliberate: it keeps the allowance at zero if the second signature
  is rejected.
- **`MIN_ALLOWANCE`** optionally sets what counts as "sufficient" in the admin
  summary; it defaults to unlimited.
- **Deductions are a hot-wallet operation.** `SPENDER_PRIVATE_KEY` lets the
  server sign `transferFrom`. The server checks the allowance and the wallet's
  USDT balance first, but it will send real funds once confirmed. Leave the key
  empty to disable the widget, keep the API behind TLS, and treat
  `ADMIN_TOKEN` as a password to the funds.
