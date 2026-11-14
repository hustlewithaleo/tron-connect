import { timingSafeEqual } from 'node:crypto'
import { decrypt, encrypt, newId, newKey, normalizeKey, sha256 } from './crypto.js'
import * as store from './store.js'

export type TenantCounters = {
  connects: number
  approvals: number
  revokes: number
  deductions: number
  deductedRaw: string
  failed: number
}

export type TenantBranding = {
  name: string
  description: string
  url: string | null
  icon: { mime: string; data: string } | null
}

export type Tenant = {
  id: string
  name: string
  createdAt: string
  spender: string
  spenderKeyEnc: string | null
  keyHash: string
  allowedOrigins: string[]
  branding: TenantBranding
  counters: TenantCounters
}

export type PublicTenant = Omit<Tenant, 'keyHash' | 'spenderKeyEnc'> & { hasKey: boolean }

export function emptyCounters(): TenantCounters {
  return { connects: 0, approvals: 0, revokes: 0, deductions: 0, deductedRaw: '0', failed: 0 }
}

export function toPublic(tenant: Tenant): PublicTenant {
  const { keyHash: _k, spenderKeyEnc, ...rest } = tenant
  return { ...rest, hasKey: Boolean(spenderKeyEnc) }
}

/** Creates a tenant. The plaintext key is returned once and never stored. */
export async function createTenant(input: {
  name: string
  spender: string
  spenderKey?: string
  branding?: Partial<TenantBranding>
  allowedOrigins?: string[]
}): Promise<{ tenant: Tenant; key: string }> {
  let id = newId()
  while (await store.getTenant(id)) id = newId()

  const key = newKey()
  const tenant: Tenant = {
    id,
    name: input.name,
    createdAt: new Date().toISOString(),
    spender: input.spender,
    spenderKeyEnc: input.spenderKey ? encrypt(input.spenderKey) : null,
    keyHash: sha256(key),
    allowedOrigins: input.allowedOrigins ?? [],
    branding: {
      name: input.branding?.name ?? input.name,
      description: input.branding?.description ?? 'USDT approval',
      url: input.branding?.url ?? null,
      icon: input.branding?.icon ?? null,
    },
    counters: emptyCounters(),
  }

  await store.saveTenant(tenant)
  return { tenant, key }
}

/** Resolves a presented login key to its tenant, or null. */
export async function findByKey(presented: string): Promise<Tenant | null> {
  const hash = sha256(normalizeKey(presented))
  const tenant = await store.getTenantByKeyHash(hash)
  if (!tenant) return null

  const expected = Buffer.from(tenant.keyHash, 'hex')
  const actual = Buffer.from(hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? tenant : null
}

export async function getSpenderKey(tenant: Tenant): Promise<string | null> {
  return tenant.spenderKeyEnc ? decrypt(tenant.spenderKeyEnc) : null
}

export async function bumpCounter(
  tenantId: string,
  field: keyof TenantCounters,
  amount = 1,
): Promise<void> {
  const tenant = await store.getTenant(tenantId)
  if (!tenant) return

  if (field === 'deductedRaw') {
    tenant.counters.deductedRaw = (BigInt(tenant.counters.deductedRaw) + BigInt(amount)).toString()
  } else {
    tenant.counters[field] += amount
  }

  await store.saveTenant(tenant)
}
