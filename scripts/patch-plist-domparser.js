#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const target = path.join(process.cwd(), 'node_modules', 'plist', 'lib', 'parse.js')
const legacyCall = 'new DOMParser().parseFromString(xml);'
const patchedCall = "new DOMParser().parseFromString(xml, 'application/xml');"

if (!fs.existsSync(target)) {
  console.log('[patch-plist-domparser] plist parse.js not found, skipping')
  process.exit(0)
}

const source = fs.readFileSync(target, 'utf8')

if (source.includes(patchedCall)) {
  console.log('[patch-plist-domparser] already patched')
  process.exit(0)
}

if (!source.includes(legacyCall)) {
  console.warn('[patch-plist-domparser] legacy DOMParser call not found, skipping')
  process.exit(0)
}

fs.writeFileSync(target, source.replace(legacyCall, patchedCall))
console.log('[patch-plist-domparser] patched plist DOMParser mimeType')
