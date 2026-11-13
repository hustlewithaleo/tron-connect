import { createRoot } from 'react-dom/client'
import { ensureAppKit } from './lib/appkit'
import './style.css'

// `/admin` is a separate view served by the same SPA.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin'

async function start() {
  // AppKit metadata (name/icon/url) is editable in the admin panel, so it must
  // be loaded before AppKit is created and before any component renders.
  await ensureAppKit()

  const { default: Root } = isAdmin ? await import('./AdminApp') : await import('./App')
  createRoot(document.getElementById('root')!).render(<Root />)
}

start().catch((err) => {
  console.error(err)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = err instanceof Error ? err.message : 'Could not start the app.'
  }
})
