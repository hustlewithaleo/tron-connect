import { timingSafeEqual } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { TRON_CHAIN_ID } from './config.js'
import { newKey, sha256 } from './crypto.js'
import * as store from './store.js'
import { createTenant, toPublic, type Tenant } from './tenants.js'
import { isTronAddress } from './tron.js'

const NAME_RE = /^[\w .'-]{2,40}$/

function platformToken(): string {
  return process.env.PLATFORM_TOKEN?.trim() ?? ''
}

function requirePlatform(req: Request, res: Response, next: NextFunction) {
  const expected = platformToken()
  if (!expected) {
    res.status(503).json({ error: 'PLATFORM_TOKEN is not set on the server.' })
    return
  }

  const presented = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const a = Buffer.from(sha256(expected), 'hex')
  const b = Buffer.from(sha256(presented), 'hex')

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }

  next()
}

function snippetFor(req: Request, id: string): string {
  const proto = (req.header('x-forwarded-proto') ?? 'https').split(',')[0].trim()
  const host = req.header('x-forwarded-host') ?? req.header('host') ?? ''
  const origin = `${proto}://${host}`

  return `<script src="${origin}/embed.js" data-tenant="${id}" data-label="Approve USDT"></script>`
}

function parseOrigins(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.join(',') : String(input ?? '')
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin
      } catch {
        return null
      }
    })
    .filter((value): value is string => Boolean(value))
}

export const platformRouter = Router()

platformRouter.use(requirePlatform)

platformRouter.get('/tenants', async (_req: Request, res: Response) => {
  const tenants = await store.listTenants()
  res.json({ tenants: tenants.map(toPublic) })
})

platformRouter.post('/tenants', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const name = String(body.name ?? '').trim()
  const spender = String(body.spender ?? '').trim()
  const spenderKey = String(body.spenderKey ?? '').trim().replace(/^0x/i, '').toLowerCase()

  if (!NAME_RE.test(name)) {
    res.status(400).json({ error: 'name must be 2-40 characters.' })
    return
  }
  if (!isTronAddress(spender)) {
    res.status(400).json({ error: 'spender must be a base58 Tron address.' })
    return
  }
  if (spenderKey && !/^[0-9a-f]{64}$/.test(spenderKey)) {
    res.status(400).json({ error: 'spenderKey must be 64 hex characters.' })
    return
  }

  const { tenant, key } = await createTenant({
    name,
    spender,
    spenderKey: spenderKey || undefined,
    allowedOrigins: parseOrigins(body.allowedOrigins),
  })

  res.status(201).json({
    tenant: toPublic(tenant),
    key,
    snippet: snippetFor(req, tenant.id),
    warning: 'The key is shown once. Store it now.',
  })
})

platformRouter.post('/tenants/:id/rotate', async (req: Request, res: Response) => {
  const tenant: Tenant | null = await store.getTenant(String(req.params.id))
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found.' })
    return
  }

  const key = newKey()
  tenant.keyHash = sha256(key)
  await store.saveTenant(tenant)

  res.json({ key, warning: 'The previous key stops working immediately.' })
})

platformRouter.delete('/tenants/:id', async (req: Request, res: Response) => {
  const tenant = await store.getTenant(String(req.params.id))
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found.' })
    return
  }

  await store.deleteTenant(tenant.id)
  res.json({ ok: true })
})

/** Public: tenant metadata for the embed and the approval page. */
export const publicTenantRouter = Router()

publicTenantRouter.get('/:id', async (req: Request, res: Response) => {
  const tenant = await store.getTenant(String(req.params.id))
  if (!tenant) {
    res.status(404).json({ error: 'Unknown tenant.' })
    return
  }

  res.json({
    id: tenant.id,
    name: tenant.branding.name,
    description: tenant.branding.description,
    url: tenant.branding.url,
    spender: tenant.spender,
    network: TRON_CHAIN_ID,
  })
})
