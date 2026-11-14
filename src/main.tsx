import { createRoot } from 'react-dom/client'
import { ensureAppKit } from './lib/appkit'
import { parseRoute } from './lib/routes'
import './style.css'
import './dash.css'

const route = parseRoute(window.location.pathname)

async function start() {
  await ensureAppKit()

  const { default: Root } =
    route.name === 'admin'
      ? await import('./AdminApp')
      : route.name === 'platform'
        ? await import('./Platform')
        : route.name === 'dash'
          ? await import('./Dashboard')
          : route.name === 'tenant'
            ? await import('./TenantPage')
            : await import('./App')

  createRoot(document.getElementById('root')!).render(
    route.name === 'tenant' ? <Root tenantId={route.id} /> : <Root />,
  )
}

start().catch((err) => {
  console.error(err)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = err instanceof Error ? err.message : 'Could not start the app.'
  }
})
