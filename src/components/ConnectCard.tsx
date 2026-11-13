import { useEffect, useRef, useState } from 'react'
import {
  useAppKit,
  useAppKitAccount,
  useAppKitConnections,
  useAppKitProvider,
  useDisconnect,
  useWalletInfo,
} from '@reown/appkit/react'
import type { TronConnector } from '@reown/appkit-utils/tron'

const TRON_CHAIN_ID = 'tron:0x2b6653dc'

// One recovery attempt per page load. Prevents a loop when the wallet keeps
// reporting an address that does not match the stored session.
let recoveryAttempted = false
let walletConnectPurgeDone = false

/**
 * Public landing page card: connect, then show the connected wallet identity
 * (Trust Wallet logo/name, wallet address, connected time, network) and a
 * disconnect button. Wallet actions live behind the admin token at /admin.
 */
export function ConnectCard() {
  const { open } = useAppKit()
  const { isConnected, address } = useAppKitAccount()
  const { disconnect } = useDisconnect()
  const { walletInfo } = useWalletInfo('tron')
  const { connections } = useAppKitConnections('tron')
  const { walletProvider, walletProviderType } = useAppKitProvider<TronConnector>('tron')
  const connectedAt = useConnectedAt(isConnected ? address : undefined)

  // AppKit restores the stored WalletConnect session and paints its negotiated
  // account, which can be an old account after a switch inside Trust. Check the
  // provider's live account and force a fresh session when they differ.
  useEffect(() => {
    if (!address) return

    purgeStaleWalletConnectSessions(address)

    // Injected adapters (Trust's in-app browser) are the live source of truth;
    // only WalletConnect sessions can go stale, so the comparison is a no-op.
    if (!walletProvider || walletProviderType !== 'WALLET_CONNECT') return
    if (recoveryAttempted) return

    let cancelled = false

    void (async () => {
      const live = await requestLiveAccounts(walletProvider)
      if (cancelled || !live?.[0] || live[0] === address) return

      recoveryAttempted = true
      await disconnect()
      await open()
    })().catch(() => {})

    return () => {
      cancelled = true
    }
    // `open`/`disconnect` are re-created on every render by AppKit's hooks, so
    // they are intentionally omitted to avoid re-probing the wallet constantly.
  }, [address, walletProvider, walletProviderType])

  if (!isConnected || !address) {
    return (
      <button className="btn" type="button" onClick={() => open()}>
        Connect wallet
      </button>
    )
  }

  const connection =
    connections.find((item) => item.accounts.some((account) => account.address === address)) ??
    connections[0]

  const name = walletInfo?.name ?? connection?.name ?? 'Wallet'
  const icon = walletInfo?.icon ?? connection?.icon
  const url = walletUrl(walletInfo, name)
  const networkName = connection?.caipNetwork?.name ?? 'Tron'
  const networkIcon = connection?.networkIcon

  return (
    <section className="connection">
      <p className="connection-title">Connection details</p>

      <div className="wallet-card">
        {icon ? (
          <img className="wallet-logo" src={icon} alt="" width={40} height={40} />
        ) : (
          <span className="wallet-logo wallet-logo-fallback" aria-hidden="true" />
        )}
        <div className="wallet-meta">
          <p className="wallet-name">{name}</p>
          {url && (
            <a className="wallet-url" href={url} target="_blank" rel="noreferrer">
              {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
        </div>
        <PhoneIcon />
      </div>

      <dl className="connection-rows">
        <div>
          <dt>Wallet</dt>
          <dd title={address}>{shortAddress(address)}</dd>
        </div>
        <div>
          <dt>Connected</dt>
          <dd>{connectedAt ? new Date(connectedAt).toLocaleString() : '—'}</dd>
        </div>
      </dl>

      <p className="connection-label">Networks</p>
      <div className="network-row">
        {networkIcon ? (
          <img className="network-logo" src={networkIcon} alt="" width={28} height={28} />
        ) : (
          <span className="network-logo network-logo-fallback" aria-hidden="true">
            T
          </span>
        )}
        <div>
          <p className="network-name">{networkName}</p>
          <p className="network-address" title={address}>
            {shortAddress(address)}
          </p>
        </div>
      </div>

      <button className="btn ghost" type="button" onClick={() => void disconnect()}>
        Disconnect
      </button>
    </section>
  )
}

/** Remembers when this browser first saw the wallet, for the Connected row. */
function useConnectedAt(address: string | undefined): string | null {
  const [value, setValue] = useState<string | null>(null)
  const previousAddress = useRef<string | null>(null)

  useEffect(() => {
    if (!address) {
      previousAddress.current = null
      setValue(null)
      return
    }

    const key = `tron-connect:connected-at:${address}`
    const changed = previousAddress.current !== null && previousAddress.current !== address
    previousAddress.current = address

    // A different wallet gets a fresh timestamp; only reuse an existing one when
    // the address did not change (for example after a page reload).
    if (!changed) {
      const existing = window.localStorage.getItem(key)
      if (existing) {
        setValue(existing)
        return
      }
    }

    const now = new Date().toISOString()
    window.localStorage.setItem(key, now)
    setValue(now)
  }, [address])

  return value
}

/**
 * Asks the provider for its live account. The injected connector answers
 * directly; WalletConnect forwards it to the wallet. AppKit 1.8.24's WC
 * connector has a broken request(), so fall back to the wrapped
 * UniversalProvider when that happens.
 */
async function requestLiveAccounts(provider: TronConnector): Promise<string[] | null> {
  try {
    const result = await provider.request<string[]>({ method: 'tron_requestAccounts' })
    if (Array.isArray(result) && result[0]) return result
    if (typeof result === 'string' && result) return [result]
  } catch {
    // Fall through to the UniversalProvider below.
  }

  const universal = (
    provider as unknown as {
      provider?: {
        request: (args: { method: string; params: unknown }, chainId?: string) => Promise<unknown>
      }
    }
  ).provider

  if (universal && universal !== provider) {
    try {
      const result = await universal.request(
        { method: 'tron_requestAccounts', params: {} },
        TRON_CHAIN_ID,
      )
      if (Array.isArray(result) && result[0]) return result as string[]
      if (typeof result === 'string' && result) return [result]
    } catch {
      // The wallet did not answer; leave AppKit's state untouched.
    }
  }

  return null
}

/**
 * Removes stored WalletConnect entries whose Tron account list does not contain
 * the address AppKit reported. Only `wc@2` keys are touched, so unrelated
 * storage (such as the admin token in sessionStorage) is preserved.
 */
function purgeStaleWalletConnectSessions(reportedAddress: string) {
  if (walletConnectPurgeDone) return
  walletConnectPurgeDone = true

  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index)
      if (key && /^wc@2/.test(key)) keys.push(key)
    }

    for (const key of keys) {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue

      const accounts = raw.match(/tron:[A-Za-z0-9]+:[A-Za-z0-9]+/g)
      if (!accounts || accounts.length === 0) continue

      if (!accounts.some((account) => account.endsWith(`:${reportedAddress}`))) {
        window.localStorage.removeItem(key)
      }
    }
  } catch (err) {
    console.warn('Could not purge stale WalletConnect sessions:', err)
  }
}

function walletUrl(walletInfo: Record<string, unknown> | undefined, name: string): string | null {
  const raw = walletInfo?.url
  if (typeof raw === 'string' && raw) return raw

  if (/trust/i.test(name)) return 'https://trustwallet.com'
  return null
}

function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address
}

function PhoneIcon() {
  return (
    <svg
      className="wallet-device"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  )
}
