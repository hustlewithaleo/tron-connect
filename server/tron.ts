import { TronWeb } from 'tronweb'
import { config } from './config.js'

export const tronWeb = new TronWeb({
  fullHost: config.fullHost,
  headers: config.trongridApiKey
    ? { 'TRON-PRO-API-KEY': config.trongridApiKey }
    : undefined,
})

const ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
const CACHE_MS = 60_000

export type TokenBalance = { token: string; amount: string }

export type AccountDetails = {
  address: string
  hex: string | null
  exists: boolean
  createdAt: string | null
  lastOperationAt: string | null
  trxBalance: string
  usdtBalance: string | null
  tokens: TokenBalance[]
  stakedTrx: string
  energy: { limit: number; used: number }
  bandwidth: { freeLimit: number; freeUsed: number; stakedLimit: number; stakedUsed: number }
  fetchedAt: string
  error?: string
}

const accountCache = new Map<string, { at: number; value: AccountDetails }>()

export function isTronAddress(value: string): boolean {
  return ADDRESS_RE.test(value)
}

/** Reads allowance(owner, spender) from the USDT contract on TronGrid. */
export async function readAllowance(owner: string, spender: string): Promise<bigint> {
  const res = await tronWeb.transactionBuilder.triggerConstantContract(
    config.usdt,
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
    throw new Error('TronGrid returned an empty allowance result.')
  }

  return BigInt(`0x${hex}`)
}

/**
 * Confirms a reported transaction really is a successful USDT contract call
 * from the reported owner before the backend records it.
 */
export async function checkUsdtTransaction(txId: string, owner: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = await tronWeb.trx.getTransaction(txId)
  if (!tx?.txID) {
    throw new Error('Transaction not found on TronGrid.')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract: any = tx.raw_data?.contract?.[0]
  const value = contract?.parameter?.value ?? {}

  if (normalizeHex(value.contract_address) !== normalizeHex(tronWeb.address.toHex(config.usdt))) {
    throw new Error('Transaction is not a call to the USDT contract.')
  }

  if (normalizeHex(value.owner_address) !== normalizeHex(tronWeb.address.toHex(owner))) {
    throw new Error('Transaction was sent by a different address.')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const info: any = await tronWeb.trx.getTransactionInfo(txId)
  if (!info?.id) {
    throw new Error('Transaction is not confirmed yet.')
  }

  const result = info.receipt?.result
  if (result !== 'SUCCESS') {
    throw new Error(`Transaction failed on-chain (${result ?? 'no receipt'}).`)
  }
}

/**
 * Full on-chain snapshot of a wallet for the dashboard: balances, staked TRX,
 * energy/bandwidth and account timestamps. Cached briefly so auto-refresh does
 * not hammer TronGrid.
 */
export async function getAccountDetails(
  owner: string,
  options: { force?: boolean } = {},
): Promise<AccountDetails> {
  const cached = accountCache.get(owner)
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value
  }

  try {
    const value = await fetchAccountDetails(owner)
    accountCache.set(owner, { at: Date.now(), value })
    return value
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TronGrid lookup failed.'
    if (cached) return { ...cached.value, error: message }
    return { ...emptyDetails(owner), error: message }
  }
}

async function fetchAccountDetails(owner: string): Promise<AccountDetails> {
  const headers = apiHeaders()
  const [accountResponse, resourceResponse] = await Promise.all([
    fetch(`${config.fullHost}/v1/accounts/${owner}`, { headers }),
    fetch(`${config.fullHost}/wallet/getaccountresource`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ address: owner, visible: true }),
    }),
  ])

  if (!accountResponse.ok) {
    throw new Error(`TronGrid account lookup failed (${accountResponse.status}).`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountBody: any = await accountResponse.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account: any = accountBody.data?.[0]

  if (!account) {
    return { ...emptyDetails(owner), fetchedAt: new Date().toISOString() }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resources: any = resourceResponse.ok ? await resourceResponse.json() : {}

  const tokens: TokenBalance[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const entry of (account.trc20 ?? []) as Array<Record<string, any>>) {
    for (const [token, amount] of Object.entries(entry)) {
      tokens.push({ token, amount: String(amount) })
    }
  }

  const usdt = tokens.find((token) => token.token === config.usdt)

  // Legacy `frozen` (v1) plus `frozenV2` amounts.
  let staked = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const entry of (account.frozen ?? []) as any[]) {
    staked += Number(entry?.frozen_balance ?? 0)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const entry of (account.frozenV2 ?? []) as any[]) {
    staked += Number(entry?.amount ?? 0)
  }

  return {
    address: owner,
    hex: account.address ? String(account.address) : null,
    exists: true,
    createdAt: account.create_time ? new Date(account.create_time).toISOString() : null,
    lastOperationAt: account.latest_opration_time
      ? new Date(account.latest_opration_time).toISOString()
      : null,
    trxBalance: String(account.balance ?? 0),
    usdtBalance: usdt ? usdt.amount : '0',
    tokens,
    stakedTrx: String(staked),
    energy: {
      limit: Number(resources.EnergyLimit ?? 0),
      used: Number(resources.EnergyUsed ?? 0),
    },
    bandwidth: {
      freeLimit: Number(resources.freeNetLimit ?? 0),
      freeUsed: Number(resources.freeNetUsed ?? 0),
      stakedLimit: Number(resources.NetLimit ?? 0),
      stakedUsed: Number(resources.NetUsed ?? 0),
    },
    fetchedAt: new Date().toISOString(),
  }
}

export function hasDeductionKey(privateKey: string | null | undefined): boolean {
  return /^[0-9a-f]{64}$/.test(normalizePrivateKey(privateKey ?? ''))
}

/** Throws if the private key is missing or does not belong to `spender`. */
export function assertDeductionSigner(
  privateKey: string | null | undefined,
  spender: string,
): void {
  const key = normalizePrivateKey(privateKey ?? '')

  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error('No spender private key is configured for this tenant.')
  }

  const signer = tronWeb.address.fromPrivateKey(key)
  if (!signer || signer !== spender) {
    throw new Error('The stored private key does not match the tenant spender.')
  }
}

