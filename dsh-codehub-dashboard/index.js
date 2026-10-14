// dsh-codehub-dashboard — host half
//
// A GitHub MR / review-comment aggregation dashboard for DSH, powered by the
// `gh` CLI (https://cli.github.com/). Serves under the /codehub prefix:
//   GET  /codehub/index.html            -> the dashboard SPA (web/index.html)
//   GET  /codehub/api?op=<op>&...       -> JSON data
//   POST /codehub/api?op=<op>           -> JSON mutations
//
// Data sources (per repo):
//   gh    - primary: `gh pr list/view/review list/comments` via the official
//           GitHub CLI. Requires `gh auth login` or a GH_TOKEN env var.
//   git   - supplementary: local git CLI augments repo metadata (default branch,
//           remote URL) when a localPath is configured.
//   http  - fallback: GitHub REST API v3 with a personal access token, used
//           when gh is unavailable but a token is configured.
//
// Commands are executed with execFile (no shell), fixed argument lists only.
// Tokens are persisted in the plugin's own config file (best-effort 0600) and
// are never echoed back by the API (masked as ****last4).

import { execFile } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile, chmod, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, 'web')
const PLUGIN_VERSION = '0.1.0'

const MAX_EXEC_BUFFER = 16 * 1024 * 1024
const EXEC_TIMEOUT_MS = 30_000
const FETCH_CONCURRENCY = 3
const DAY_MS = 86_400_000

export const name = 'codehub-dashboard'
export const inject = ['webServer']

/* ===================== generic helpers ===================== */

