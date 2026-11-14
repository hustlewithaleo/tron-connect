import { Router, type Request } from 'express'
import * as store from './store.js'

function pageOrigin(req: Request): string {
  const origin = (req.header('origin') ?? '').trim()
  if (origin) return origin

  try {
    return new URL(req.header('referer') ?? '').origin
  } catch {
    return ''
  }
}

export const embedRouter = Router()

/**
 * Public, CORS-enabled config for the embed button. When a tenant has
 * allowedOrigins, only those origins may render it.
 */
embedRouter.get('/:id', async (req, res) => {
  const tenant = await store.getTenant(String(req.params.id))
  if (!tenant) {
    res.status(404).json({ error: 'Unknown tenant.' })
    return
  }

  const origin = pageOrigin(req)
  const allowed = tenant.allowedOrigins

  if (origin) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
  }

  if (allowed.length > 0 && origin && !allowed.includes(origin)) {
    res.status(403).json({ error: `Origin ${origin} is not allowed for this panel.`, allowed })
    return
  }

  const proto = (req.header('x-forwarded-proto') ?? 'https').split(',')[0].trim()
  const host = req.header('x-forwarded-host') ?? req.header('host') ?? ''

  res.json({
    id: tenant.id,
    name: tenant.branding.name,
    label: 'Approve USDT',
    url: `${proto}://${host}/t/${tenant.id}`,
  })
})
