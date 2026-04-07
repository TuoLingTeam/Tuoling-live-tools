const { spawnSync } = require('node:child_process')

function getCandidates(isWindows) {
  return isWindows
    ? [
        { command: 'py', args: ['-3.11'] },
        { command: 'py', args: ['-3.10'] },
        { command: 'python', args: [] },
      ]
    : [
        { command: 'python3.11', args: [] },
        { command: 'python3.10', args: [] },
        { command: 'python3', args: [] },
      ]
}

function getPythonVersion(rootDir, candidate) {
  const result = spawnSync(
    candidate.command,
    [
      ...candidate.args,
      '-c',
      'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")',
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
    },
  )

  if (result.status !== 0) {
    return null
  }

  return result.stdout.trim()
}

function isSupportedVersion(version) {
  const [major, minor] = version.split('.').map(Number)
  return major > 3 || (major === 3 && minor >= 10)
}

function selectSupportedPython(rootDir = process.cwd()) {
  const candidates = getCandidates(process.platform === 'win32')
  const discovered = []

  for (const candidate of candidates) {
    const version = getPythonVersion(rootDir, candidate)
    if (!version) continue

    discovered.push(`${candidate.command} ${candidate.args.join(' ')}`.trim() + ` (${version})`)
    if (isSupportedVersion(version)) {
      return { ...candidate, version, discovered }
    }
  }

  const details =
    discovered.length > 0 ? `已发现但不满足要求的解释器: ${discovered.join(', ')}` : '未找到可用 Python 解释器'
  throw new Error(`auth-api 需要 Python 3.10 或更高版本。${details}`)
}

module.exports = {
  selectSupportedPython,
}
