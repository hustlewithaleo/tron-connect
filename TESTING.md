# Testing checklist

Use a throwaway Tron wallet funded with a little TRX and USDT. Never test the
deduct flow with a wallet you cannot afford to lose.

## 0. Before you start

`.env` needs:

- `VITE_WC_PROJECT_ID`
- `SPENDER=TP44ohBC8sq1o4cxjF7brE7dP3BDgVGDGN` (already set)
- `ADMIN_TOKEN` (already set)
- `SPENDER_PRIVATE_KEY` — only required for deductions
- `TRONGRID_API_KEY` — optional, avoids rate limits

Add `http://localhost:5180` (and your LAN origin, if used) to the Reown Cloud
allowlist, then:

```bash
npm run dev
```

- dApp: http://localhost:5180
- admin: http://localhost:5180/admin
- API: http://localhost:5181 (logs print which features are enabled)

## 1. Connection and allowance check

1. Open the dApp and click **Connect wallet**.
2. In Trust, scan the WalletConnect QR (desktop) or connect directly (Trust
   in-app browser).
3. Expected: address, TRX/USDT balances, spender address and **Verified by the
   server at …** appear.
4. Open `/admin`, paste `ADMIN_TOKEN`.
5. Expected: one wallet row with allowance, TRX/USDT, 1 check. Click
   **Details** to see timestamps, staked TRX, energy/bandwidth and token list.

## 2. Approve

1. Click **Approve USDT**.
2. A fresh wallet (allowance 0) asks for **one** signature: approve max.
3. A wallet with an existing allowance asks for **two**: reset to 0, then
   approve max.
4. Expected: status `Done`, allowance becomes **Unlimited**, transaction rows
   appear in admin as `reset` / `approve`, both `confirmed`.
5. Click **Approve USDT** again. Expected: it returns `Done` with no wallet
   prompt, because the allowance is already max.

One approval burns roughly 10–15 TRX on an unstaked wallet.

## 3. Revoke

1. Click **Revoke** and confirm in the wallet.
2. Expected: allowance becomes `0 USDT`; admin gets a `revoke` event.

## 4. Manual deduction

Requires `SPENDER_PRIVATE_KEY` to be the private key of `SPENDER`. The API log
should say `Deductions enabled for spender …`.

1. Make sure the user wallet has approved the spender and holds USDT.
2. In `/admin` → wallet → **Details** → **Deduct USDT**.
3. Enter a tiny amount, e.g. `0.01`, keep the destination as the spender, click
   **Review deduction**, then **Confirm deduction**.
4. Expected:
   - server re-checks allowance and balance;
   - `transferFrom(owner, spender, 0.01)` is signed with the spender key;
   - success message with a Tronscan link;
   - wallet allowance decreases, wallet USDT decreases, spender USDT increases;
   - an admin event `deduct / confirmed` appears.
5. Fail cases worth trying:
   - amount above allowance → 400, nothing sent;
   - amount above wallet USDT balance → 400, nothing sent;
   - wrong/empty `SPENDER_PRIVATE_KEY` → 503 with a clear message;
   - missing admin token → 401.

The spender pays energy/bandwidth for `transferFrom`. If it has no TRX and no
staked energy, the deduction fails on-chain even when the allowance is correct.

## 5. Failure paths

- Reject the signature in Trust → status becomes `Rejected in wallet`, no event.
- Stop the API (`Ctrl+C` the `api` process) → the dApp shows the verification
  server as unavailable and does not approve.
- Hit `/admin` with the wrong token → `Unauthorized`, token is cleared.

## Useful checks

```bash
curl http://localhost:5181/api/health
curl http://localhost:5181/api/config
```

`/api/config` should report your spender, the USDT contract and
`"configured": true`.

If TronGrid answers 429, wait a few seconds or set `TRONGRID_API_KEY`.
