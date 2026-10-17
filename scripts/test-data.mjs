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

// Fixture reproduces the real gh/GraphQL behaviour measured on cli/cli with
// gh 2.102.0: `--state all --limit 200` including statusCheckRollup returns
// HTTP 502/504 (deterministic from ~80 items), the same list without the
// rollup succeeds, and `--state open` with only number+rollup succeeds.
const ghListFixture = (t) => async (exe, args) => {
  const at = (flag) => args[args.indexOf(flag) + 1]
  const state = at('--state')
  const fields = String(at('--json')).split(',')
  const limit = Number(at('--limit'))
  t.calls.push({ state, limit, fields })
  if (fields.includes('statusCheckRollup') && state === 'all' && limit > 70) {
    return { code: 1, stdout: '', stderr: 'HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)' }
  }
  if (state === 'all') return { code: 0, stdout: JSON.stringify([
    { number: 1, title: 'Merged work', state: 'MERGED', updatedAt: '2026-10-05T00:00:00Z' },
    { number: 2, title: 'Open work', state: 'OPEN', updatedAt: '2026-10-06T00:00:00Z' },
  ]), stderr: '' }
  if (t.failCi) return { code: 1, stdout: '', stderr: 'HTTP 502: 502 Bad Gateway (https://api.github.com/graphql)' }
  return { code: 0, stdout: JSON.stringify([{ number: 2, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }]), stderr: '' }
}

test('PR list avoids the oversized check-rollup query and keeps CI where it was fetched', async () => {
  assert.equal(typeof data.ghPrListRows, 'function')
  const t = { calls: [] }
  const { rows, ciCoverage } = await data.ghPrListRows(ghListFixture(t), 'gh', {}, 'cli/cli', 200)
  assert.equal(t.calls.filter(c => c.state === 'all').every(c => !c.fields.includes('statusCheckRollup')), true,
    'the all-state list must not request statusCheckRollup for 200 items (GraphQL gateway times out)')
  assert.deepEqual(rows.map(r => r.number), [1, 2])
  assert.equal(rows.find(r => r.number === 2).statusCheckRollup?.[0].conclusion, 'FAILURE')
  assert.equal(ciCoverage, 'open')
  const mapped = rows.map(data.mapGhPr)
  assert.equal(mapped.find(m => m.number === 2).ciState, 'failure')
  assert.equal(mapped.find(m => m.number === 1).ciState, 'unknown', 'merged PRs were never queried for CI')
})

test('CI enrichment failure degrades the list instead of losing it', async () => {
  const t = { calls: [], failCi: true }
  const { rows, ciCoverage } = await data.ghPrListRows(ghListFixture(t), 'gh', {}, 'cli/cli', 200)
  assert.equal(rows.length, 2)
  assert.equal(ciCoverage, 'unavailable')
  assert.equal(rows.map(r => data.mapGhPr(r).ciState).join(), ['unknown', 'unknown'].join())
})

test('a failing PR list still reports the gh error instead of an empty board', async () => {
  const failing = async () => ({ code: 1, stdout: '', stderr: 'HTTP 502: 502 Bad Gateway (https://api.github.com/graphql)' })
  await assert.rejects(data.ghPrListRows(failing, 'gh', {}, 'cli/cli', 200), /502 Bad Gateway/)
})

test('rollup present but empty stays none, absent stays unknown', () => {
  assert.equal(data.mapGhPr({ number: 1, statusCheckRollup: [] }).ciState, 'none')
  assert.equal(data.mapGhPr({ number: 1 }).ciState, 'unknown')
  assert.equal(data.mapGhPr({ number: 1, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }).ciState, 'success')
})

// Fixture for `gh repo view <path> --json defaultBranchRef,name,description`
// measured against gh 2.102.0: cli/cli → {"defaultBranchRef":{"name":"trunk"}},
// an unknown repo → non-zero exit with a GraphQL error on stderr.
test('repo view supplies the real default branch instead of a PR base guess', async () => {
  assert.equal(typeof data.ghRepoView, 'function')
  const runner = async (exe, args) => {
    assert.deepEqual(args.slice(0, 2), ['repo', 'view'], 'repo metadata must come from `gh repo view <path>`')
    return { code: 0, stdout: JSON.stringify({ defaultBranchRef: { name: 'trunk' }, description: 'GitHub’s official command line tool', name: 'cli' }), stderr: '' }
  }
  const meta = await data.ghRepoView({ path: 'cli/cli' }, runner, 'gh', {})
  assert.equal(meta.defaultBranch, 'trunk')
  assert.equal(meta.description, 'GitHub’s official command line tool')
  const configured = await data.ghRepoView({ path: 'cli/cli', defaultBranch: 'release' }, runner, 'gh', {})
  assert.equal(configured.defaultBranch, 'release', 'a discovered/override value must win')
})

test('a failing repo view degrades to unknown instead of failing the snapshot', async () => {
  const failing = async () => ({ code: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a Repository with the name (repository)' })
  const meta = await data.ghRepoView({ path: 'o/r' }, failing, 'gh', {})
  assert.equal(meta.defaultBranch, '')
  assert.equal(meta.description, 'GitHub 仓库 o/r')
  const garbage = async () => ({ code: 0, stdout: 'not json', stderr: '' })
  assert.equal((await data.ghRepoView({ path: 'o/r' }, garbage, 'gh', {})).defaultBranch, '')
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

test('REST provider never claims a CI verdict it did not fetch', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{ number: 4, state: 'open', title: 'x', user: { login: 'a' } }])))
  const fetcher = data.createFetcher({ rev: 0, get: () => httpConfig }, { warn() {} })
  const [snapshot] = await fetcher.refreshAll(false)
  assert.equal(snapshot.mrs[0].ciState, 'unknown')
})

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

