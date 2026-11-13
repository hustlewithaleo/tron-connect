import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import express from 'express'
import { createApp, startupMessages } from './app.js'
import { config } from './config.js'

const app = createApp()

// In production the built SPA is served by this process. On Vercel, static
// files are served by the platform instead.
const dist = resolve(process.cwd(), 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(join(dist, 'index.html'))
  })
}

app.listen(config.port, config.host, () => {
  console.log(`tron-connect API listening on http://localhost:${config.port}`)
  for (const message of startupMessages()) {
    console[message.level](message.message)
  }
})