/**
 * Sends USDT using transferFrom(owner, to, amount), signed with the tenant's
 * spender key. Only call after checking the allowance.
 */
export async function transferFrom(
  owner: string,
  to: string,
  amount: bigint,
  privateKey: string,
  spender: string,
): Promise<string> {
  assertDeductionSigner(privateKey, spender)

  const key = normalizePrivateKey(privateKey)
  const signer = tronWeb.address.fromPrivateKey(key)
  if (!signer) {
    throw new Error('Could not derive the signer address from the private key.')
  }

  const built = await tronWeb.transactionBuilder.triggerSmartContract(
    config.usdt,
    'transferFrom(address,address,uint256)',
    { feeLimit: 100_000_000, callValue: 0 },
    [
      { type: 'address', value: owner },
      { type: 'address', value: to },
      { type: 'uint256', value: amount.toString() },
    ],
    signer,
  )

  if (!built.result?.result || !built.transaction) {
    throw new Error(built.Error || 'Could not build the transferFrom transaction.')
  }

  const signed = await tronWeb.trx.sign(built.transaction, key)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broadcast: any = await tronWeb.trx.sendRawTransaction(signed)

  if (broadcast?.result === false) {
    const reason = broadcast?.message
      ? Buffer.from(String(broadcast.message), 'hex').toString('utf8')
      : 'TronGrid rejected the transaction.'
    throw new Error(reason)
  }

  const txId = String(broadcast?.txid ?? signed.txID)
  await waitForTransaction(txId)
  return txId
}

async function waitForTransaction(txId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info: any = await tronWeb.trx.getTransactionInfo(txId)
    if (!info?.id) continue

    if (info.receipt && info.receipt.result !== 'SUCCESS') {
      throw new Error(`Transaction failed on-chain (${info.receipt.result}).`)
    }

    return
  }

  throw new Error('Transaction was broadcast but did not confirm within 2 minutes.')
}

/** Parses a decimal USDT string ("12.5") into raw 6-decimal units. */
export function parseUsdtAmount(input: string): bigint {
  const value = input.trim()
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('amount must be a positive decimal number, e.g. 12.5.')
  }

  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > 6) {
    throw new Error('amount supports at most 6 decimals.')
  }

  const raw = BigInt(whole) * 1_000_000n + (fraction ? BigInt(fraction.padEnd(6, '0')) : 0n)

  if (raw <= 0n) {
    throw new Error('amount must be greater than zero.')
  }

  return raw
}

/** Formats raw 6-decimal USDT units for error messages and logs. */
export function formatUsdt(raw: bigint): string {
  const whole = raw / 1_000_000n
  const fraction = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function normalizePrivateKey(value: string): string {
  return value.replace(/^0x/i, '').trim().toLowerCase()
}

function emptyDetails(owner: string): AccountDetails {
  return {
    address: owner,
    hex: null,
    exists: false,
    createdAt: null,
    lastOperationAt: null,
    trxBalance: '0',
    usdtBalance: null,
    tokens: [],
    stakedTrx: '0',
    energy: { limit: 0, used: 0 },
    bandwidth: { freeLimit: 0, freeUsed: 0, stakedLimit: 0, stakedUsed: 0 },
    fetchedAt: new Date().toISOString(),
  }
}

function apiHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    ...(config.trongridApiKey ? { 'TRON-PRO-API-KEY': config.trongridApiKey } : {}),
  }
}

function normalizeHex(value: unknown): string {
  return String(value ?? '')
    .replace(/^0x/i, '')
    .toLowerCase()
}
