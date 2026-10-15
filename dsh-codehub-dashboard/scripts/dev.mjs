import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const directory = await mkdtemp(join(tmpdir(), 'codehub-dev-'))
const effects = []
let handler
apply({
  connection: { admit(req) {
    const origin = req.headers.origin
    if (origin && origin !== `http://${req.headers.host}`) return { rejection: 403 }
    return { peer: {} }
  } },
  logger: console,
  effect(fn) { effects.push(fn()) },
  webServer: { register(route) { handler = route.handler; return () => {} } },
}, { configPath: join(directory, 'config.json') })
const server = createServer((req, res) => {
  if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) {
    res.writeHead(403); res.end('Loopback host required'); return
  }
  handler(req, res).catch(error => {
    console.error(error)
    if (!res.headersSent) res.writeHead(500)
    res.end('Local server error')
  })
})
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
  console.log(`CodeHub: http://127.0.0.1:${server.address().port}/codehub/index.html`)
  console.log('Isolated temporary configuration; native DSH model/session services are unavailable.')
})
let closing = false
async function close() {
  if (closing) return
  closing = true
  for (const dispose of effects) await dispose?.()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
server.once('error', async error => { console.error(error.message); await close(); process.exitCode = 1 })
