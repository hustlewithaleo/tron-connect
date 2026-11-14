const BASE = '/api'

export type ServerConfig = {
  spender: string
  usdt: string
  required: string
  network: string
  configured: boolean
  canDeduct?: boolean
  storage?: 'redis' | 'memory' | 'file'
}

export type Verification = {
  owner: string
  spender: string
  usdt: string
  allowance: string
  required: string
  sufficient: boolean
  checkedAt: string
}

export type ApprovalAction = 'approve' | 'revoke' | 'reset' | 'deduct'

export type PublicBranding = {
  name: string
  description: string
  url: string | null
  iconUrl: string
  updatedAt: string | null
}

export type AdminBranding = PublicBranding & {
  hasIcon: boolean
  currentOrigin: string
  allowedOrigins: string[]
}

export type ApprovalEvent = {
  id: string
  owner: string
  txId: string
  action: ApprovalAction
  amount: string
  status: 'confirmed' | 'failed'
  allowanceAfter: string | null
  error?: string
  at: string
  ip: string
}

export type VerificationRow = {
  id: string
  owner: string
  spender: string
  allowance: string
  sufficient: boolean
  at: string
  ip: string
}

export type WalletRow = {
  owner: string
  allowance: string | null
  sufficient: boolean
  lastCheckedAt: string
  checks: number
  activity: WalletActivity
  onchain: AccountDetails
}

export type WalletActivity = {
  events: number
  approvals: number
  revokes: number
  resets: number
  deductions: number
  failed: number
  lastEvent: ApprovalEvent | null
}

export type TokenBalance = { token: string; amount: string }

export type AccountDetails = {
  address: string
  hex: string | null
  exists: boolean
  createdAt: string | null
  lastOperationAt: string | null
  trxBalance: string
  usdtBalance: string | null
  tokens: TokenBalance[]
  stakedTrx: string
  energy: { limit: number; used: number }
  bandwidth: { freeLimit: number; freeUsed: number; stakedLimit: number; stakedUsed: number }
  fetchedAt: string
  error?: string
}

export type AdminSummary = {
  totals: {
    verifications: number
    events: number
    approvals: number
    revokes: number
    resets: number
    deductions: number
    failed: number
    wallets: number
    sufficientWallets: number
    retainedVerifications: number
    retainedEvents: number
  }
  wallets: WalletRow[]
  verifications: VerificationRow[]
  events: ApprovalEvent[]
  config: ServerConfig
  serverStartedAt: string
  generatedAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const body = (await res.json().catch(() => ({}))) as { error?: string }

  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (${res.status}).`)
  }

  return body as T
}

export function getConfig(): Promise<ServerConfig> {
  return request<ServerConfig>('/config')
}

export function getBranding(): Promise<PublicBranding> {
  return request<PublicBranding>('/branding')
}

export function getAdminBranding(token: string): Promise<AdminBranding> {
  return request<AdminBranding>('/admin/branding', {
    headers: { authorization: `Bearer ${token}` },
  })
}

export function saveBranding(
  token: string,
  input: {
    name: string
    description: string
    url: string
    iconDataUrl?: string
    removeIcon?: boolean
  },
): Promise<AdminBranding> {
  return request<AdminBranding>('/admin/branding', {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
}

export function verifyAllowance(owner: string): Promise<Verification> {
  return request<Verification>(`/verify?owner=${encodeURIComponent(owner)}`)
}

export function requestEnergy(owner: string): Promise<{ rented: boolean; reason?: string }> {
  return request('/energy', { method: 'POST', body: JSON.stringify({ owner }) })
}

export function reportEvent(input: {
  owner: string
  txId: string
  action: ApprovalAction
  amount: string
}): Promise<ApprovalEvent> {
  return request<ApprovalEvent>('/events', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getAdminSummary(token: string, forceRefresh = false): Promise<AdminSummary> {
  return request<AdminSummary>(`/admin/summary${forceRefresh ? '?refresh=1' : ''}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

export async function downloadAdminExport(token: string): Promise<Blob> {
  const res = await fetch(`${BASE}/admin/export`, {
    headers: { authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Export failed (${res.status}).`)
  }

  return res.blob()
}

export type DeductResult = {
  txId: string
  owner: string
  to: string
  amount: string
  allowanceAfter: string
  event: ApprovalEvent
}

export function deductUsdt(
  token: string,
  input: { owner: string; amount: string; to?: string },
): Promise<DeductResult> {
  return request<DeductResult>('/admin/deduct', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
}
