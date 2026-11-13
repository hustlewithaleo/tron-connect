import { useAppKit } from '@reown/appkit/react'
import { useUsdtApproval } from '../hooks/useUsdtApproval'
import { formatAllowance } from '../lib/usdt'

const COPY: Partial<Record<string, string>> = {
  checking: 'Checking allowance with the server…',
  resetting: 'Confirm reset (1 of 2)',
  approving: 'Confirm approval (2 of 2)',
  confirming: 'Waiting for confirmation…',
  done: 'Done',
  error: 'Something went wrong',
}

export function ApprovePanel() {
  const { open } = useAppKit()
  const {
    isConnected,
    phase,
    error,
    configError,
    spender,
    allowance,
    checkedAt,
    refreshAllowance,
    approveUnlimited,
    revoke,
  } = useUsdtApproval()

  if (!isConnected) {
    return (
      <button className="btn" type="button" onClick={() => open()}>
        Connect wallet
      </button>
    )
  }

  const busy = ['checking', 'resetting', 'approving', 'confirming'].includes(phase)

  return (
    <div className="panel">
      <p className="label">USDT allowance</p>
      <p className="spender">
        Spender: <code>{spender || 'not configured'}</code>
      </p>

      <div className="allowance-row">
        <span className="allowance-value">
          {allowance === null ? '—' : formatAllowance(allowance)}
        </span>
        <button
          className="link"
          type="button"
          onClick={() => void refreshAllowance()}
          disabled={busy}
        >
          Re-check
        </button>
      </div>

      {checkedAt && (
        <p className="checked">
          Verified by the server at {new Date(checkedAt).toLocaleTimeString()}
        </p>
      )}

      <div className="row">
        <button className="btn" type="button" onClick={approveUnlimited} disabled={busy}>
          {busy ? 'Working…' : 'Approve USDT'}
        </button>
        <button className="btn ghost" type="button" onClick={revoke} disabled={busy}>
          Revoke
        </button>
      </div>

      {COPY[phase] && <p className="status-line">{COPY[phase]}</p>}
      {error && <p className="error">{error}</p>}
      {!error && configError && (
        <p className="error">Verification server unavailable: {configError}</p>
      )}
    </div>
  )
}