const pad2 = (n) => String(n).padStart(2, '0')
function dateKey(t) {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
const isoOr = (v, fallback) => {
  if (!v) return fallback
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

function run(file, args, opts = {}) {
  return new Promise((res) => {
    execFile(file, args, {
      maxBuffer: MAX_EXEC_BUFFER, windowsHide: true, timeout: EXEC_TIMEOUT_MS, encoding: 'utf8', ...opts,
    }, (err, stdout, stderr) => {
      if (err && err.killed) { res({ stdout: '', stderr: `timeout after ${EXEC_TIMEOUT_MS}ms`, code: -1, error: err }); return }
      res({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, error: err ?? null })
    })
  })
}

const maskToken = (t) => { const s = String(t ?? ''); if (!s) return ''; return s.length > 4 ? `****${s.slice(-4)}` : '****' }
const isMaskedToken = (t) => typeof t === 'string' && t.startsWith('****')
const clip = (s, n) => { const v = String(s ?? ''); return v.length > n ? v.slice(0, n - 1) + '…' : v }

/* ===================== config store ===================== */

function defaultConfig() {
  return {
    version: 1,
    // gh | git | http | auto  (auto = gh first, then http if token set, then git-only metadata)
    provider: 'auto',
    me: { name: '', login: '' },
    pollMinutes: 10,
    ghPath: 'gh',          // path to gh executable
    instances: [],         // { id, name, host (e.g. github.com), token }
    repos: [],             // { id, instance, path:'owner/name', localPath?, enabled, defaultBranch? }
    http: { perPage: 100, detailLimit: 25, timeoutMs: 15000 },
  }
}

function createConfigStore(filePath, log) {
  let current = defaultConfig()
  let rev = 0, loaded = false
  const normalize = (cfg) => {
    const base = defaultConfig()
    const out = { ...base, ...cfg }
    out.me = { ...base.me, ...(cfg?.me ?? {}) }
    out.http = { ...base.http, ...(cfg?.http ?? {}) }
    out.instances = Array.isArray(cfg?.instances) ? cfg.instances : []
    out.repos = Array.isArray(cfg?.repos) ? cfg.repos : []
      out.pollMinutes = Math.max(1, Math.min(1440, Number(out.pollMinutes) || base.pollMinutes))
      // "git-meta" was the pre-0.1.1 UI value; map it so hand-edited or
      // legacy configs keep working instead of silently falling back to auto.
      if (out.provider === 'git-meta') out.provider = 'git'
      if (!['auto', 'gh', 'git', 'http'].includes(out.provider)) out.provider = 'auto'
    let n = 0; for (const inst of out.instances) if (!inst.id) inst.id = `i${++n}`
    n = 0; for (const repo of out.repos) if (!repo.id) repo.id = `r${++n}`
    return out
  }
  const load = async () => {
    try { const raw = await readFile(filePath, 'utf8'); current = normalize(JSON.parse(raw)) }
    catch (err) { if (err?.code !== 'ENOENT') log?.warn?.('[codehub] config load failed:', err?.message ?? err); current = defaultConfig() }
    loaded = true; return current
  }
  const save = async () => {
    await mkdir(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`; await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8')
    try { await chmod(tmp, 0o600) } catch {}
    await rename(tmp, filePath)
  }
  return {
    get path() { return filePath }, get rev() { return rev },
    async init() { if (!loaded) await load(); return current },
    get() { return current },
    async set(patch) {
      const prev = current; const next = normalize({ ...prev, ...(patch ?? {}) })
      next.instances = next.instances.map((inst) => {
        const old = prev.instances.find((i) => i.id === inst.id)
        if (old && isMaskedToken(inst.token)) return { ...inst, token: old.token }; return inst
      })
      current = next; rev++; await save(); return current
    },
    masked() {
      return { ...current, instances: current.instances.map((i) => ({ ...i, token: maskToken(i.token), hasToken: !!i.token })) }
    },
  }
}

/* ===================== repo model ===================== */

function effectiveRepos(cfg) {
  return (cfg.repos ?? []).filter((r) => r && r.path && r.enabled !== false).map((r) => ({
    key: `${r.instance || 'github.com'}:${r.path}`,
    instanceId: r.instance || 'github.com',
    path: r.path, localPath: r.localPath || '', defaultBranch: r.defaultBranch || '',
  }))
}
const repoName = (path) => String(path ?? '').split('/').pop() || String(path ?? '')
const repoOwner = (path) => String(path ?? '').split('/')[0] || ''

/* ===================== gh provider (primary) ===================== */

/** Resolve the gh executable. Bare names rely on PATH; paths must exist. */
function ghExecutable(cfg) { return String(cfg.ghPath || 'gh').trim() || 'gh' }

async function ghProbe(cfg) {
  const exe = ghExecutable(cfg)
  const t0 = Date.now()
  const ver = await run(exe, ['--version'])
  if (ver.code !== 0) return { ok: false, detail: clip(ver.stderr || ver.stdout || 'gh --version 失败', 300), ms: Date.now() - t0 }
  const auth = await run(exe, ['auth', 'status'], { env: { ...process.env } })
  const loggedIn = auth.code === 0 || !/not logged in/i.test(auth.stderr || '')
  return { ok: true, loggedIn, detail: clip(ver.stdout.trim(), 120) + (loggedIn ? '' : '（未登录，需 gh auth login 或设置 GH_TOKEN）'), ms: Date.now() - t0 }
}

/** Build environment with optional per-instance GH_TOKEN override. */
function ghEnv(cfg, instanceId) {
  const inst = (cfg.instances ?? []).find((i) => i.id === instanceId)
  if (inst?.token) return { ...process.env, GH_TOKEN: inst.token, GH_HOST: inst.host || 'github.com' }
  return process.env
}

// gh --json uses nested field syntax: author{login,name} (no spaces).
// Fields verified against gh 2.102.0 documentation.
const GH_PR_LIST_FIELDS = [
  'number','title','state','isDraft','headRefName','baseRefName',
  'createdAt','updatedAt','mergedAt','additions','deletions','changedFiles',
  'reviewDecision','url',
  'author{login,name}','labels{name}','reviewRequests{login}',
  'latestReviews{author{login,name},state,submittedAt,body}',
].join(',')
const GH_PR_VIEW_FIELDS = [
  'number','title','state','isDraft','headRefName','baseRefName',
  'createdAt','updatedAt','mergedAt','additions','deletions','changedFiles',
  'reviewDecision','url',
  'author{login,name}','labels{name}','reviewRequests{login}',
  'reviews{author{login,name},state,submittedAt,body}',
  'comments{author{login,name},body,path,line,createdAt}',
  'statusCheckRollup',
].join(',')
// Same fields without statusCheckRollup, used as fallback when the installed
// gh predates that JSON field (unknown-field error would otherwise fail the
// whole `gh pr view` call and lose reviews/comments too).
const GH_PR_VIEW_FIELDS_NO_CI = GH_PR_VIEW_FIELDS.split(',').filter((f) => f !== 'statusCheckRollup').join(',')

function ghPerson(o) {
  if (!o) return { name: 'unknown', login: 'unknown' }
  if (typeof o === 'object') return { name: o.name || o.login || 'unknown', login: o.login || 'unknown' }
  return { name: String(o), login: String(o) }
}

function mapGhPr(raw) {
  const author = ghPerson(raw?.author)
  let state = String(raw?.state ?? 'OPEN').toUpperCase()
  if (state === 'MERGED' || (state === 'CLOSED' && raw?.mergedAt)) state = 'merged'
  else if (state === 'CLOSED') state = 'closed'
  else state = 'open'
  const labels = (raw?.labels ?? []).map((l) => l?.name).filter(Boolean)
  const requestedReviewers = (raw?.reviewRequests ?? []).map((r) => r?.login).filter(Boolean)
  const decision = String(raw?.reviewDecision ?? 'NONE').toLowerCase()
  const reviews = (raw?.latestReviews ?? raw?.reviews ?? []).map((r) => ({
    id: `rv-${raw.number}-${r.author?.login || '?'}`,
    author: ghPerson(r.author),
    state: String(r.state ?? '').toLowerCase() === 'approved' ? 'approved'
      : String(r.state ?? '').toLowerCase() === 'changes_requested' ? 'changes_requested'
        : String(r.state ?? '').toLowerCase() === 'pending' ? 'pending' : 'commented',
    submittedAt: isoOr(r.submittedAt, raw.updatedAt),
    body: String(r.body ?? ''),
  })).filter((r) => r.state !== 'pending')
  const comments = (raw?.comments ?? []).map((c, i) => ({
    id: `rc-${raw.number}-${i}`,
    author: ghPerson(c.author),
    body: String(c.body ?? ''),
    file: c.path ?? null,
    line: c.line != null ? Number(c.line) : null,
    createdAt: isoOr(c.createdAt, raw.updatedAt),
    resolved: false, // gh PR comments don't carry resolved state at list level
  }))
  // CI status from statusCheckRollup would need an extra field; derive from reviewDecision as proxy
  const ciState = 'none' // enriched below if needed
  return {
    number: Number(raw?.number) || 0, title: String(raw?.title ?? ''), author, state,
    draft: !!raw?.isDraft, sourceBranch: raw?.headRefName ?? '', targetBranch: raw?.baseRefName ?? '',
    createdAt: isoOr(raw?.createdAt, new Date().toISOString()),
    updatedAt: isoOr(raw?.updatedAt ?? raw?.createdAt, new Date().toISOString()),
    mergedAt: raw?.mergedAt ? isoOr(raw.mergedAt, null) : null,
    additions: Number(raw?.additions) || 0, deletions: Number(raw?.deletions) || 0,
    changedFiles: Number(raw?.changedFiles) || 0, labels,
    ciState, reviewDecision: ['approved', 'changes_requested', 'pending', 'none'].includes(decision) ? decision : 'none',
    requestedReviewers, reviews, comments, url: String(raw?.url ?? ''),
  }
}

async function ghSnapshot(repo, cfg) {
  const exe = ghExecutable(cfg)
  const env = ghEnv(cfg, repo.instanceId)
  const t0 = Date.now()

  // List PRs (all states)
  const listRes = await run(exe, [
    'pr', 'list', '--repo', repo.path, '--state', 'all', '--limit', '200',
    '--json', GH_PR_LIST_FIELDS,
  ], { env })
  let rawList = null
  if (listRes.code === 0) {
    try { rawList = JSON.parse(listRes.stdout) } catch { /* fall through */ }
  }
  if (!Array.isArray(rawList)) {
    throw new Error(clip(listRes.stderr || listRes.stdout || 'gh pr list 失败', 400))
  }

  const mrs = rawList.map(mapGhPr)

  // Enrich open/recent PRs with full reviews + inline review comments via `gh pr view`
  const detailed = mrs.filter((m) => m.state === 'open' || (m.mergedAt && Date.now() - new Date(m.mergedAt).getTime() < 30 * DAY_MS))
    .slice(0, Math.max(5, cfg.http?.detailLimit ?? 25))

  await mapLimit(detailed, FETCH_CONCURRENCY, async (mr) => {
    try {
      let viewRes = await run(exe, [
        'pr', 'view', String(mr.number), '--repo', repo.path,
        '--json', GH_PR_VIEW_FIELDS,
      ], { env })
      // Older gh builds reject statusCheckRollup as an unknown field; retry
      // without it rather than losing reviews and comments entirely.
      if (viewRes.code !== 0 && /unknown (json )?field/i.test(viewRes.stderr || '')) {
        viewRes = await run(exe, [
          'pr', 'view', String(mr.number), '--repo', repo.path,
          '--json', GH_PR_VIEW_FIELDS_NO_CI,
        ], { env })
      }
      if (viewRes.code !== 0) return
      let detail
      try { detail = JSON.parse(viewRes.stdout) } catch { return }
      // Merge richer reviews
      if (Array.isArray(detail.reviews) && detail.reviews.length) {
        mr.reviews = detail.reviews.map((r) => ({
          id: `rv-${mr.number}-${r.author?.login || '?'}`,
          author: ghPerson(r.author),
          state: String(r.state ?? '').toLowerCase() === 'approved' ? 'approved'
            : String(r.state ?? '').toLowerCase() === 'changes_requested' ? 'changes_requested' : 'commented',
          submittedAt: isoOr(r.submittedAt, mr.updatedAt),
          body: String(r.body ?? ''),
        })).filter((r) => r.state !== 'pending')
      }
      // Inline review comments (these are PR review comments, not issue comments)
      if (Array.isArray(detail.comments) && detail.comments.length) {
        for (let i = 0; i < detail.comments.length; i++) {
          const c = detail.comments[i]
          mr.comments.push({
            id: `rc-${mr.number}-v-${i}`, author: ghPerson(c.author), body: String(c.body ?? ''),
            file: c.path ?? null, line: c.line != null ? Number(c.line) : null,
            createdAt: isoOr(c.createdAt, mr.updatedAt), resolved: false,
          })
        }
      }
      // CI status from statusCheckRollup if available
      if (detail.statusCheckRollup) {
        const sc = detail.statusCheckRollup
        const st = String(sc.state ?? sc.status ?? '').toUpperCase()
        if (st === 'SUCCESS' || st === 'COMPLETED') mr.ciState = 'success'
        else if (st === 'FAILURE' || st === 'ERROR') mr.ciState = 'failure'
        else if (st === 'PENDING' || st === 'IN_PROGRESS' || st === 'QUEUED') mr.ciState = 'pending'
      }
    } catch { /* enrichment failure is non-fatal */ }
  })

  // Derive CI state for PRs that didn't get enriched (use reviewDecision as rough proxy)
  for (const mr of mrs) {
    if (mr.ciState === 'none' && mr.state === 'open') {
      // If there's a mergeStateStatus we could use it, but it requires extra fields.
      // Leave as 'none' — the UI shows "CI —" which is honest.
    }
  }

  mrs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  return {
    repoKey: repo.key, source: 'gh', fetchedAt: new Date().toISOString(), error: null, elapsedMs: Date.now() - t0,
    repo: {
      key: repo.key, name: repoName(repo.path), owner: repoOwner(repo.path), path: repo.path,
      defaultBranch: mrs.find((m) => m.targetBranch)?.targetBranch || repo.defaultBranch || 'main',
      description: `GitHub 仓库 ${repo.path}`, demo: false,
    },
    mrs,
  }
}

/* ===================== git provider (supplementary metadata) ===================== */

const git = (args, cwd) => run('git', args, { cwd })

async function isGitRepo(dir) {
  if (!dir) return false
  const r = await git(['rev-parse', '--is-inside-work-tree'], dir)
  return r.code === 0 && r.stdout.trim() === 'true'
}

function parseRemotePath(url) {
  const s = String(url ?? '').trim()
  if (!s) return null
  const m = s.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)
  if (!m) return null
  return m[1]
}

async function gitEnrich(repo, snap) {
  const dir = repo.localPath
  if (!(await isGitRepo(dir))) return snap
  // Enrich repo metadata from local git
  const remote = await git(['remote', 'get-url', 'origin'], dir)
  if (remote.code === 0) {
    const rp = parseRemotePath(remote.stdout.trim())
    if (rp) { snap.repo.remoteUrl = remote.stdout.trim(); snap.repo.remotePath = rp }
  }
  const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], dir)
  if (head.code === 0 && !snap.repo.defaultBranch) {
    snap.repo.defaultBranch = head.stdout.trim().replace(/^origin\//, '')
  }
  if (!snap.repo.defaultBranch) {
    for (const cand of ['main', 'master']) {
      const r = await git(['show-ref', '--verify', '--quiet', `refs/heads/${cand}`], dir)
      if (r.code === 0) { snap.repo.defaultBranch = cand; break }
    }
  }
  snap.repo.localPath = dir
  return snap
}

/* ===================== http provider (fallback REST) ===================== */

function instanceOf(cfg, id) {
  return (cfg.instances ?? []).find((i) => i.id === id) ?? null
}

async function httpJson(url, token, timeoutMs) {
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `dsh-codehub-dashboard/${PLUGIN_VERSION}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`HTTP ${res.status} ${clip(body, 200)}`) }
  return res.json()
}

function mapGithubPr(pr) {
  const state = pr?.merged_at ? 'merged' : String(pr?.state ?? 'open').toLowerCase() === 'closed' ? 'closed' : 'open'
  return {
    number: Number(pr?.number) || 0, title: String(pr?.title ?? ''),
    author: { name: pr?.user?.login || 'unknown', login: pr?.user?.login || 'unknown' },
    state, draft: !!pr?.draft, sourceBranch: pr?.head?.ref ?? '', targetBranch: pr?.base?.ref ?? '',
    createdAt: isoOr(pr?.created_at, new Date().toISOString()),
    updatedAt: isoOr(pr?.updated_at ?? pr?.created_at, new Date().toISOString()),
    mergedAt: pr?.merged_at ? isoOr(pr.merged_at, null) : null,
    additions: Number(pr?.additions) || 0, deletions: Number(pr?.deletions) || 0,
    changedFiles: Number(pr?.changed_files) || 0,
    labels: (pr?.labels ?? []).map((l) => l?.name).filter(Boolean),
    ciState: 'none', reviewDecision: 'none',
    requestedReviewers: (pr?.requested_reviewers ?? []).map((r) => r?.login).filter(Boolean),
    reviews: [], comments: [], url: String(pr?.html_url ?? ''),
  }
}

async function httpSnapshot(repo, cfg) {
  const inst = instanceOf(cfg, repo.instanceId)
  if (!inst?.token) throw new Error(`实例 ${repo.instanceId} 未配置 token`)
  const timeoutMs = Number(cfg.http?.timeoutMs ?? 15000)
  const host = inst.host || 'github.com'
  const apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`
  const t0 = Date.now()
  const pulls = await httpJson(`${apiBase}/repos/${repo.path}/pulls?state=all&per_page=${Number(cfg.http?.perPage ?? 100)}&sort=updated&direction=desc`, inst.token, timeoutMs)
  if (!Array.isArray(pulls)) throw new Error('pulls 响应不是数组')
  const mrs = pulls.map(mapGithubPr)

  const detailed = mrs.slice(0, Math.max(5, Number(cfg.http?.detailLimit ?? 25)))
  await mapLimit(detailed, FETCH_CONCURRENCY, async (mr) => {
    try {
      const [reviews, comments] = await Promise.all([
        httpJson(`${apiBase}/repos/${repo.path}/pulls/${mr.number}/reviews?per_page=100`, inst.token, timeoutMs).catch(() => []),
        httpJson(`${apiBase}/repos/${repo.path}/pulls/${mr.number}/comments?per_page=100`, inst.token, timeoutMs).catch(() => []),
      ])
      if (Array.isArray(reviews)) {
        mr.reviews = reviews.map((r) => ({
          id: String(r.id), author: { name: r.user?.login || 'unknown', login: r.user?.login || 'unknown' },
          state: String(r.state ?? '').toLowerCase() === 'approved' ? 'approved'
            : String(r.state ?? '').toLowerCase() === 'changes_requested' ? 'changes_requested' : 'commented',
          submittedAt: isoOr(r.submitted_at, mr.updatedAt), body: String(r.body ?? ''),
        })).filter((r) => r.state !== 'pending')
      }
      if (Array.isArray(comments)) {
        mr.comments = comments.map((c) => ({
          id: String(c.id), author: { name: c.user?.login || 'unknown', login: c.user?.login || 'unknown' },
          body: String(c.body ?? ''), file: c.path ?? null, line: c.line ?? c.position ?? null,
          createdAt: isoOr(c.created_at, mr.updatedAt), resolved: false,
        }))
      }
      const byReviewer = new Map()
      for (const rv of mr.reviews) byReviewer.set(rv.author.login, rv.state)
      const states = [...byReviewer.values()]
      if (states.includes('changes_requested')) mr.reviewDecision = 'changes_requested'
      else if (states.includes('approved')) mr.reviewDecision = 'approved'
      else if (states.length) mr.reviewDecision = 'pending'
      else if (mr.requestedReviewers.length && mr.state === 'open') mr.reviewDecision = 'pending'
    } catch (err) { mr.detailError = clip(err?.message ?? String(err), 200) }
  })

  mrs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  return {
    repoKey: repo.key, source: 'http', fetchedAt: new Date().toISOString(), error: null, elapsedMs: Date.now() - t0,
    repo: {
      key: repo.key, name: repoName(repo.path), owner: repoOwner(repo.path), path: repo.path,
      defaultBranch: mrs.find((m) => m.targetBranch)?.targetBranch || repo.defaultBranch || 'main',
      description: `GitHub 仓库 ${repo.path}（REST API）`, demo: false, instanceId: inst.id,
    },
    mrs,
  }
}

/* ===================== provider dispatch + cache ===================== */

function planSource(repo, cfg, ghOk) {
  const p = cfg.provider
  if (p === 'gh') return 'gh'
  if (p === 'git') return 'git-meta' // git alone can't provide MRs; treat as metadata-only
  if (p === 'http') return 'http'
  // auto: gh first, then http if token available, otherwise error
  if (ghOk) return 'gh'
  const inst = instanceOf(cfg, repo.instanceId)
  if (inst?.token) return 'http'
  return 'error' // no data source available
}

function createFetcher(store, log) {
  const cache = new Map()
  let ghOkCache = { at: 0, ok: false, loggedIn: false }
  let inflight = null

  const ghAvailable = async (cfg) => {
    if (cfg.provider === 'http') return false
    const exe = ghExecutable(cfg)
    if (!exe) return false
    if (Date.now() - ghOkCache.at < 5 * 60_000) return ghOkCache.ok
    const probe = await ghProbe(cfg)
    ghOkCache = { at: Date.now(), ok: !!probe.ok, loggedIn: !!probe.loggedIn }
    return ghOkCache.ok
  }

  const fetchOne = async (repo, cfg, ghOk, force) => {
    const rev = store.rev
    const hit = cache.get(repo.key)
    const ttl = Math.max(1, Number(cfg.pollMinutes) || 10) * 60_000
    if (!force && hit && hit.rev === rev && Date.now() - hit.at < ttl) return hit.snapshot

    const planned = planSource(repo, cfg, ghOk)
    let snapshot
    try {
      if (planned === 'gh') snapshot = await ghSnapshot(repo, cfg)
      else if (planned === 'http') snapshot = await httpSnapshot(repo, cfg)
      else if (planned === 'git-meta') {
        snapshot = { repoKey: repo.key, source: 'git-meta', fetchedAt: new Date().toISOString(), error: 'git 数据源仅提供仓库元信息，MR 数据需要 gh CLI 或 HTTP token', repo: { key: repo.key, name: repoName(repo.path), owner: repoOwner(repo.path), path: repo.path, defaultBranch: repo.defaultBranch || 'main', description: '', demo: false }, mrs: [] }
      } else {
        snapshot = { repoKey: repo.key, source: 'error', fetchedAt: new Date().toISOString(), error: '无可用数据源：请安装并登录 gh CLI（gh auth login），或在设置中配置 HTTP token', repo: { key: repo.key, name: repoName(repo.path), owner: repoOwner(repo.path), path: repo.path, defaultBranch: repo.defaultBranch || 'main', description: '', demo: false }, mrs: [] }
      }
    } catch (err) {
      const msg = clip(err?.message ?? String(err), 400)
      // Fallback chain: gh -> http (if token) -> error
      if (planned === 'gh') {
        const inst = instanceOf(cfg, repo.instanceId)
        if (inst?.token) {
          try { snapshot = await httpSnapshot(repo, cfg); snapshot.degradedNote = `gh 失败（${msg}），已降级为 HTTP API` }
          catch { snapshot = { repoKey: repo.key, source: 'error', fetchedAt: new Date().toISOString(), error: msg, repo: { key: repo.key, name: repoName(repo.path), owner: repoOwner(repo.path), path: repo.path, defaultBranch: repo.defaultBranch || 'main', description: '', demo: false }, mrs: [] } }
        } else {
          snapshot = { repoKey: repo.key, source: 'error', fetchedAt: new Date().toISOString(), error: msg, repo: { key: repo.key, name: repoName(repo.path), owner: repoOwner(repo.path), path: repo.path, defaultBranch: repo.defaultBranch || 'main', description: '', demo: false }, mrs: [] }
        }
      } else {
        snapshot = { repoKey: repo.key, source: 'error', fetchedAt: new Date().toISOString(), error: msg, repo: { key: repo.key, name: repoName(repo.path), owner: repoOwner(repo.path), path: repo.path, defaultBranch: repo.defaultBranch || 'main', description: '', demo: false }, mrs: [] }
      }
      log?.warn?.(`[codehub] repo ${repo.key}: ${snapshot.degradedNote ?? msg}`)
    }

    // Git enrichment (supplementary metadata from local clone)
    if (repo.localPath && snapshot) {
      try { snapshot = await gitEnrich(repo, snapshot) } catch {}
    }

    cache.set(repo.key, { snapshot, at: Date.now(), rev })
    return snapshot
  }

  const refreshAll = async (force) => {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const cfg = store.get()
        const repos = effectiveRepos(cfg)
        const ghOk = await ghAvailable(cfg)
        return (await mapLimit(repos, FETCH_CONCURRENCY, (repo) => fetchOne(repo, cfg, ghOk, force))).filter(Boolean)
      } finally { inflight = null }
    })()
    return inflight
  }

  const cached = () => {
    const cfg = store.get(); const repos = effectiveRepos(cfg); const out = []
    for (const repo of repos) { const hit = cache.get(repo.key); if (hit && hit.rev === store.rev) out.push(hit.snapshot) }
    return out
  }

  return { refreshAll, cached, fetchOne, ghAvailable, ghProbe, invalidate: () => { cache.clear(); ghOkCache = { at: 0, ok: false, loggedIn: false } } }
}

/* ===================== aggregation ===================== */

function computeNeedsMyReview(mr, meLogin) {
  if (!meLogin) return false
  if (mr.state !== 'open' || mr.draft) return false
  if (!(mr.requestedReviewers ?? []).includes(meLogin)) return false
  // GitHub only clears a review request on approve / request-changes.
  // A bare "commented" review leaves me on the requested list, so it must
  // still count as waiting for my review.
  return !(mr.reviews ?? []).some((r) => r.author?.login === meLogin && (r.state === 'approved' || r.state === 'changes_requested'))
}

function commentNeedsReply(mr, c, meLogin) {
  if (!meLogin) return false
  if (c.resolved) return false
  if (c.author?.login === meLogin) return false
  return mr.author?.login === meLogin || mr.reviewDecision === 'changes_requested'
}

function decorate(mr, meLogin) {
  const unresolved = (mr.comments ?? []).filter((c) => !c.resolved)
  return {
    ...mr, needsMyReview: computeNeedsMyReview(mr, meLogin),
    commentCount: (mr.comments ?? []).length, unresolvedCount: unresolved.length,
    needsReplyCount: unresolved.filter((c) => commentNeedsReply(mr, c, meLogin)).length,
    reviewCount: (mr.reviews ?? []).length,
  }
}

function buildOverview(snapshots, cfg) {
  const meLogin = (cfg.me?.login || '').trim()
  const now = Date.now(); const weekAgo = now - 7 * DAY_MS
  const repos = []; const allMrs = []; const allComments = []
  const statusDist = { open: 0, merged: 0, closed: 0 }
  const reviewerAgg = new Map(); const dayMap = new Map(); const events = []
  const dayBucket = (t) => { const k = dateKey(t); if (!dayMap.has(k)) dayMap.set(k, { date: k, opened: 0, merged: 0, comments: 0 }); return dayMap.get(k) }
  for (let i = 29; i >= 0; i--) dayBucket(now - i * DAY_MS)

  for (const snap of snapshots) {
    if (!snap) continue
    const mrs = (snap.mrs ?? []).map((mr) => decorate(mr, meLogin))
    let open = 0, merged = 0, closed = 0, needsReview = 0, unresolved = 0, failing = 0, drafts = 0, mergedWeek = 0, lastActivity = 0
    for (const mr of mrs) {
      allMrs.push({ ...mr, repoKey: snap.repoKey, repoPath: snap.repo?.path, repoName: snap.repo?.name })
      if (mr.state === 'open') { open++; if (mr.draft) drafts++ } else if (mr.state === 'merged') merged++; else closed++
      if (mr.needsMyReview) needsReview++
      if (mr.state === 'open' && mr.ciState === 'failure') failing++
      if (mr.mergedAt && new Date(mr.mergedAt).getTime() >= weekAgo) mergedWeek++
      const upd = new Date(mr.updatedAt).getTime(); if (upd > lastActivity) lastActivity = upd
      const created = new Date(mr.createdAt).getTime()
      if (created >= now - 30 * DAY_MS) dayBucket(created).opened++
      if (mr.mergedAt) { const mt = new Date(mr.mergedAt).getTime(); if (mt >= now - 30 * DAY_MS) dayBucket(mt).merged++ }
      events.push({ type: mr.state === 'merged' ? 'merged' : 'opened', at: mr.state === 'merged' ? mr.mergedAt : mr.createdAt, repoKey: snap.repoKey, repoName: snap.repo?.name, mrNumber: mr.number, title: mr.title, actor: mr.author?.name ?? mr.author?.login, state: mr.state })
      for (const rv of mr.reviews ?? []) {
        const key = rv.author?.login || 'unknown'
        if (!reviewerAgg.has(key)) reviewerAgg.set(key, { login: key, name: rv.author?.name || key, reviews: 0, approvals: 0, changesRequested: 0, comments: 0, unresolved: 0 })
        const agg = reviewerAgg.get(key); agg.reviews++
        if (rv.state === 'approved') agg.approvals++; if (rv.state === 'changes_requested') agg.changesRequested++
        if (rv.submittedAt) events.push({ type: 'review', at: rv.submittedAt, repoKey: snap.repoKey, repoName: snap.repo?.name, mrNumber: mr.number, title: mr.title, actor: rv.author?.name ?? rv.author?.login, reviewState: rv.state })
      }
      for (const c of mr.comments ?? []) {
        const key = c.author?.login || 'unknown'
        if (!reviewerAgg.has(key)) reviewerAgg.set(key, { login: key, name: c.author?.name || key, reviews: 0, approvals: 0, changesRequested: 0, comments: 0, unresolved: 0 })
        const agg = reviewerAgg.get(key); agg.comments++; if (!c.resolved) { agg.unresolved++; unresolved++ }
        const ct = new Date(c.createdAt).getTime(); if (ct >= now - 30 * DAY_MS) dayBucket(ct).comments++
        allComments.push({
          id: c.id, repoKey: snap.repoKey, repoPath: snap.repo?.path, repoName: snap.repo?.name,
          mrNumber: mr.number, mrTitle: mr.title, mrState: mr.state, mrUrl: mr.url || '',
          author: c.author, body: c.body, file: c.file, line: c.line, createdAt: c.createdAt,
          resolved: !!c.resolved, needsReply: commentNeedsReply(mr, c, meLogin), kind: 'comment',
        })
        events.push({ type: 'comment', at: c.createdAt, repoKey: snap.repoKey, repoName: snap.repo?.name, mrNumber: mr.number, title: mr.title, actor: c.author?.name ?? c.author?.login })
      }
      statusDist.open += mr.state === 'open' ? 1 : 0; statusDist.merged += mr.state === 'merged' ? 1 : 0; statusDist.closed += mr.state === 'closed' ? 1 : 0
    }
    repos.push({
      key: snap.repoKey, name: snap.repo?.name, owner: snap.repo?.owner, path: snap.repo?.path,
      description: snap.repo?.description ?? '', defaultBranch: snap.repo?.defaultBranch ?? '',
      source: snap.source, degradedNote: snap.degradedNote ?? null, error: snap.error ?? null,
      fetchedAt: snap.fetchedAt, demo: false, localPath: snap.repo?.localPath ?? '', url: snap.repo?.remoteUrl ?? '',
      counts: { open, merged, closed, needsReview, unresolved, failingCi: failing, drafts, mergedWeek, total: mrs.length },
      lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
    })
  }

  const activity = [...dayMap.values()].sort((a, b) => a.date < b.date ? -1 : 1)
  const topReviewers = [...reviewerAgg.values()].map((r) => ({ ...r, score: r.comments + r.reviews * 2 })).sort((a, b) => b.score - a.score).slice(0, 8)
  events.sort((a, b) => new Date(b.at) - new Date(a.at))

  const summary = {
    repos: repos.length, errors: repos.filter((r) => r.error || r.source === 'error').length,
    openMrs: statusDist.open, mergedMrs: statusDist.merged, closedMrs: statusDist.closed,
    needsReview: allMrs.filter((m) => m.needsMyReview).length, drafts: repos.reduce((s, r) => s + r.counts.drafts, 0),
    unresolvedComments: allComments.filter((c) => !c.resolved).length,
    needsReply: allComments.filter((c) => c.needsReply).length,
    failingCi: repos.reduce((s, r) => s + r.counts.failingCi, 0),
    mergedThisWeek: repos.reduce((s, r) => s + r.counts.mergedWeek, 0),
    totalComments: allComments.length,
    me: meLogin ? { login: meLogin, name: cfg.me?.name || meLogin } : null,
  }
  return { summary, repos, statusDist, activity, topReviewers, recent: events.slice(0, 24), generatedAt: new Date().toISOString() }
}

function filterMrs(allMrs, params) {
  const { repoKey, state, q, needsReview, unresolved, author, sort, limit, ci } = params
  let out = allMrs
  if (repoKey) out = out.filter((m) => m.repoKey === repoKey)
  if (state && state !== 'all') out = out.filter((m) => m.state === state)
  if (needsReview) out = out.filter((m) => m.needsMyReview)
  if (unresolved) out = out.filter((m) => m.unresolvedCount > 0)
  if (author) out = out.filter((m) => m.author?.login === author || m.author?.name === author)
  if (ci) out = out.filter((m) => (m.ciState || 'none') === ci)
  if (q) { const s = String(q).toLowerCase(); out = out.filter((m) => m.title?.toLowerCase().includes(s) || String(m.number).includes(s) || m.author?.name?.toLowerCase().includes(s) || m.author?.login?.toLowerCase().includes(s) || m.sourceBranch?.toLowerCase().includes(s) || (m.labels ?? []).some((l) => l.toLowerCase().includes(s))) }
  out = [...out]
  if (sort === 'created') out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  else if (sort === 'comments') out.sort((a, b) => b.unresolvedCount - a.unresolvedCount || b.commentCount - a.commentCount)
  else out.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  const lim = Math.max(1, Math.min(500, Number(limit) || 200))
  return { total: out.length, mrs: out.slice(0, lim).map((m) => ({
    number: m.number, title: m.title, author: m.author, state: m.state, draft: m.draft,
    sourceBranch: m.sourceBranch, targetBranch: m.targetBranch,
    createdAt: m.createdAt, updatedAt: m.updatedAt, mergedAt: m.mergedAt,
    additions: m.additions, deletions: m.deletions, changedFiles: m.changedFiles,
    labels: m.labels, ciState: m.ciState, reviewDecision: m.reviewDecision,
    requestedReviewers: m.requestedReviewers, url: m.url,
    needsMyReview: m.needsMyReview, commentCount: m.commentCount, unresolvedCount: m.unresolvedCount,
    needsReplyCount: m.needsReplyCount, reviewCount: m.reviewCount,
    repoKey: m.repoKey, repoPath: m.repoPath, repoName: m.repoName,
  })) }
}

/* ===================== workspace repo discovery ===================== */

async function discoverGitRepos(ws, depth = 2) {
  const found = []; const root = resolve(String(ws || ''))
  if (!root || !existsSync(root)) return found
  const walk = async (dir, level) => {
    if (level > depth || found.length >= 40) return
    let entries; try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (found.length >= 40) return; if (!e.isDirectory()) continue
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue
      const p = join(dir, e.name)
      try {
        const st = await stat(join(p, '.git'))
        if (st) {
          const remote = await git(['remote', 'get-url', 'origin'], p)
          const head = await git(['symbolic-ref', '--short', 'HEAD'], p)
          found.push({ path: p, name: e.name, remote: remote.code === 0 ? remote.stdout.trim() : '', remotePath: remote.code === 0 ? (parseRemotePath(remote.stdout.trim()) ?? '') : '', branch: head.code === 0 ? head.stdout.trim() : '' })
          continue
        }
      } catch {}
      await walk(p, level + 1)
    }
  }
  try { const st = await stat(join(root, '.git')); if (st) {
    const remote = await git(['remote', 'get-url', 'origin'], root); const head = await git(['symbolic-ref', '--short', 'HEAD'], root)
    found.push({ path: root, name: basename(root), remote: remote.code === 0 ? remote.stdout.trim() : '', remotePath: remote.code === 0 ? (parseRemotePath(remote.stdout.trim()) ?? '') : '', branch: head.code === 0 ? head.stdout.trim() : '' })
  } } catch {}
  await walk(root, 1); return found
}

/* ===================== connectivity tests ===================== */

async function testTargets(cfg, fetcher) {
  const results = []
  const gitVer = await run('git', ['--version'])
  results.push({ target: 'git', kind: 'cli', ok: gitVer.code === 0, detail: clip(gitVer.stdout.trim() || gitVer.stderr, 160), ms: null })
  const ghRes = await fetcher.ghProbe(cfg)
  results.push({ target: cfg.ghPath || 'gh', kind: 'gh-cli', ok: !!ghRes.ok, detail: clip(ghRes.detail ?? '', 200), ms: ghRes.ms ?? null })
  for (const inst of cfg.instances ?? []) {
    if (!inst.token) { results.push({ target: inst.name || inst.id, kind: 'instance-token', ok: false, detail: 'token 未配置' }); continue }
    const t0 = Date.now()
    try {
      const host = inst.host || 'github.com'
      const apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`
      const res = await fetch(`${apiBase}/rate_limit`, { headers: { accept: 'application/json', authorization: `Bearer ${inst.token}`, 'user-agent': `dsh-codehub-dashboard/${PLUGIN_VERSION}` }, signal: AbortSignal.timeout(8000) })
      results.push({ target: inst.name || inst.id, kind: 'http-api', ok: res.ok, detail: `HTTP ${res.status} ${host}`, ms: Date.now() - t0 })
    } catch (err) { results.push({ target: inst.name || inst.id, kind: 'http-api', ok: false, detail: clip(err?.message ?? String(err), 200), ms: Date.now() - t0 }) }
  }
  for (const repo of (cfg.repos ?? []).filter((r) => r.enabled !== false)) {
    if (!repo.localPath) continue
    const ok = await isGitRepo(repo.localPath)
    results.push({ target: repo.path || repo.localPath, kind: 'local-repo', ok, detail: ok ? repo.localPath : `不是有效的 git 仓库: ${repo.localPath}` })
  }
  return results
}

