#!/usr/bin/env node
// Publish gate: the git tag must be exactly `v` + package.json version.
// Usage: node scripts/check-version.mjs v0.1.5
//        (or let GITHUB_REF_NAME supply the tag in GitHub Actions)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || ''
const expected = `v${version}`

if (!tag) {
  console.error(`usage: node scripts/check-version.mjs <tag>  (expected ${expected})`)
  process.exit(1)
}
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error(`tag "${tag}" is not in vX.Y.Z form (expected ${expected})`)
  process.exit(1)
}
if (tag !== expected) {
  console.error(`tag "${tag}" does not match package.json version "${version}" (expected ${expected})`)
  process.exit(1)
}
console.log(`tag ${tag} matches package.json version ${version}`)
