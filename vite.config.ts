import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // WalletConnect's dependency tree references Node's `global`.
  define: {
    global: 'globalThis',
  },
  // Port 5180 is the origin registered in Reown Cloud for this project.
  // `host: true` also exposes the dev server on the LAN for phone testing;
  // that origin has to be allowlisted in Reown Cloud too.
  server: {
    port: 5180,
    host: true,
    proxy: {
      // Server-side verification API (server/index.ts).
      '/api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5180,
  },
})
