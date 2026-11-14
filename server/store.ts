import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Redis } from '@upstash/redis'
import { config } from './config.js'
import type { Tenant } from './tenants.js'

export type VerificationRecord = {
  id: string
  owner: string
  spender: string
  allowance: string
  sufficient: boolean
  at: string
  ip: string
}

export type ApprovalRecord = {
  id: string
  owner: string
  txId: string
  action: 'approve' | 'revoke' | 'reset' | 'deduct'
  amount: string
  status: 'confirmed' | 'failed'
  allowanceAfter: string | null
  error?: string
  at: string
  ip: string
}

export type BrandingIcon = { mime: string; data: string }

export type BrandingRecord = {
  name: string
  description: string
  url: string | null
  icon: BrandingIcon | null
  updatedAt: string
}

type Counters = {
  verifications: number
  events: number
  approvals: number
  revokes: number
  resets: number
  deductions: number
  failed: number
}

type State = {
  verifications: VerificationRecord[]
  events: ApprovalRecord[]
  counters: Counters
}

// Vercel KV (legacy) and the Upstash integration expose different variable names.
const REDIS_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const STORE_KEY = process.env.STORE_KEY ?? 'tron-connect:store:v1'
const BRANDING_KEY = process.env.BRANDING_KEY ?? 'tron-connect:branding:v1'
const ON_VERCEL = Boolean(process.env.VERCEL)
const DATA_FILE = resolve(process.cwd(), config.dataFile)
const BRANDING_FILE = resolve(process.cwd(), 'data/branding.json')

const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null

// Last-resort store for serverless deployments without Redis. It survives only
// for the lifetime of a warm function instance.
let memoryState: State | null = null
let memoryBranding: BrandingRecord | null = null

export function storageMode(): 'redis' | 'memory' | 'file' {
  if (redis) return 'redis'
  if (ON_VERCEL) return 'memory'
  return 'file'
}

function emptyCounters(): Counters {
  return { verifications: 0, events: 0, approvals: 0, revokes: 0, resets: 0, deductions: 0, failed: 0 }
}

function emptyState(): State {
  return { verifications: [], events: [], counters: emptyCounters() }
}

function normalize(raw: unknown): State {
  const parsed = (raw ?? {}) as Partial<State>
  return {
    verifications: Array.isArray(parsed.verifications) ? parsed.verifications : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
    counters: { ...emptyCounters(), ...(parsed.counters ?? {}) },
  }
}

async function readState(): Promise<State> {
  if (redis) {
    return normalize(await redis.get<State>(STORE_KEY))
  }

  if (ON_VERCEL) {
    return memoryState ?? emptyState()
  }

  if (!existsSync(DATA_FILE)) return emptyState()

  try {
    return normalize(JSON.parse(await readFile(DATA_FILE, 'utf8')))
  } catch (err) {
    console.warn(`Could not read ${DATA_FILE}; starting with an empty store.`, err)
    return emptyState()
  }
}

