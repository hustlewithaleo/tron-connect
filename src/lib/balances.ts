// Read-only TRX/USDT balance lookups from TronGrid. No wallet approval needed.
import { USDT } from './usdt'

const API = 'https://api.trongrid.io'
// TRX and USDT both use 6 decimals.
const DECIMALS = 1e6

export type Balances = { trx: number; usdt: number }

export async function getBalances(address: string): Promise<Balances> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const apiKey = import.meta.env.VITE_TRONGRID_API_KEY
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey

  const url = `${API}/v1/accounts/${address}`
  let res = await fetch(url, { headers })

  // Without an API key TronGrid rate-limits quickly, so retry once after a short pause.
  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    res = await fetch(url, { headers })
  }
  if (res.status === 429) {
    throw new Error('TronGrid rate limit hit. Wait a few seconds and refresh.')
  }
  if (!res.ok) {
    throw new Error(`Could not load balance (TronGrid returned ${res.status}).`)
  }

  const body = (await res.json()) as {
    data?: Array<{ balance?: number; trc20?: Array<Record<string, string>> }>
  }

  // A brand-new address that has never received anything comes back with no data.
  const account = body.data?.[0]
  if (!account) return { trx: 0, usdt: 0 }

  const trx = (account.balance ?? 0) / DECIMALS
  const entry = (account.trc20 ?? []).find((token) => USDT in token)
  const usdt = entry ? Number(entry[USDT]) / DECIMALS : 0

  return { trx, usdt }
}

export function formatAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}
