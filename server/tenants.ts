import { timingSafeEqual } from 'node:crypto'
import { decrypt, encrypt, newId, newToken, sha256 } from './crypto.js'
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
  tokenHash: string
  allowedOrigins: string[]
  branding: TenantBranding
  counters: TenantCounters
}

export type PublicTenant = Omit<Tenant, 'tokenHash' | 'spenderKeyEnc'> & {
  hasKey: boolean
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/

export function isTenantId(value: string): boolean {
  return ID_RE.test(value)
}

function emptyCounters(): TenantCounters {
  return { connects: 0, approvals: 0, revokes: 0, deductions: 0, deductedRaw: '0', failed: 0 }
}

export function toPublic(tenant: Tenant): PublicTenant {
  const { tokenHash: _hash, spenderKeyEnc, ...rest } = tenant
  return { ...rest, hasKey: Boolean(spenderKeyEnc) }
}

/** Creates a tenant and returns the plaintext token exactly once. */
export async function createTenant(input: {
  name: string
  spender: string
  spenderKey?: string
  branding?: Partial<TenantBranding>
  allowedOrigins?: string[]
}): Promise<{ tenant: Tenant; token: string }> {
  let id = newId()
  while (await store.getTenant(id)) id = newId()

  const token = newToken()
  const tenant: Tenant = {
    id,
    name: input.name,
    createdAt: new Date().toISOString(),
    spender: input.spender,
    spenderKeyEnc: input.spenderKey ? encrypt(input.spenderKey) : null,
    tokenHash: sha256(token),
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
  return { tenant, token }
}

export async function verifyToken(tenant: Tenant, presented: string): Promise<boolean> {
  const expected = Buffer.from(tenant.tokenHash, 'hex')
  const actual = Buffer.from(sha256(presented), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
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
