import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'

const MASTER = process.env.SECRET_KEY?.trim() ?? ''

function key(): Buffer {
  if (!MASTER || MASTER.length < 32) {
    throw new Error('SECRET_KEY must be set to at least 32 characters.')
  }
  // Fixed salt: one master key, deterministic derivation.
  return scryptSync(MASTER, 'tron-connect-tenant-keys', 32)
}

/** AES-256-GCM. Returns base64 iv:tag:ciphertext. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, body].map((part) => part.toString('base64')).join(':')
}

export function decrypt(payload: string): string {
  const [ivPart, tagPart, bodyPart] = payload.split(':')
  if (!ivPart || !tagPart || !bodyPart) throw new Error('Malformed ciphertext.')

  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivPart, 'base64'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(bodyPart, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function newToken(): string {
  return randomBytes(24).toString('hex')
}

export function newId(): string {
  return randomBytes(6).toString('hex')
}
