import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __test as data } from '../index.js'

function configStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'codehub-config-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return data.createConfigStore(join(dir, 'config.json'))
}

test('config rejects malformed entries before normalization', async t => {
  const store = configStore(t)
  for (const field of ['instances', 'repos', 'organizations']) {
    for (const value of [null, 'text', 42, []]) {
      await assert.rejects(store.set({ [field]: [value] }), error => error.status === 400)
    }
  }
})

test('masked credentials cannot migrate when an instance changes host', async t => {
  const store = configStore(t)
  await store.set({ instances: [{ id: 'gh', host: 'github.com', token: 'fixture-secret' }] })
  await assert.rejects(store.set({ instances: [{ id: 'gh', host: 'other.example.com', token: '****cret' }] }), error => error.status === 400)
  assert.equal(store.get().instances[0].host, 'github.com')
  await store.set({ instances: [{ id: 'gh', host: 'other.example.com', token: '' }] })
  assert.equal(store.get().instances[0].token, '')
})

test('Issue mapping keeps assignees, labels and closed lifecycle', () => {
  assert.equal(typeof data.mapGhIssue, 'function')
  const issue = data.mapGhIssue({ number: 8, title: 'Fix search', body: 'Steps', state: 'CLOSED', author: { login: 'lee' }, assignees: [{ login: 'me' }], labels: [{ name: 'bug' }], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', comments: [{ id: 'c1', body: 'repro', author: { login: 'lee' } }] })
  assert.equal(issue.state, 'closed')
  assert.deepEqual(issue.assignees, ['me'])
  assert.deepEqual(issue.labels, ['bug'])
  assert.equal(issue.comments[0].body, 'repro')
})

test('gh pagination joins separately encoded page arrays without dropping comments', () => {
  assert.equal(typeof data.parseGhPages, 'function')
  assert.deepEqual(data.parseGhPages('[[{"id":1}],[{"id":2}]]'), [{ id: 1 }, { id: 2 }])
  assert.throws(() => data.parseGhPages('{"message":"forbidden"}'))
})

test('enterprise CLI environment always selects host and isolates inherited credentials', () => {
  const env = data.ghEnv({ instances: [{ id: 'work', host: 'git.example.com', token: 'private' }] }, 'work')
  assert.equal(env.GH_HOST, 'git.example.com')
  assert.equal(env.GH_ENTERPRISE_TOKEN, 'private')
  assert.equal(env.GH_TOKEN, undefined)
  const stored = data.ghEnv({ instances: [{ id: 'work', host: 'git.example.com' }] }, 'work')
  assert.equal(stored.GH_HOST, 'git.example.com')
})

test('unknown comment resolution does not inflate unresolved counts', () => {
  const mr = data.mapGhPr({ number: 1, comments: [{ body: 'discussion' }], reviews: [] })
  assert.equal(mr.comments[0].resolved, null)
  const result = data.decorate({ ...mr, comments: [...mr.comments, { resolved: false, kind: 'inline', author: { login: 'other' } }] }, '')
  assert.equal(result.unresolvedCount, 1)
  assert.equal(result.commentCount, 2)
})

test('overview includes issue counts and explains sampling', () => {
  assert.equal(typeof data.buildOverview, 'function')
  const overview = data.buildOverview([{ repoKey: 'gh:a/b', repo: { path: 'a/b' }, mrs: [], issues: [{ state: 'open', assignees: ['me'] }, { state: 'closed', assignees: [] }], coverage: { limited: true }, source: 'gh' }], { me: { login: 'me' } })
  assert.equal(overview.summary.openIssues, 1)
  assert.equal(overview.summary.closedIssues, 1)
  assert.equal(overview.summary.assignedIssues, 1)
  assert.equal(overview.coverage.limited, true)
  assert.equal(overview.repos[0].counts.openIssues, 1)
})

test('organization expansion deduplicates by instance and retains disabled explicit overrides', () => {
  assert.equal(typeof data.mergeRepos, 'function')
  const cfg = { repos: [{ instance: 'gh', path: 'a/b', localPath: '/checkout', enabled: true }, { instance: 'gh', path: 'a/c', enabled: false }] }
  const repos = data.mergeRepos(cfg, [{ instance: 'gh', path: 'a/b' }, { instance: 'gh', path: 'a/c' }, { instance: 'gh', path: 'a/d' }])
  assert.deepEqual(repos.map(r => r.path).sort(), ['a/b', 'a/d'])
  assert.equal(repos.find(r => r.path === 'a/b').localPath, '/checkout')
})

test('CLI runner passes review bodies on stdin without command interpretation', async () => {
  assert.equal(typeof data.run, 'function')
  const input = 'quotes " and $(not-a-command)\n正文'
  const result = await data.run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, input)
})

const httpConfig = { provider: 'http', pollMinutes: 10, me: { login: 'me' }, instances: [{ id: 'gh', host: 'github.com', token: 'fixture' }], repos: [{ instance: 'gh', path: 'org/repo' }], http: { perPage: 100, timeoutMs: 1000, detailLimit: 2 } }
const httpRepo = { key: 'gh:org/repo', instanceId: 'gh', path: 'org/repo', localPath: '' }

test('paginated GitHub reads preserve all pages and reject redirects', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options])
    return new Response(JSON.stringify([{ id: calls.length }]), { headers: calls.length === 1 ? { link: '<https://api.github.com/next>; rel="next"' } : {} })
  })
  const items = await data.githubRequest(httpRepo, httpConfig, 'orgs/org/repos', { paginate: true })
  assert.deepEqual(items, [{ id: 1 }, { id: 2 }])
  assert.equal(calls[1][0], 'https://api.github.com/orgs/org/repos?per_page=100&page=2')
  assert.equal(calls[0][1].redirect, 'error')
})

