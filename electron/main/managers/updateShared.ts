import { net } from 'electron'
import { getUpdateUrl } from '../../config/download'

export const OFFICIAL_UPDATE_SOURCE = 'official'
export const GITHUB_UPDATE_SOURCE = 'github'
const OFFICIAL_UPDATE_URL = getUpdateUrl()

export type LatestYml = {
  version: string
  files: Array<{
    url: string
    sha512: string
    size: number
  }>
  path: string
  sha512: string
  releaseDate: string
}

type SemverModule = typeof import('semver')
type YamlModule = typeof import('yaml')
type RollbackManagerModule = typeof import('./RollbackManager')

export type UpdateCheckResult = {
  update: boolean
  version: string
  newVersion: string
  releaseNote?: string
}

export interface Updater {
  checkForUpdates(source: string): Promise<UpdateCheckResult | null>
  downloadUpdate(): void | Promise<void>
  quitAndInstall(): void | Promise<void>
}

let semverModulePromise: Promise<SemverModule> | null = null
let yamlModulePromise: Promise<YamlModule> | null = null
let rollbackManagerModulePromise: Promise<RollbackManagerModule> | null = null

export function loadSemver() {
  if (!semverModulePromise) {
    semverModulePromise = import('semver')
  }
  return semverModulePromise
}

export function loadYaml() {
  if (!yamlModulePromise) {
    yamlModulePromise = import('yaml')
  }
  return yamlModulePromise
}

function loadRollbackManagerModule() {
  if (!rollbackManagerModulePromise) {
    rollbackManagerModulePromise = import('./RollbackManager')
  }
  return rollbackManagerModulePromise
}

export async function getRollbackManager() {
  const module = await loadRollbackManagerModule()
  return module.rollbackManager
}

export async function isRollbackOperational(): Promise<boolean> {
  try {
    return (await getRollbackManager()).isOperational()
  } catch {
    return false
  }
}

export async function fetchChangelog(): Promise<string | undefined> {
  try {
    const response = await net.fetch(
      'https://api.github.com/repos/Xiuer-Chinese/Xiuer-live-tools/releases/latest',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Accept: 'application/vnd.github.v3+json',
        },
      },
    )
    if (!response.ok) return undefined
    const data = (await response.json()) as { body: string }
    return data.body
  } catch {
    return undefined
  }
}

export function getGitHubReleaseDownloadURL() {
  return 'https://github.com/Xiuer-Chinese/Xiuer-live-tools/releases/latest/download/'
}

export function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`
}

export function normalizeUpdateSource(source?: string) {
  const trimmed = source?.trim()

  if (!trimmed || trimmed === OFFICIAL_UPDATE_SOURCE) {
    return OFFICIAL_UPDATE_URL
  }

  return trimmed
}
