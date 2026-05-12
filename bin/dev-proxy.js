#!/usr/bin/env node
/* Local dev CORS proxy.
 *
 * The cloud companion (Cloud Run) only sets access-control-allow-origin
 * for specific allowlisted origins. Production tether-demo.xid.network
 * works because its Next.js layer proxies server-side; our standalone
 * Pears-audit UI loaded from localhost:8765 (or file://) doesn't have
 * that luxury and gets CORS-blocked.
 *
 * This proxy forwards /api/* to the cloud companion and serves ui/*
 * from the same origin, so the browser never makes a cross-origin call.
 *
 * Usage:
 *   node bin/dev-proxy.js
 *   # then open http://localhost:8766/
 */

import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const UI_DIR = path.join(ROOT, 'ui')

const COMPANION_URL = process.env.ECANDLE_COMPANION_URL
  || 'https://ecandle-companion-487249444915.asia-east1.run.app'
const COMPANION_HOST = new URL(COMPANION_URL).hostname

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}

const PORT = Number(process.env.PORT || 8766)

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': '*',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  /* /api/* → proxy to cloud companion */
  if (url.pathname.startsWith('/api/')) {
    const upstream = https.request({
      hostname: COMPANION_HOST,
      port: 443,
      path: url.pathname + url.search,
      method: req.method,
      headers: { 'host': COMPANION_HOST },
    }, (up) => {
      const headers = { ...up.headers, 'access-control-allow-origin': '*' }
      res.writeHead(up.statusCode || 502, headers)
      up.pipe(res)
    })
    upstream.on('error', (err) => {
      console.error('[proxy] upstream error:', err.message)
      res.writeHead(502).end('upstream error')
    })
    req.pipe(upstream)
    return
  }

  /* Anything else → serve from ui/ */
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = path.join(UI_DIR, pathname)
  if (!filePath.startsWith(UI_DIR)) { res.writeHead(403).end(); return }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`[proxy] dev server: http://localhost:${PORT}/`)
  console.log(`[proxy] /api/* → ${COMPANION_URL}`)
  console.log(`[proxy] ui/    → ${UI_DIR}`)
  console.log('[proxy] In the UI Companion URL field, set it to:')
  console.log(`           http://localhost:${PORT}`)
  console.log('         (the proxy handles cross-origin forwarding for you)')
})
