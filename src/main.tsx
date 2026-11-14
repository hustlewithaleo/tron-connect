import type { ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { ensureAppKit } from './lib/appkit'
import { parseRoute } from './lib/routes'
import './style.css'
import './dash.css'

const route = parseRoute(window.location.pathname)

type PageProps = { tenantId?: string }

async function loadPage(): Promise<ComponentType<PageProps>> {
  switch (route.name) {
    case 'admin':
      return (await import('./AdminApp')).default as ComponentType<PageProps>
    case 'platform':
      return (await import('./Platform')).default as ComponentType<PageProps>
    case 'dash':
      return (await import('./Dashboard')).default as ComponentType<PageProps>
    case 'tenant':
      return (await import('./TenantPage')).default as ComponentType<PageProps>
    default:
      return (await import('./App')).default as ComponentType<PageProps>
  }
}

async function start() {
  await ensureAppKit()

  const Page = await loadPage()

  createRoot(document.getElementById('root')!).render(
    <Page {...(route.name === 'tenant' ? { tenantId: route.id } : {})} />,
  )
}

start().catch((err) => {
  console.error(err)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = err instanceof Error ? err.message : 'Could not start the app.'
  }
})
