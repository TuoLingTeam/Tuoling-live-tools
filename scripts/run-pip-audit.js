#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { selectSupportedPython } = require('./auth-python-utils')

const rootDir = process.cwd()
const requirementsPath = path.join(rootDir, 'auth-api', 'requirements.txt')

function run(command, args) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  })
}

try {
  const selected = selectSupportedPython(rootDir)
  const displayName = `${selected.command} ${selected.args.join(' ')}`.trim()
  console.log(`[audit:pip] 使用 Python 解释器: ${displayName} (${selected.version})`)

  run(selected.command, [
    ...selected.args,
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--quiet',
    '--user',
    'pip-audit',
  ])
  run(selected.command, [...selected.args, '-m', 'pip_audit', '-r', requirementsPath])
} catch (error) {
  console.error(`[audit:pip] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