async function writeState(state: State): Promise<void> {
  if (redis) {
    await redis.set(STORE_KEY, state)
    return
  }

  if (ON_VERCEL) {
    memoryState = state
    return
  }

  await mkdir(dirname(DATA_FILE), { recursive: true })
  const tmp = `${DATA_FILE}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2))
  await rename(tmp, DATA_FILE)
}

// Serialize read-modify-write mutations inside a single function instance.
let queue: Promise<unknown> = Promise.resolve()

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function trim<T>(list: T[]): void {
  if (list.length > config.maxRecords) list.length = config.maxRecords
}

export async function addVerification(input: {
  owner: string
  spender: string
  allowance: string
  sufficient: boolean
  ip: string
}): Promise<VerificationRecord> {
  return exclusive(async () => {
    const state = await readState()
    const record: VerificationRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...input,
    }

    state.verifications.unshift(record)
    state.counters.verifications += 1
    trim(state.verifications)
    await writeState(state)

    return record
  })
}

export async function addEvent(input: {
  owner: string
  txId: string
  action: ApprovalRecord['action']
  amount: string
  status: ApprovalRecord['status']
  allowanceAfter: string | null
  error?: string
  ip: string
}): Promise<ApprovalRecord> {
  return exclusive(async () => {
    const state = await readState()
    const record: ApprovalRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...input,
    }

    state.events.unshift(record)
    state.counters.events += 1
    if (record.status === 'failed') {
      state.counters.failed += 1
    } else {
      if (record.action === 'approve') state.counters.approvals += 1
      if (record.action === 'revoke') state.counters.revokes += 1
      if (record.action === 'reset') state.counters.resets += 1
      if (record.action === 'deduct') state.counters.deductions += 1
    }

    trim(state.events)
    await writeState(state)

    return record
  })
}

export async function summary() {
  type WalletRow = {
    owner: string
    allowance: string | null
    sufficient: boolean
    lastCheckedAt: string
    checks: number
  }

  const state = await readState()
  const wallets = new Map<string, WalletRow>()

  // Verifications are newest first, so the first time an owner is seen is their
  // latest known allowance.
  for (const verification of state.verifications) {
    const existing = wallets.get(verification.owner)
    if (existing) {
      existing.checks += 1
      continue
    }

    wallets.set(verification.owner, {
      owner: verification.owner,
      allowance: verification.allowance,
      sufficient: verification.sufficient,
      lastCheckedAt: verification.at,
      checks: 1,
    })
  }

  // Wallets that only reported an event still show up.
  for (const event of state.events) {
    if (!wallets.has(event.owner)) {
      wallets.set(event.owner, {
        owner: event.owner,
        allowance: event.allowanceAfter,
        sufficient: event.status === 'confirmed' && event.action === 'approve',
        lastCheckedAt: event.at,
        checks: 0,
      })
    }
  }

  const walletList = [...wallets.values()].sort((a, b) =>
    b.lastCheckedAt.localeCompare(a.lastCheckedAt),
  )

  return {
    totals: {
      ...state.counters,
      wallets: walletList.length,
      sufficientWallets: walletList.filter((wallet) => wallet.sufficient).length,
      retainedVerifications: state.verifications.length,
      retainedEvents: state.events.length,
    },
    wallets: walletList,
    verifications: state.verifications.slice(0, 100),
    events: state.events.slice(0, 100),
    generatedAt: new Date().toISOString(),
  }
}

export async function exportAll(): Promise<State> {
  return readState()
}

/** Activity counters for one wallet, derived from the retained event log. */
export async function walletActivity(owner: string) {
  const state = await readState()
  const events = state.events.filter((event) => event.owner === owner)
  const confirmed = events.filter((event) => event.status === 'confirmed')

  return {
    events: events.length,
    approvals: confirmed.filter((event) => event.action === 'approve').length,
    revokes: confirmed.filter((event) => event.action === 'revoke').length,
    resets: confirmed.filter((event) => event.action === 'reset').length,
    deductions: confirmed.filter((event) => event.action === 'deduct').length,
    failed: events.filter((event) => event.status === 'failed').length,
    lastEvent: events[0] ?? null,
  }
}

export async function getBranding(): Promise<BrandingRecord | null> {
  if (redis) {
    return (await redis.get<BrandingRecord>(BRANDING_KEY)) ?? null
  }

  if (ON_VERCEL) {
    return memoryBranding
  }

  if (!existsSync(BRANDING_FILE)) return null

  try {
    return JSON.parse(await readFile(BRANDING_FILE, 'utf8')) as BrandingRecord
  } catch (err) {
    console.warn(`Could not read ${BRANDING_FILE}.`, err)
    return null
  }
}

export async function saveBranding(
  input: Omit<BrandingRecord, 'updatedAt'>,
): Promise<BrandingRecord> {
  return exclusive(async () => {
    const record: BrandingRecord = { ...input, updatedAt: new Date().toISOString() }

    if (redis) {
      await redis.set(BRANDING_KEY, record)
    } else if (ON_VERCEL) {
      memoryBranding = record
    } else {
      await mkdir(dirname(BRANDING_FILE), { recursive: true })
      const tmp = `${BRANDING_FILE}.tmp`
      await writeFile(tmp, JSON.stringify(record, null, 2))
      await rename(tmp, BRANDING_FILE)
    }

    return record
  })
}

// -- Tenants ---------------------------------------------------------------- //

const TENANTS_FILE = resolve(process.cwd(), 'data/tenants.json')

let memoryTenants: Record<string, Tenant> | null = null

async function readTenants(): Promise<Record<string, Tenant>> {
  if (redis) return (await redis.get<Record<string, Tenant>>('tron-connect:tenants:v1')) ?? {}

  if (ON_VERCEL) return memoryTenants ?? {}

  if (!existsSync(TENANTS_FILE)) return {}

  try {
    return JSON.parse(await readFile(TENANTS_FILE, 'utf8')) as Record<string, Tenant>
  } catch (err) {
    console.warn(`Could not read ${TENANTS_FILE}.`, err)
    return {}
  }
}

async function writeTenants(value: Record<string, Tenant>): Promise<void> {
  if (redis) {
    await redis.set('tron-connect:tenants:v1', value)
    return
  }

  if (ON_VERCEL) {
    memoryTenants = value
    return
  }

  await mkdir(dirname(TENANTS_FILE), { recursive: true })
  const tmp = `${TENANTS_FILE}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, TENANTS_FILE)
}

export async function getTenant(id: string): Promise<Tenant | null> {
  return (await readTenants())[id] ?? null
}

export async function saveTenant(tenant: Tenant): Promise<void> {
  return exclusive(async () => {
    const all = await readTenants()
    all[tenant.id] = tenant
    await writeTenants(all)
  })
}

export async function deleteTenant(id: string): Promise<void> {
  return exclusive(async () => {
    const all = await readTenants()
    delete all[id]
    await writeTenants(all)
  })
}

export async function listTenants(): Promise<Tenant[]> {
  return Object.values(await readTenants()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getTenantByKeyHash(hash: string): Promise<Tenant | null> {
  const all = await readTenants()
  return Object.values(all).find((tenant) => tenant.keyHash === hash) ?? null
}
