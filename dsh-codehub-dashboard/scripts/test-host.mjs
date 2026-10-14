#!/usr/bin/env node
// Standalone test harness for dsh-codehub-dashboard host half.
// Creates a fake cordis ctx with a real node:http server, imports apply(),
// and probes every API endpoint. Exits non-zero on any failure.

import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const tmpDir = mkdtempSync(join(tmpdir(), 'codehub-test-'))
const configPath = join(tmpDir, 'config.json')

// Create a minimal git repo for testing git enrichment + repos.discover
const testRepoDir = join(tmpDir, 'test-repo')
mkdirSync(testRepoDir)
execFileSync('git', ['init', '-b', 'main'], { cwd: testRepoDir, stdio: 'ignore' })
execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testRepoDir, stdio: 'ignore' })
execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testRepoDir, stdio: 'ignore' })
writeFileSync(join(testRepoDir, 'README.md'), '# Test\n')
execFileSync('git', ['add', '.'], { cwd: testRepoDir, stdio: 'ignore' })
execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: testRepoDir, stdio: 'ignore' })

let passed = 0, failed = 0
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else { console.error(`  ❌ ${name}: ${detail || 'assertion failed'}`); failed++ }
}

async function main() {
  // Build fake ctx
  const routes = []
  const effects = []
  const ctx = {
    logger: { warn: (...a) => console.log('[warn]', ...a) },
    webServer: {
      register(route) { routes.push(route); return () => {} },
    },
    effect(fn, label) {
      const cleanup = fn()
      effects.push({ label, cleanup })
    },
  }

  // Import and apply
  const mod = await import('../index.js')
  assert('exports name', mod.name === 'codehub-dashboard', `got ${mod.name}`)
  assert('exports inject', JSON.stringify(mod.inject) === '["webServer"]', `got ${JSON.stringify(mod.inject)}`)
  assert('exports apply', typeof mod.apply === 'function')

  mod.apply(ctx, { configPath })
  assert('route registered', routes.length === 1 && routes[0].kind === 'prefix' && routes[0].path === '/codehub')

  // Start a real HTTP server using the registered handler
  const handler = routes[0].handler
  const server = createServer((req, res) => handler(req, res).catch((e) => { res.writeHead(500); res.end(String(e)) }))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  async function get(path) {
    const r = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } })
    return { status: r.status, data: await r.json() }
  }
  async function post(path, body) {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, data: await r.json() }
  }

  // --- boot ---
  console.log('\n📡 Testing /codehub/api endpoints...')
  const boot = await get('/codehub/api?op=boot')
  assert('boot ok', boot.data.ok === true)
  assert('boot version', boot.data.version === '0.1.0')
  assert('boot has config', !!boot.data.config)
  assert('boot config masked', !boot.data.config.instances?.some?.((i) => i.token && !i.token.startsWith('****')))

  // --- config.set ---
  const setRes = await post('/codehub/api?op=config.set', {
    provider: 'auto', me: { name: 'Test', login: 'testuser' }, pollMinutes: 5,
    ghPath: 'gh', instances: [{ id: 'gh', name: 'GitHub', host: 'github.com', token: 'ghp_test1234abcd' }],
    repos: [{ id: 'r1', instance: 'gh', path: 'cli/cli', enabled: true }],
  })
  assert('config.set ok', setRes.data.ok === true)
  assert('config.set masked token', setRes.data.config.instances[0].token === '****abcd')
  assert('config.set has overview', !!setRes.data.overview)

  // --- config.get ---
  const cfgGet = await get('/codehub/api?op=config.get')
  assert('config.get ok', cfgGet.data.ok === true)
  assert('config.get masked', cfgGet.data.config.instances[0].token === '****abcd')

  // --- summary (cached, may be empty since gh isn't authenticated) ---
  const summary = await get('/codehub/api?op=summary')
  assert('summary ok', summary.data.ok === true)
  assert('summary has summary obj', !!summary.data.summary)

  // --- overview ---
  const overview = await get('/codehub/api?op=overview')
  assert('overview ok', overview.data.ok === true)
  assert('overview has repos array', Array.isArray(overview.data.overview?.repos))

  // --- mrs ---
  const mrs = await get('/codehub/api?op=mrs&state=all')
  assert('mrs ok', mrs.data.ok === true)
  assert('mrs has mrs array', Array.isArray(mrs.data.mrs))

  // --- reviews ---
  const reviews = await get('/codehub/api?op=reviews')
  assert('reviews ok', reviews.data.ok === true)
  assert('reviews has comments array', Array.isArray(reviews.data.comments))

  // --- activity ---
  const activity = await get('/codehub/api?op=activity')
  assert('activity ok', activity.data.ok === true)
  assert('activity has activity array', Array.isArray(activity.data.activity))

  // --- refresh ---
  const refresh = await get('/codehub/api?op=refresh')
  assert('refresh ok', refresh.data.ok === true)

  // --- config.test ---
  const test = await post('/codehub/api?op=config.test', {})
  assert('config.test ok', test.data.ok === true)
  assert('config.test has results', Array.isArray(test.data.results))
  assert('config.test includes git', test.data.results.some((r) => r.kind === 'cli'))
  assert('config.test includes gh', test.data.results.some((r) => r.kind === 'gh-cli'))

  // --- repos.discover ---
  const discover = await get(`/codehub/api?op=repos.discover&ws=${encodeURIComponent(tmpDir)}&depth=1`)
  assert('repos.discover ok', discover.data.ok === true)
  assert('repos.discover found test repo', discover.data.repos.some((r) => r.path === testRepoDir))

  // --- provider normalization (legacy UI value "git-meta" must map to "git") ---
  const normRes = await post('/codehub/api?op=config.set', {
    provider: 'git-meta', me: { name: 'Test', login: 'testuser' }, pollMinutes: 5,
    ghPath: 'gh', instances: [{ id: 'gh', name: 'GitHub', host: 'github.com', token: 'ghp_test1234abcd' }],
    repos: [{ id: 'r1', instance: 'gh', path: 'cli/cli', enabled: true }],
  })
  assert('config.set normalizes git-meta -> git', normRes.data.config.provider === 'git', `got ${normRes.data.config.provider}`)

  // --- mrs with ci filter (server-side filtering regression) ---
  const mrsCi = await get('/codehub/api?op=mrs&state=all&ci=failure')
  assert('mrs ci filter ok', mrsCi.data.ok === true)
  assert('mrs ci filter has mrs array', Array.isArray(mrsCi.data.mrs))

  // --- index.html ---
  const htmlRes = await fetch(`${base}/codehub/index.html`)
  assert('index.html served', htmlRes.status === 200)
  const htmlBody = await htmlRes.text()
  assert('index.html contains CodeHub', htmlBody.includes('CodeHub'))

  // --- SPA inline script parses (syntax guard for web/index.html) ---
  const scriptMatch = htmlBody.match(/<script>([\s\S]*)<\/script>/)
  assert('SPA has inline script', !!scriptMatch)
  if (scriptMatch) {
    try { new Function(scriptMatch[1]); assert('SPA script parses', true) }
    catch (e) { assert('SPA script parses', false, e.message) }
  }

  // --- 404 ---
  const notFound = await get('/codehub/api?op=nonexistent')
  assert('unknown op returns error', notFound.data.ok === false)

  // Cleanup
  server.close()
  for (const e of effects) try { await e.cleanup?.() } catch {}
  rmSync(tmpDir, { recursive: true, force: true })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Harness crashed:', e); process.exit(1) })
