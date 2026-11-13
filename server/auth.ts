import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { config } from './config.js'

/**
 * Admin endpoints are disabled until ADMIN_TOKEN is set. Accepts either
 * `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  const header = req.header('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const token = bearer || (req.header('x-admin-token') ?? '').trim()

  if (!config.adminToken || !token || !safeEqual(token, config.adminToken)) {
    res.status(401).json({
      error: 'Unauthorized. Set ADMIN_TOKEN in .env and paste the same token here.',
    })
    return
  }

  next()
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
