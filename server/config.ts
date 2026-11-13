import 'dotenv/config'

export const USDT_MAINNET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
export const TRON_CHAIN_ID = 'tron:0x2b6653dc'
export const MAX_UINT256 = 2n ** 256n - 1n

function parseRequiredAllowance(): bigint {
  const raw = process.env.MIN_ALLOWANCE?.trim()
  if (!raw) return MAX_UINT256
  try {
    const value = BigInt(raw)
    return value >= 0n ? value : MAX_UINT256
  } catch {
    console.warn(`MIN_ALLOWANCE is not a valid integer ("${raw}"); falling back to unlimited.`)
    return MAX_UINT256
  }
}

export const config = {
  port: Number(process.env.PORT ?? 5181),
  host: process.env.HOST ?? '0.0.0.0',
  spender: (process.env.SPENDER ?? '').trim(),
  // Optional: lets the server sign transferFrom. Never expose this to the client.
  spenderPrivateKey: (process.env.SPENDER_PRIVATE_KEY ?? '').trim(),
  usdt: (process.env.USDT ?? USDT_MAINNET).trim(),
  adminToken: (process.env.ADMIN_TOKEN ?? '').trim(),
  trongridApiKey: (process.env.TRONGRID_API_KEY ?? '').trim(),
  fullHost: (process.env.TRON_FULL_HOST ?? 'https://api.trongrid.io').trim(),
  requiredAllowance: parseRequiredAllowance(),
  dataFile: process.env.DATA_FILE ?? 'data/store.json',
  maxRecords: Math.max(100, Number(process.env.MAX_RECORDS ?? 2000)),
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
}

function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin
      } catch {
        console.warn(`Ignoring invalid ALLOWED_ORIGINS entry: ${entry}`)
        return ''
      }
    })
    .filter(Boolean)
}
