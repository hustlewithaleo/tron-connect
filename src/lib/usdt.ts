import { TronWeb } from 'tronweb'
import type { Types } from 'tronweb'
import type { TronConnector } from '@reown/appkit-utils/tron'

// USDT (TRC20) on Tron mainnet.
export const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
export const MAX_UINT256 = 2n ** 256n - 1n

const TRON_CHAIN_ID = 'tron:0x2b6653dc'
// Cap for the energy burn, in SUN (100 TRX). It is a limit, not a fee.
const FEE_LIMIT = 100_000_000
const CONFIRM_POLL_MS = 3_000
const CONFIRM_ATTEMPTS = 40

const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' })

/** Current allowance the spender has on the owner's USDT. */
export async function readAllowance(owner: string, spender: string): Promise<bigint> {
  const res = await tronWeb.transactionBuilder.triggerConstantContract(
    USDT,
    'allowance(address,address)',
    {},
    [
      { type: 'address', value: owner },
      { type: 'address', value: spender },
    ],
    owner,
  )

  const hex = res.constant_result?.[0]
  if (!hex) {
    throw new Error('Could not read the USDT allowance (empty contract response).')
  }

  return BigInt(`0x${hex}`)
}

/** Unsigned `approve(spender, amount)` transaction for the owner to sign. */
export async function buildApprove(
  owner: string,
  spender: string,
  amount: bigint,
): Promise<Types.Transaction> {
  const res = await tronWeb.transactionBuilder.triggerSmartContract(
    USDT,
    'approve(address,uint256)',
    { feeLimit: FEE_LIMIT, callValue: 0 },
    [
      { type: 'address', value: spender },
      { type: 'uint256', value: amount.toString() },
    ],
    owner,
  )

  if (!res.result?.result || !res.transaction) {
    throw new Error(res.Error || 'Could not build the USDT approval transaction.')
  }

  return res.transaction
}

/**
 * Signs the transaction with the connected wallet, broadcasts it when the
 * wallet only signs, and waits for on-chain confirmation.
 *
 * Wallets differ: some hand back a signature for us to broadcast, others sign
 * and broadcast themselves and return nothing. Only broadcast when a signature
 * came back; either way the receipt is what decides success.
 */
export async function signAndBroadcast(
  provider: TronConnector,
  owner: string,
  transaction: Types.Transaction,
): Promise<{ txId: string }> {
  const signed = await signTransaction(provider, owner, transaction)
  const txId = signed?.txID ?? transaction.txID

  if (signed?.signature?.length) {
    try {
      await tronWeb.trx.sendRawTransaction(signed)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/DUPLICATE_TRANSACTION|already exists|already known/i.test(message)) {
        throw err
      }
    }
  }

  await waitForConfirmation(txId)

  return { txId }
}

async function signTransaction(
  provider: TronConnector,
  owner: string,
  transaction: Types.Transaction,
): Promise<Types.SignedTransaction> {
  const connector = provider as TronConnector & {
    type?: string
    provider?: {
      request: (args: { method: string; params: unknown }, chainId?: string) => Promise<unknown>
      session?: { sessionProperties?: Record<string, string> }
    }
  }

  // WalletConnect: AppKit hands us a connector that wraps the UniversalProvider.
  // (Its own request() delegates to a method missing from appkit-controllers
  // 1.8.x, so talk to the UniversalProvider directly.)
  const universal = connector.provider && connector.provider !== connector ? connector.provider : null
  if (universal) {
    const usesV1Format =
      universal.session?.sessionProperties?.['tron_method_version'] === 'v1'

    const signed = (await universal.request(
      {
        method: 'tron_signTransaction',
        params: {
          address: owner,
          transaction: usesV1Format ? transaction : { transaction },
        },
      },
      TRON_CHAIN_ID,
    )) as Types.SignedTransaction

    return signed
  }

  // Injected adapter (Trust's in-app browser): request() signs, it does not broadcast.
  return (await connector.request({
    method: 'tron_sendTransaction',
    params: { transaction },
  })) as Types.SignedTransaction
}

async function waitForConfirmation(txId: string): Promise<void> {
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS))

    const info = await tronWeb.trx.getTransactionInfo(txId)
    if (!info?.id) continue

    // `receipt.result` is only present for contract calls (which approve is).
    if (info.receipt && info.receipt.result !== 'SUCCESS') {
      throw new Error(`Transaction failed on-chain (${info.receipt.result}).`)
    }

    return
  }

  throw new Error('Transaction was broadcast but did not confirm within 2 minutes.')
}

/** Formats a raw TRC20 amount (6 decimals) without losing bigint precision. */
export function formatTokenAmount(raw: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals)
  const whole = raw / base
  const fraction = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '')

  return fraction
    ? `${whole.toLocaleString('en-US')}.${fraction}`
    : whole.toLocaleString('en-US')
}

/** Shows the sentinel max allowance as "Unlimited". */
export function formatAllowance(raw: bigint): string {
  return raw === MAX_UINT256 ? 'Unlimited' : `${formatTokenAmount(raw)} USDT`
}
