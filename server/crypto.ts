import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'

const MASTER = process.env.SECRET_KEY?.trim() ?? ''
// No I, O, 0, 1 — avoids transcription errors in keys.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function key(): Buffer {
  if (!MASTER || MASTER.length < 32) {
    throw new Error('SECRET_KEY must be set to at least 32 characters.')
  }
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

function group(size: number): string {
  const bytes = randomBytes(size)
  let out = ''
  for (let index = 0; index < size; index++) {
    out += ALPHABET[bytes[index] % ALPHABET.length]
  }
  return out
}

/** Human-typed login key, e.g. EXAMPLE-02FRAZ-23219. */
export function newKey(): string {
  return `${group(6)}-${group(6)}-${group(5)}`
}

/** Short public id used in the embed snippet. */
export function newId(): string {
  const bytes = randomBytes(6)
  let out = ''
  for (let index = 0; index < 6; index++) {
    out += 'abcdefghijklmnopqrstuvwxyz0123456789'[bytes[index] % 36]
  }
  return out
}

export function normalizeKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}
