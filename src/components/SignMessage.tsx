import { useState } from 'react'
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import type { TronConnector } from '@reown/appkit-utils/tron'

export function SignMessage() {
  const { address, isConnected } = useAppKitAccount()
  const { walletProvider } = useAppKitProvider<TronConnector>('tron')
  const [message, setMessage] = useState('Hello from tron-connect')
  const [signature, setSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isConnected || !address) return null

  const owner = address

  async function handleSign() {
    if (!walletProvider) {
      setError('Wallet provider is not ready yet.')
      return
    }

    setBusy(true)
    setError(null)
    setSignature(null)
    try {
      setSignature(await walletProvider.signMessage({ message, from: owner }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <label className="label" htmlFor="message">
        Message to sign
      </label>
      <textarea
        id="message"
        rows={3}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />

      <button
        className="btn"
        type="button"
        onClick={() => void handleSign()}
        disabled={busy || !message.trim()}
      >
        {busy ? 'Waiting for wallet…' : 'Sign message'}
      </button>

      {error && <p className="error">{error}</p>}

      {signature && (
        <div>
          <p className="label">Signature</p>
          <pre>{signature}</pre>
        </div>
      )}
    </section>
  )
}
