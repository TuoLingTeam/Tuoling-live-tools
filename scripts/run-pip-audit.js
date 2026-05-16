#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { selectSupportedPython } = require('./auth-python-utils')

const rootDir = process.cwd()
const authApiDir = path.join(rootDir, 'auth-api')
const requirementsPath = path.join(authApiDir, 'requirements.txt')
const isWindows = process.platform === 'win32'

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  })
}

function getVenvPythonPath(venvDir) {
  return isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

function getPurelibPath(pythonPath) {
  return execFileSync(
    pythonPath,
    ['-c', 'import sysconfig; print(sysconfig.get_paths()["purelib"])'],
    {
      cwd: rootDir,
      encoding: 'utf8',
    },
  ).trim()
}

function createTempVenv(sourcePython) {
  const tempVenvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiuer-pip-audit-'))
  run(sourcePython.command, [...sourcePython.args, '-m', 'venv', tempVenvDir])
  return {
    venvDir: tempVenvDir,
    pythonPath: getVenvPythonPath(tempVenvDir),
    cleanup: () => fs.rmSync(tempVenvDir, { recursive: true, force: true }),
  }
}

function resolveAuditRunner() {
  const projectVenvPython = getVenvPythonPath(path.join(authApiDir, '.venv'))
  if (fs.existsSync(projectVenvPython)) {
    return {
      pythonPath: projectVenvPython,
      cleanup: null,
      source: 'auth-api/.venv',
    }
  }

  const selected = selectSupportedPython(rootDir)
  const displayName = `${selected.command} ${selected.args.join(' ')}`.trim()
  const tempVenv = createTempVenv(selected)

  run(tempVenv.pythonPath, ['-m', 'pip', 'install', '--quiet', 'pip-audit'])

  return {
    pythonPath: tempVenv.pythonPath,
    cleanup: tempVenv.cleanup,
    source: `${displayName} -> temp venv`,
  }
}

function createAuditTarget() {
  const selected = selectSupportedPython(rootDir)
  const tempVenv = createTempVenv(selected)

  run(tempVenv.pythonPath, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--quiet',
    '--upgrade',
    'pip>=26.1',
  ])
  run(tempVenv.pythonPath, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--quiet',
    '-r',
    requirementsPath,
  ])

  return {
    ...tempVenv,
    purelibPath: getPurelibPath(tempVenv.pythonPath),
  }
}

const cleanups = []

try {
  const runner = resolveAuditRunner()
  if (runner.cleanup) cleanups.push(runner.cleanup)
  const target = createAuditTarget()
  cleanups.push(target.cleanup)

  console.log(`[audit:pip] 使用 Python 环境: ${runner.source}`)

  run(runner.pythonPath, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--quiet',
    'pip-audit',
  ])

  run(runner.pythonPath, [
    '-m',
    'pip_audit',
    '--progress-spinner',
    'off',
    '--path',
    target.purelibPath,
  ])
} catch (error) {
  console.error(`[audit:pip] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  for (const cleanup of cleanups.reverse()) {
    cleanup()
  }
}
