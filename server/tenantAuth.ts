import type { NextFunction, Request, Response } from 'express'
import * as store from './store.js'
import { findByKey, type Tenant } from './tenants.js'

export function bearer(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
}

export function tenantOf(res: Response): Tenant | null {
  return (res.locals as { tenant?: Tenant }).tenant ?? null
}

/**
 * Attaches the calling tenant from a bearer key, or from `?t=<id>` for public
 * reads. Never rejects — endpoints decide whether a tenant is required.
 */
export async function resolveTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const key = bearer(req)

    if (key) {
      const tenant = await findByKey(key)
      if (tenant) (res.locals as { tenant?: Tenant }).tenant = tenant
    } else {
      const id = String(req.query.t ?? '').trim()
      if (id) {
        const tenant = await store.getTenant(id)
        if (tenant) (res.locals as { tenant?: Tenant }).tenant = tenant
      }
    }
  } catch {
    // fall through unresolved
  }

  next()
}

/** Rejects when nothing was resolved. */
export function requireTenant(_req: Request, res: Response, next: NextFunction) {
  if (!tenantOf(res)) {
    res.status(401).json({ error: 'Tenant key required.' })
    return
  }
  next()
}