test('failed refresh retains previously fetched Issue-only repositories', async t => {
  let failed = false
  t.mock.method(globalThis, 'fetch', async url => {
    if (failed) return new Response('unavailable', { status: 503 })
    return new Response(JSON.stringify(url.includes('/issues?') ? [{ number: 3, title: 'Issue', state: 'open', assignees: [], labels: [] }] : []))
  })
  const store = { rev: 0, get: () => httpConfig }
  const fetcher = data.createFetcher(store, { warn() {} })
  const first = await fetcher.refreshAll(false)
  assert.equal(first[0].issues.length, 1)
  failed = true
  const second = await fetcher.refreshAll(true)
  assert.equal(second[0].issues.length, 1)
  assert.equal(second[0].stale, true)
  assert.match(second[0].error, /503/)
})

test('REST detail enrichment preserves known list CI and review decisions', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('[]'))
  const store = { rev: 0, get: () => httpConfig }
  const fetcher = data.createFetcher(store, { warn() {} })
  const [snapshot] = await fetcher.refreshAll(false)
  snapshot.mrs.push(data.mapGhPr({ number: 7, title: 'Fix', state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }))
  fetcher.rememberDetail(httpRepo.key, { number: 7, body: 'Detail', ciState: 'none', reviewDecision: 'none', comments: [], reviews: [] }, store.rev)
  const mr = fetcher.cached()[0].mrs[0]
  assert.equal(mr.ciState, 'failure')
  assert.equal(mr.reviewDecision, 'approved')
  assert.equal(mr.body, 'Detail')
  assert.equal(mr.detailLoaded, true)
})

test('PR diff rejects head changes during download', async t => {
  let reads = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.headers.accept === 'application/vnd.github.diff') return new Response('diff --git a/a b/a\n+safe')
    if (/\/pulls\/7$/.test(url)) return new Response(JSON.stringify({ number: 7, state: 'open', head: { sha: ++reads === 1 ? 'aaa' : 'bbb' }, base: { sha: 'base' } }))
    return new Response('[]')
  })
  await assert.rejects(data.pullDetail(httpRepo, httpConfig, 7, { diff: true }), err => err.status === 409)
})

