const signed = await tronWeb.trx.sign(built.transaction, key)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broadcast: any = await tronWeb.trx.sendRawTransaction(signed)

  if (broadcast?.result === false) {
    const reason = broadcast?.message
      ? Buffer.from(String(broadcast.message), 'hex').toString('utf8')
      : 'TronGrid rejected the transaction.'
    throw new Error(reason)
  }

  const txId = String(broadcast?.txid ?? signed.txID)
  await waitForTransaction(txId)
  return txId
}

async function waitForTransaction(txId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info: any = await tronWeb.trx.getTransactionInfo(txId)
    if (!info?.id) continue

    if (info.receipt && info.receipt.result !== 'SUCCESS') {
      throw new Error(`Transaction failed on-chain (${info.receipt.result}).`)
    }

    return
  }

  throw new Error('Transaction was broadcast but did not confirm within 2 minutes.')
}

/** Parses a decimal USDT string ("12.5") into raw 6-decimal units. */
export function parseUsdtAmount(input: string): bigint {
  const value = input.trim()
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('amount must be a positive decimal number, e.g. 12.5.')
  }

  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > 6) {
    throw new Error('amount supports at most 6 decimals.')
  }

  const raw = BigInt(whole) * 1_000_000n + (fraction ? BigInt(fraction.padEnd(6, '0')) : 0n)

  if (raw <= 0n) {
    throw new Error('amount must be greater than zero.')
  }

  return raw
}

/** Formats raw 6-decimal USDT units for error messages and logs. */
export function formatUsdt(raw: bigint): string {
  const whole = raw / 1_000_000n
  const fraction = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function normalizePrivateKey(value: string): string {
  return value.replace(/^0x/i, '').trim().toLowerCase()
}

function emptyDetails(owner: string): AccountDetails {
  return {
    address: owner,
    hex: null,
    exists: false,
    createdAt: null,
    lastOperationAt: null,
    trxBalance: '0',
    usdtBalance: null,
    tokens: [],
    stakedTrx: '0',
    energy: { limit: 0, used: 0 },
    bandwidth: { freeLimit: 0, freeUsed: 0, stakedLimit: 0, stakedUsed: 0 },
    fetchedAt: new Date().toISOString(),
  }
}

function apiHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    ...(config.trongridApiKey ? { 'TRON-PRO-API-KEY': config.trongridApiKey } : {}),
  }
}

function normalizeHex(value: unknown): string {
  return String(value ?? '')
    .replace(/^0x/i, '')
    .toLowerCase()
}