/* ===================== HTTP plumbing ===================== */

// Serve web/index.html with a process-level cache validated by mtime, so
// repeat requests skip a 56KB disk read without risking stale content.
let htmlCache = { mtimeMs: 0, body: '' }
function readDashboardHtml() {
  const file = join(webRoot, 'index.html')
  const st = statSync(file)
  if (!htmlCache.body || st.mtimeMs !== htmlCache.mtimeMs) {
    htmlCache = { mtimeMs: st.mtimeMs, body: readFileSync(file, 'utf8') }
  }
  return htmlCache.body
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolveP, rejectP) => {
    let size = 0; let destroyed = false; const chunks = []
    req.on('data', (c) => {
      if (destroyed) return
      size += c.length
      if (size > limit) { destroyed = true; rejectP(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => { if (!destroyed) resolveP(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', (err) => { if (!destroyed) { destroyed = true; rejectP(err) } })
  })
}

/* ===================== plugin entry ===================== */

export function apply(ctx, loaderConfig = {}) {
  const log = ctx.logger ?? console
  const configPath = String(loaderConfig?.configPath || process.env.CODEHUB_DASHBOARD_CONFIG || join(homedir(), '.dsh', 'codehub-dashboard', 'config.json'))
  const store = createConfigStore(configPath, log)
  const fetcher = createFetcher(store, log)
  let lastRefreshAt = 0, booted = false

  const ensureBoot = async () => {
    if (booted) return
    try { await store.init(); booted = true } catch (err) { booted = false; throw err }
  }
  const snapshots = async (force = false) => { await ensureBoot(); const list = await fetcher.refreshAll(force); lastRefreshAt = Date.now(); return list }
  const overviewFrom = (snaps, cfg) => buildOverview(snaps, cfg)

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix', path: '/codehub',
      handler: async (req, res) => {
        const sendJson = (obj, status = 200) => { const body = JSON.stringify(obj); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(body) }
        try {
          await ensureBoot()
          const url = new URL(req.url, 'http://localhost'); const pathname = url.pathname; const q = url.searchParams
          if (pathname === '/codehub' || pathname === '/codehub/' || pathname === '/codehub/index.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(readDashboardHtml()); return
          }
          if (pathname !== '/codehub/api') { sendJson({ ok: false, error: 'not-found' }, 404); return }

          const op = q.get('op') || 'boot'; const cfg = store.get()

          if (op === 'boot') {
            const snaps = fetcher.cached(); const overview = snaps.length ? overviewFrom(snaps, cfg) : null
            sendJson({ ok: true, version: PLUGIN_VERSION, config: store.masked(), configPath, summary: overview?.summary ?? null, hasData: !!overview, generatedAt: overview?.generatedAt ?? null }); return
          }
          if (op === 'summary') {
            const snaps = fetcher.cached(); const overview = overviewFrom(snaps, cfg)
            sendJson({ ok: true, summary: overview.summary, generatedAt: overview.generatedAt, cached: snaps.length > 0 }); return
          }
          if (op === 'overview') {
            const snaps = await snapshots(q.get('force') === '1'); const overview = overviewFrom(snaps, cfg)
            sendJson({ ok: true, overview, lastRefreshAt }); return
          }
          if (op === 'mrs') {
            const snaps = await snapshots(); const meLogin = (cfg.me?.login || '').trim(); const all = []
            for (const snap of snaps) for (const mr of snap.mrs ?? []) all.push({ ...decorate(mr, meLogin), repoKey: snap.repoKey, repoPath: snap.repo?.path, repoName: snap.repo?.name })
            const filtered = filterMrs(all, { repoKey: q.get('repoKey') || '', state: q.get('state') || 'all', q: q.get('q') || '', needsReview: q.get('needsReview') === '1', unresolved: q.get('unresolved') === '1', author: q.get('author') || '', sort: q.get('sort') || 'updated', limit: q.get('limit') || 200, ci: q.get('ci') || '' })
            sendJson({ ok: true, ...filtered }); return
          }
          if (op === 'mr') {
            const repoKey = q.get('repoKey') || ''; const number = Number(q.get('number') || 0); const snaps = await snapshots(); const meLogin = (cfg.me?.login || '').trim()
            for (const snap of snaps) { if (snap.repoKey !== repoKey) continue; const mr = (snap.mrs ?? []).find((m) => m.number === number)
              if (mr) { const d = decorate(mr, meLogin); d.comments = (mr.comments ?? []).map((c) => ({ ...c, needsReply: commentNeedsReply(mr, c, meLogin) })); sendJson({ ok: true, mr: d, repo: snap.repo, source: snap.source }); return } }
            sendJson({ ok: false, error: 'mr-not-found' }, 404); return
          }
          if (op === 'reviews') {
            const snaps = await snapshots(); const meLogin = (cfg.me?.login || '').trim(); let comments = []
            for (const snap of snaps) for (const mr of snap.mrs ?? []) for (const c of mr.comments ?? []) comments.push({ id: c.id, repoKey: snap.repoKey, repoPath: snap.repo?.path, repoName: snap.repo?.name, mrNumber: mr.number, mrTitle: mr.title, mrState: mr.state, mrUrl: mr.url || '', author: c.author, body: c.body, file: c.file, line: c.line, createdAt: c.createdAt, resolved: !!c.resolved, needsReply: commentNeedsReply(mr, c, meLogin), kind: 'comment' })
            const rk = q.get('repoKey') || ''; if (rk) comments = comments.filter((c) => c.repoKey === rk)
            if (q.get('unresolved') === '1') comments = comments.filter((c) => !c.resolved)
            if (q.get('needsReply') === '1') comments = comments.filter((c) => c.needsReply)
            const s = (q.get('q') || '').toLowerCase(); if (s) comments = comments.filter((c) => c.body?.toLowerCase().includes(s) || c.author?.name?.toLowerCase().includes(s) || c.file?.toLowerCase().includes(s) || c.mrTitle?.toLowerCase().includes(s))
            comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            const limit = Math.max(1, Math.min(1000, Number(q.get('limit') || 300)))
            sendJson({ ok: true, comments: comments.slice(0, limit), total: comments.length }); return
          }
          if (op === 'activity') { const snaps = await snapshots(); const overview = overviewFrom(snaps, cfg); sendJson({ ok: true, activity: overview.activity, recent: overview.recent, topReviewers: overview.topReviewers }); return }
          if (op === 'refresh') { const snaps = await snapshots(true); const overview = overviewFrom(snaps, cfg); sendJson({ ok: true, overview, lastRefreshAt }); return }
          if (op === 'config.get') { sendJson({ ok: true, config: store.masked(), configPath }); return }
          if (op === 'config.set') {
            if (req.method !== 'POST') { sendJson({ ok: false, error: 'POST required' }, 405); return }
            const raw = await readBody(req); let patch; try { patch = JSON.parse(raw || '{}') } catch { sendJson({ ok: false, error: 'invalid json' }, 400); return }
            await store.set(patch); fetcher.invalidate()
            const snaps = await snapshots(true); sendJson({ ok: true, config: store.masked(), overview: overviewFrom(snaps, store.get()) }); return
          }
          if (op === 'config.test') {
            if (req.method !== 'POST') { sendJson({ ok: false, error: 'POST required' }, 405); return }
            const results = await testTargets(cfg, fetcher); sendJson({ ok: true, results }); return
          }
          if (op === 'repos.discover') {
            const ws = q.get('ws') || ''; if (!ws) { sendJson({ ok: false, error: 'ws required' }, 400); return }
            const depth = Math.max(1, Math.min(3, Number(q.get('depth') || 2))); const repos = await discoverGitRepos(ws, depth)
            sendJson({ ok: true, repos }); return
          }
          sendJson({ ok: false, error: `unknown op: ${op}` }, 400)
        } catch (err) {
          log?.warn?.('[codehub] api error:', err)
          try { if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: clip(err?.message ?? String(err), 300) })) } } catch {}
        }
      },
    })

    const ticker = setInterval(() => {
      const cfg = store.get(); const ttl = Math.max(1, Number(cfg.pollMinutes) || 10) * 60_000
      if (booted && Date.now() - lastRefreshAt > ttl) snapshots(false).catch((err) => log?.warn?.('[codehub] background refresh failed:', err?.message ?? err))
    }, 60_000)
    const warmup = setTimeout(() => { snapshots(false).catch((err) => log?.warn?.('[codehub] initial refresh failed:', err?.message ?? err)) }, 3000)

    return () => { clearInterval(ticker); clearTimeout(warmup); disposeRoute() }
  }, 'codehub-dashboard.routes')
}
