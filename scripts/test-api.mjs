import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { apply } from '../index.js'

test('every route requires native connection admission and fails closed without it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codehub-admission-')), effects = [], routes = [], admitted = []
  const ctx = {
    logger: { warn() {} }, effect(fn) { effects.push(fn()) },
    webServer: { register(route) { routes.push(route); return () => {} } },
    connection: { admit(req) {
      admitted.push(req.url)
      if (!req.headers.host.startsWith('127.0.0.1:')) return { rejection: 403 }
      return req.headers.cookie === 'native-fixture=accepted' ? { peer: {} } : { rejection: 401 }
    } },
  }
  apply(ctx, { configPath: join(dir, 'config.json') })
  const server = createServer(routes[0].handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/codehub`
  try {
    assert.equal((await fetch(base + '/index.html')).status, 401)
    assert.equal((await fetch(base + '/api?op=boot')).status, 401)
    assert.equal((await fetch(base + '/api?op=config.set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401)
    const forbidden = await new Promise((resolve, reject) => {
      const req = request(base + '/api?op=boot', { headers: { host: 'untrusted.example', cookie: 'native-fixture=accepted' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end()
    })
    assert.equal(forbidden, 403)
    assert.equal((await fetch(base + '/api?op=boot', { headers: { cookie: 'native-fixture=accepted' } })).status, 200)
    assert.equal(admitted.length, 5)
    delete ctx.connection
    assert.equal((await fetch(base + '/api?op=boot')).status, 503)
  } finally {
    for (const dispose of effects) await dispose?.()
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('HTTP routes connect native review and Issue sessions without remote side effects', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codehub-roundtrip-'))
  execFileSync('git', ['init', dir], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/fixture/repo.git'], { stdio: 'ignore' })
  const originalFetch = globalThis.fetch
  let pausePr = null
  const sha = 'a'.repeat(40), posts = [], prompts = [], sessions = new Map(), effects = [], routes = []
  const rawPr = { number: 12, title: 'Fix input', body: 'Details', state: 'open', head: { sha }, base: { sha: 'b'.repeat(40) }, html_url: 'https://github.com/fixture/repo/pull/12' }
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input)
    if (url.hostname === '127.0.0.1') return originalFetch(input, options)
    assert.ok(['api.github.com', 'new.example.com'].includes(url.hostname))
    if (url.pathname.endsWith('/pulls/12') && pausePr) {
      const gate = pausePr; pausePr = null; gate.started(); await gate.wait
    }
    if (options.method === 'POST') {
      assert.ok(url.pathname.endsWith('/repos/fixture/repo/pulls/12/reviews'))
      posts.push(JSON.parse(options.body))
      return new Response(JSON.stringify({ id: 99 }))
    }
    if (options.headers.accept === 'application/vnd.github.diff') return new Response('diff --git a/main.js b/main.js\n+ if (!input) return null;')
    let body = []
    if (url.pathname.endsWith('/pulls/12')) body = rawPr
    else if (url.pathname.endsWith('/issues/7')) body = { number: 7, title: 'Fix input', body: 'Verify null', state: 'open', html_url: 'https://github.com/fixture/repo/issues/7' }
    return new Response(JSON.stringify(body))
  })
  apply({
    connection: { admit() { return { peer: {} } } },
    logger: { warn() {} }, effect(fn) { effects.push(fn()) },
    webServer: { register(route) { routes.push(route); return () => {} } },
    sessions: {
      create(id) {
        const messages = [], session = {
          append(type, data) { if (type === 'system/message') messages.push(data.message); if (type === 'user/message') messages.push(data) },
          deriveMessages() { return messages },
        }
        sessions.set(id, session)
        return session
      },
      async flush(session) { session.flushed = true },
    },
    llm: {
      listProviders() { return [{ id: 'native', name: 'Native' }] },
      async listModels(provider) { assert.equal(provider, 'native'); return [{ id: 'one', name: 'One' }] },
      async *stream(options) {
        assert.equal(sessions.get(options.sessionId).flushed, true)
        assert.equal(options.tools, undefined)
        yield { type: 'text-delta', index: 0, text: 'Review null handling.' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    sessionController: {
      async create(input) { assert.equal(input.cwd, dir); return { sessionId: input.sessionId } },
      async prompt(input) { prompts.push(input); return { accepted: true } },
    },
  }, { configPath: join(dir, 'config.json') })
  const server = createServer(routes[0].handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/codehub/api?op=`
  const post = async (op, body) => {
    const response = await fetch(base + op, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }
  try {
    await post('config.set', { provider: 'http', instances: [{ id: 'gh', host: 'github.com', token: 'fixture-only' }], repos: [{ instance: 'gh', path: 'fixture/repo', localPath: dir }], ai: { provider: 'native', model: 'one' } })
    const models = await (await fetch(base + 'models')).json()
    assert.equal(models.providers[0].models[0].id, 'one')
    const target = { repoKey: 'gh:fixture/repo', number: 12, confirmed: true }
    const created = await post('review.create', target)
    assert.equal(created.draft.body, 'Review null handling.')
    assert.equal(created.draft.headSha, sha)
    const published = await post('review.publish', { id: created.draft.id, body: 'Human edited review.', confirmed: true })
    assert.equal(published.draft.status, 'published')
    await post('review.publish', { id: created.draft.id, body: 'Human edited review.', confirmed: true })
    assert.deepEqual(posts, [{ commit_id: sha, event: 'COMMENT', body: 'Human edited review.' }])
    const stored = await (await fetch(base + 'review.get&id=' + created.draft.id)).json()
    assert.equal(stored.draft.body, 'Human edited review.')
    const issue = { repoKey: target.repoKey, number: 7, confirmed: true }
    const first = await post('issue.develop', issue), second = await post('issue.develop', issue)
    assert.equal(first.sessionId, second.sessionId)
    assert.equal(second.reused, true)
    assert.equal(prompts.length, 1)
    assert.match(prompts[0].content[0].text, /Verify null/)
    const another = await post('review.create', target)
    let release, started
    const began = new Promise(resolve => { started = resolve })
    pausePr = { started, wait: new Promise(resolve => { release = resolve }) }
    const publishing = fetch(base + 'review.publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: another.draft.id, body: 'Must not reach changed host.', confirmed: true }) })
    await began
    await post('config.set', { instances: [{ id: 'gh', host: 'new.example.com', token: 'different-fixture-token' }] })
    release()
    assert.equal((await publishing).status, 409, 'configuration change during preflight must reject publication')
    assert.equal(posts.length, 1, 'no body may be sent to the changed host')
    const blocked = await (await fetch(base + 'review.get&id=' + another.draft.id)).json()
    assert.equal(blocked.draft.status, 'draft')
  } finally {
    for (const dispose of effects) await dispose?.()
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('API validates writes, exposes Issues and does not block config saves on upstream', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codehub-api-'))
  const effects = [], routes = []
  apply({ connection: { admit() { return { peer: {} } } }, logger: { warn() {} }, effect(fn) { effects.push(fn()) }, webServer: { register(route) { routes.push(route); return () => {} } } }, { configPath: join(dir, 'config.json') })
  const server = createServer(routes[0].handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/codehub/api?op=`
  const post = async (op, body, headers = {}) => {
    const response = await fetch(base + op, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  try {
    const rejected = await post('config.set', { repos: [] }, { origin: 'https://untrusted.example' })
    assert.equal(rejected.status, 403)
    const invalid = await post('config.set', { repos: [{ path: '../bad', instance: 'github.com' }] })
    assert.equal(invalid.status, 400)
    const saved = await post('config.set', { provider: 'git', repos: [], organizations: [], ai: { provider: '', model: '' } })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.refreshQueued, true)
    const issues = await (await fetch(base + 'issues')).json()
    assert.equal(issues.ok, true)
    assert.deepEqual(issues.issues, [])
    const boot = await (await fetch(base + 'boot')).json()
    assert.deepEqual(boot.capabilities, { ai: false, develop: false })
    assert.equal((await fetch(base + 'review.publish')).status, 405)
    assert.equal((await fetch(base + 'mr&repoKey=github.com:a/b&number=-1')).status, 400)
    assert.equal((await fetch(base + 'issue&repoKey=github.com:other/repo&number=1')).status, 404)
    assert.equal((await post('issue.develop', { repoKey: 'github.com:a/b', number: 1 })).status, 403)
  } finally {
    for (const dispose of effects) await dispose?.()
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
