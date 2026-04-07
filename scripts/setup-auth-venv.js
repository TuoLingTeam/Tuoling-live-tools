#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { selectSupportedPython } = require('./auth-python-utils')

const rootDir = process.cwd()
const authApiDir = path.join(rootDir, 'auth-api')
const venvDir = path.join(authApiDir, '.venv')
const isWindows = process.platform === 'win32'

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  })
}

function main() {
  const selected = selectSupportedPython(rootDir)
  const displayName = `${selected.command} ${selected.args.join(' ')}`.trim()
  console.log(`[auth:venv] 使用 Python 解释器: ${displayName} (${selected.version})`)

  fs.rmSync(venvDir, { recursive: true, force: true })
  run(selected.command, [...selected.args, '-m', 'venv', venvDir])

  const venvPython = isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')

  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  run(venvPython, ['-m', 'pip', 'install', '-r', path.join(authApiDir, 'requirements.txt')])
}

try {
  main()
} catch (error) {
  console.error(`[auth:venv] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
