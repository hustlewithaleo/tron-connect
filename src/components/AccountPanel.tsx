import { useCallback, useEffect, useState } from 'react'
import { useAppKitAccount, useDisconnect } from '@reown/appkit/react'
import { formatAmount, getBalances, type Balances } from '../lib/balances'

export function AccountPanel() {
  const { address, isConnected } = useAppKitAccount()
  const { disconnect } = useDisconnect()
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBalances = useCallback(async () => {
    if (!address) return

    setLoading(true)
    setError(null)
    try {
      setBalances(await getBalances(address))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load balances.')
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    setBalances(null)
    if (address) void loadBalances()
  }, [address, loadBalances])

  if (!isConnected || !address) return null

  return (
    <section className="account">
      <p className="label">Connected account</p>
      <p className="address">{address}</p>
      <p className="chain">Network: TRON mainnet</p>

      <div className="balance-head">
        <p className="label">Balance</p>
        <button
          className="link"
          type="button"
          onClick={() => void loadBalances()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="balances">
        <div className="balance">
          <span className="amount">
            {balances ? formatAmount(balances.trx) : '…'}
          </span>{' '}
          <span className="unit">TRX</span>
        </div>
        <div className="balance">
          <span className="amount">
            {balances ? formatAmount(balances.usdt) : '…'}
          </span>{' '}
          <span className="unit">USDT</span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <button className="btn ghost" type="button" onClick={() => void disconnect()}>
        Disconnect
      </button>
    </section>
  )
}
