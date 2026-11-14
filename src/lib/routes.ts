export type Route =
  | { name: 'home' }
  | { name: 'admin' }
  | { name: 'platform' }
  | { name: 'dash' }
  | { name: 'tenant'; id: string }

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/') return { name: 'home' }
  if (path === '/admin') return { name: 'admin' }
  if (path === '/platform') return { name: 'platform' }
  if (path === '/dash') return { name: 'dash' }

  const tenant = /^\/t\/([a-z0-9]+)$/.exec(path)
  if (tenant) return { name: 'tenant', id: tenant[1] }

  return { name: 'home' }
}
