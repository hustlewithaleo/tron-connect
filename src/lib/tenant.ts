let active: string | null = null

export function setTenant(id: string | null) {
  active = id
}

export function activeTenant(): string | null {
  return active
}

/** Appends ?t=<id> to public paths when a tenant page is mounted. */
export function scoped(path: string): string {
  if (!active) return path
  if (path.startsWith('/admin') || path.startsWith('/platform')) return path
  return `${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(active)}`
}
