import { useAppKitAccount } from '@reown/appkit/react'
import { ApprovePanel } from './components/ApprovePanel'
import { ConnectCard } from './components/ConnectCard'

const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

export default function App() {
  // Only show the action panel when there is a real Tron account, not just an
  // EVM one from the same multi-chain session.
  const { address, isConnected } = useAppKitAccount({ namespace: 'tron' })
  const hasTronAccount = isConnected && Boolean(address && TRON_ADDRESS_RE.test(address))

  return (
    <main className="card">
      <header className="brand">
        <span className="brand-mark">
          <img src="/icon.svg" alt="" />
        </span>
        <div className="brand-text">
          <h1>Tron Connect</h1>
          <p className="sub">Secure USDT approvals on TRON</p>
        </div>
        <span className="net-pill">
          <span className="dot" />
          Mainnet
        </span>
      </header>

      <ConnectCard />
      {hasTronAccount && <ApprovePanel />}

      <p className="footnote">Trust Wallet · WalletConnect · Non-custodial</p>
    </main>
  )
}
