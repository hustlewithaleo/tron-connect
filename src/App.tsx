import { ConnectCard } from './components/ConnectCard'

export default function App() {
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

      <p className="footnote">Trust Wallet · WalletConnect · Non-custodial</p>
    </main>
  )
}
