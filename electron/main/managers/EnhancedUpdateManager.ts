import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, platform } from 'node:os'
import path from 'node:path'
import { app, net, shell } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import windowManager from '#/windowManager'
import { createLogger, isAppQuitting } from '../logger'
import { errorMessage, sleep } from '../utils'
import type { BackupInfo } from './RollbackManager'
import { UpdateErrorCode, updateErrorHandler } from './UpdateErrorHandler'
import {
  ensureTrailingSlash,
  fetchChangelog,
  GITHUB_UPDATE_SOURCE,
  getGitHubReleaseDownloadURL,
  getRollbackManager,
  isRollbackOperational,
  type LatestYml,
  loadSemver,
  loadYaml,
  normalizeUpdateSource,
  OFFICIAL_UPDATE_SOURCE,
  type UpdateCheckResult,
  type Updater,
} from './updateShared'

const logger = createLogger('enhanced-update')

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'paused' | 'ready' | 'error'
  versionInfo: {
    currentVersion: string
    latestVersion: string
    releaseNotes?: string
  } | null
  progress: number
  error: string | null
}

class EnhancedUpdateManager {
  private currentState: UpdateState = {
    status: 'idle',
    versionInfo: null,
    progress: 0,
    error: null,
  }

  private autoCheckInterval: NodeJS.Timeout | null = null
  private isDownloading = false
  private readonly platformUpdater: Updater

  constructor() {
    this.platformUpdater =
      platform() === 'darwin' ? new EnhancedMacOSUpdater(this) : new EnhancedWindowsUpdater(this)
    logger.info('EnhancedUpdateManager initialized')
  }

  getState(): UpdateState {
    return { ...this.currentState }
  }

  async checkUpdateVersion(source = OFFICIAL_UPDATE_SOURCE): Promise<UpdateCheckResult | null> {
    try {
      this.handleCheckingStart()
      logger.info(`Checking for updates, source: ${source || 'default'}`)

      if (!app.isPackaged) {
        logger.warn('Update check skipped: app is not packaged')
        return null
      }

      return await this.platformUpdater.checkForUpdates(source)
    } catch (error) {
      const errorMsg = errorMessage(error)
      logger.error('Failed to check for updates:', errorMsg)
      await this.handleUpdaterError(errorMsg, { recoverable: true, canRollback: false })
      return null
    }
  }

  async silentCheckForUpdate(source = OFFICIAL_UPDATE_SOURCE): Promise<void> {
    try {
      await this.checkUpdateVersion(source)
    } catch (error) {
      logger.warn('Silent update check failed:', errorMessage(error))
    }
  }

  async startDownload(): Promise<void> {
    if (this.isDownloading) {
      logger.warn('Download already in progress')
      return
    }

    try {
      this.isDownloading = true
      this.updateState({ status: 'downloading', progress: 0, error: null })
      logger.info('Starting download using unified platform updater')
      await this.platformUpdater.downloadUpdate()
    } catch (error) {
      const errorMsg = errorMessage(error)
      logger.error('Download failed:', errorMsg)
      await this.handleUpdaterError(errorMsg, { recoverable: true, canRollback: true })
    } finally {
      this.isDownloading = false
    }
  }

  async pauseDownload(): Promise<void> {
    throw new Error('EnhancedUpdateManager does not support pauseDownload yet')
  }

  async resumeDownload(): Promise<void> {
    throw new Error('EnhancedUpdateManager does not support resumeDownload yet')
  }

  async cancelDownload(): Promise<void> {
    throw new Error('EnhancedUpdateManager does not support cancelDownload yet')
  }

  async quitAndInstall(): Promise<void> {
    logger.info('Preparing to quit and install update')
    await this.platformUpdater.quitAndInstall()
  }

  async rollback(targetVersion?: string): Promise<boolean> {
    logger.info(`Rolling back to version: ${targetVersion || 'latest'}`)

    try {
      const rollbackManager = await getRollbackManager()
      const latestBackup = rollbackManager.getLatestBackup()
      if (!targetVersion && !latestBackup) {
        logger.warn('No backup available for rollback')
        return false
      }

      let success: boolean
      if (targetVersion) {
        success = await rollbackManager.rollbackToVersion(targetVersion)
      } else {
        success = await rollbackManager.restoreBackup(latestBackup!.id)
      }

      if (success) {
        this.updateState({ status: 'idle', versionInfo: null })
        this.sendToRenderer(IPC_CHANNELS.updater.updateAvailable, {
          update: false,
          version: app.getVersion(),
          newVersion: app.getVersion(),
        })
      }

      return success
    } catch (error) {
      logger.error('Rollback failed:', error)
      return false
    }
  }

  async listBackups(): Promise<BackupInfo[]> {
    return await (await getRollbackManager()).listBackups()
  }

  setAutoCheck(enabled: boolean, intervalMs = 3600000): void {
    if (enabled && !this.autoCheckInterval) {
      this.autoCheckInterval = setInterval(() => {
        this.checkUpdateVersion()
      }, intervalMs)
      logger.info(`Auto check enabled, interval: ${intervalMs}ms`)
    } else if (!enabled && this.autoCheckInterval) {
      clearInterval(this.autoCheckInterval)
      this.autoCheckInterval = null
      logger.info('Auto check disabled')
    }
  }

  private updateState(partial: Partial<UpdateState>): void {
    this.currentState = { ...this.currentState, ...partial }
  }

  handleCheckingStart(): void {
    this.updateState({ status: 'checking', error: null })
  }

  handleUpdateAvailable(result: UpdateCheckResult): void {
    this.updateState({
      status: 'available',
      versionInfo: {
        currentVersion: result.version,
        latestVersion: result.newVersion,
        releaseNotes: result.releaseNote,
      },
      error: null,
    })
    this.sendToRenderer(IPC_CHANNELS.updater.updateAvailable, result)
  }

  handleNoUpdate(result?: Pick<UpdateCheckResult, 'version' | 'newVersion'>): void {
    this.updateState({
      status: 'idle',
      versionInfo: null,
      progress: 0,
      error: null,
    })
    this.sendToRenderer(IPC_CHANNELS.updater.updateAvailable, {
      update: false,
      version: result?.version || app.getVersion(),
      newVersion: result?.newVersion || app.getVersion(),
    })
  }

  handleDownloadProgress(progressInfo: ProgressInfo): void {
    this.updateState({
      status: 'downloading',
      progress: progressInfo.percent,
      error: null,
    })
    this.sendToRenderer(IPC_CHANNELS.updater.downloadProgress, progressInfo)
  }

  handleDownloadReady(event?: UpdateDownloadedEvent): void {
    this.updateState({
      status: 'ready',
      progress: 100,
      error: null,
    })
    this.sendToRenderer(IPC_CHANNELS.updater.updateDownloaded, event)
  }

  async handleUpdaterError(
    message: string,
    options: { downloadURL?: string; recoverable?: boolean; canRollback?: boolean } = {},
  ): Promise<void> {
    this.updateState({
      status: 'error',
      error: message,
    })

    const canRollback = options.canRollback ?? (await isRollbackOperational())
    const updateError = updateErrorHandler.createError(UpdateErrorCode.UNKNOWN_ERROR, message, {
      recoverable: options.recoverable ?? true,
      canRollback,
      details: { downloadURL: options.downloadURL },
    })
    await updateErrorHandler.handleError(updateError)

    this.sendToRenderer(IPC_CHANNELS.updater.updateError, {
      message,
      ...(options.downloadURL ? { downloadURL: options.downloadURL } : {}),
    })
  }

  private sendToRenderer(channel: string, data?: any): void {
    // 应用退出时不发送任何消息到渲染进程
    if (isAppQuitting) {
      return
    }
    windowManager.send(channel as any, data)
  }
}

class EnhancedWindowsUpdater implements Updater {
  private autoUpdater: AppUpdater

  constructor(private readonly manager: EnhancedUpdateManager) {
    const { autoUpdater }: { autoUpdater: AppUpdater } = createRequire(import.meta.url)(
      'electron-updater',
    )
    this.autoUpdater = autoUpdater
    this.configureUpdater()
    this.registerEventListener()
  }

  private configureUpdater() {
    this.autoUpdater.forceDevUpdateConfig = true
    this.autoUpdater.disableWebInstaller = false
    this.autoUpdater.allowDowngrade = false
    this.autoUpdater.autoDownload = false
  }

  private registerEventListener() {
    this.autoUpdater.on('checking-for-update', () => {
      logger.debug('Checking for update...')
      this.manager.handleCheckingStart()
    })

    this.autoUpdater.on('update-available', async (info: UpdateInfo) => {
      if (isAppQuitting) return
      logger.info(`Update available: ${info.version}`)

      if (await isRollbackOperational()) {
        try {
          const rollbackManager = await getRollbackManager()
          const backup = await rollbackManager.createBackup(app.getVersion())
          logger.info(`Backup created: ${backup.id}`)
        } catch (error) {
          logger.warn('Failed to create backup:', error)
        }
      } else {
        logger.info('Skipping backup creation: rollback runtime is not operational')
      }

      const releaseNote = await fetchChangelog()
      this.manager.handleUpdateAvailable({
        update: true,
        version: app.getVersion(),
        newVersion: info.version,
        releaseNote,
      })
    })

    this.autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      if (isAppQuitting) return
      logger.info(`No update available: ${info.version}`)
      this.manager.handleNoUpdate({
        version: app.getVersion(),
        newVersion: info.version,
      })
    })

    this.autoUpdater.on('download-progress', (progressInfo: ProgressInfo) => {
      if (isAppQuitting) return
      this.manager.handleDownloadProgress(progressInfo)
    })

    this.autoUpdater.on('update-downloaded', async (event: UpdateDownloadedEvent) => {
      if (isAppQuitting) return
      logger.info(`Update downloaded: ${event.version}`)

      try {
        // electron-updater itself already verifies downloaded package integrity.
        this.manager.handleDownloadReady(event)
      } catch (error) {
        logger.error('Verification error:', error)
      }
    })

    this.autoUpdater.on('error', async (error: Error) => {
      if (isAppQuitting) return
      logger.error('Update error:', error.message)
      await this.manager.handleUpdaterError(error.message, {
        recoverable: true,
        canRollback: true,
      })
    })
  }

  async checkForUpdates(source: string): Promise<UpdateCheckResult | null> {
    this.autoUpdater.requestHeaders = { authorization: '' }

    try {
      if (!app.isPackaged) {
        if (!this.autoUpdater.forceDevUpdateConfig) {
          await this.manager.handleUpdaterError('更新功能仅在应用打包后可用。', {
            recoverable: false,
            canRollback: false,
          })
          return null
        }
      }

      const normalizedSource = normalizeUpdateSource(source)
      logger.debug(`Checking for updates, source: ${normalizedSource}`)

      if (normalizedSource === GITHUB_UPDATE_SOURCE) {
        // 使用默认 GitHub provider 配置（从 electron-builder.json 读取）
        const result = await this.autoUpdater.checkForUpdates()
        const newVersion = result?.updateInfo?.version || app.getVersion()
        const semver = await loadSemver()
        return {
          update: semver.gt(newVersion, app.getVersion()),
          version: app.getVersion(),
          newVersion,
          releaseNote: semver.gt(newVersion, app.getVersion()) ? await fetchChangelog() : undefined,
        }
      }

      let sourceURL: URL
      try {
        sourceURL = new URL(normalizedSource)
      } catch {
        throw new Error(`更新源设置错误: ${normalizedSource}`)
      }

      this.autoUpdater.setFeedURL({
        provider: 'generic',
        url: sourceURL.toString().replace(/\/+$/, ''),
      })

      const result = await this.autoUpdater.checkForUpdates()
      const newVersion = result?.updateInfo?.version || app.getVersion()
      const semver = await loadSemver()
      return {
        update: semver.gt(newVersion, app.getVersion()),
        version: app.getVersion(),
        newVersion,
        releaseNote: semver.gt(newVersion, app.getVersion()) ? await fetchChangelog() : undefined,
      }
    } catch (error) {
      if (isAppQuitting) return null
      const message = `检查更新时发生错误：${errorMessage(error).split('\n')[0]}`
      logger.error(message)
      await this.manager.handleUpdaterError(message, {
        recoverable: true,
        canRollback: false,
      })
      return null
    }
  }

  downloadUpdate() {
    this.autoUpdater.downloadUpdate()
  }

  quitAndInstall() {
    // Windows 使用静默安装，并在安装完成后自动重新拉起应用。
    this.autoUpdater.quitAndInstall(true, true)
  }
}

class EnhancedMacOSUpdater implements Updater {
  private versionInfo: LatestYml | null = null
  private assetsBaseURL: string | null = null
  private savePath: string | null = null

  constructor(private readonly manager: EnhancedUpdateManager) {}

  async checkForUpdates(source: string): Promise<UpdateCheckResult | null> {
    try {
      const normalizedSource = normalizeUpdateSource(source)
      const assetsBaseURL =
        normalizedSource === GITHUB_UPDATE_SOURCE
          ? getGitHubReleaseDownloadURL()
          : ensureTrailingSlash(new URL(normalizedSource).toString())
      this.assetsBaseURL = assetsBaseURL

      const cacheBuster = `_t=${Date.now()}`
      const latestYmlURL = new URL(`latest-mac.yml?${cacheBuster}`, assetsBaseURL).href
      const ymlContent = (await net.fetch(latestYmlURL).then(res => res.text())) as string
      const yaml = await loadYaml()
      const latestYml = yaml.parse(ymlContent) as LatestYml

      if (!latestYml) {
        throw new Error('获取文件更新信息失败')
      }

      this.versionInfo = latestYml
      const semver = await loadSemver()

      if (!semver.gt(latestYml.version, app.getVersion())) {
        logger.info(`${app.getVersion()} 已经是最新版本`)
        if (!isAppQuitting) {
          this.manager.handleNoUpdate({
            version: app.getVersion(),
            newVersion: latestYml.version,
          })
        }
        return {
          update: false,
          version: app.getVersion(),
          newVersion: latestYml.version,
        }
      }

      logger.info(`Update available: ${app.getVersion()} -> ${latestYml.version}`)

      if (await isRollbackOperational()) {
        const rollbackManager = await getRollbackManager()
        const backup = await rollbackManager.createBackup(app.getVersion())
        logger.info(`Backup created: ${backup.id}`)
      } else {
        logger.info('Skipping backup creation: rollback runtime is not operational')
      }

      const releaseNote =
        normalizedSource === GITHUB_UPDATE_SOURCE ? await fetchChangelog() : undefined
      if (!isAppQuitting) {
        this.manager.handleUpdateAvailable({
          update: true,
          version: app.getVersion(),
          newVersion: latestYml.version,
          releaseNote,
        })
      }
      return {
        update: true,
        version: app.getVersion(),
        newVersion: latestYml.version,
        releaseNote,
      }
    } catch (err) {
      if (isAppQuitting) return null
      const message = errorMessage(err)
      logger.error(message)
      await this.manager.handleUpdaterError(message, {
        recoverable: true,
        canRollback: false,
      })
      return null
    }
  }

  async downloadUpdate() {
    if (!this.versionInfo) {
      throw new Error('No version info available')
    }

    let fileUrl: string | undefined
    let setupFile: any | undefined

    try {
      const ext = '.dmg'
      const archName = arch()

      setupFile = this.versionInfo.files.find(file => {
        if (!file.url.endsWith(ext)) return false
        const possibleArchs = [archName, 'universal', '']
        return possibleArchs.some(arch => file.url.includes(arch))
      })

      if (!setupFile) {
        throw new Error(`找不到安装包文件 (${platform()}-${archName})`)
      }

      this.savePath = path.join(app.getPath('downloads'), '秀儿直播助手-update-setup.dmg')

      if (existsSync(this.savePath)) {
        const localFileSha512 = await this.calculateFileHash(this.savePath)
        if (localFileSha512 === setupFile.sha512) {
          logger.debug('Local file exists and matches, skipping download')
          if (!isAppQuitting) {
            this.manager.handleDownloadReady()
          }
          return
        }
      }

      fileUrl = new URL(setupFile.url, this.assetsBaseURL!).href
      const resp = await net.fetch(fileUrl)

      if (!resp.ok) {
        throw new Error(`网络错误: ${resp.statusText}`)
      }

      const totalBytes = Number.parseInt(resp.headers.get('Content-Length') ?? '0', 10)
      logger.debug(`Downloading file, size: ${totalBytes / 1024 / 1024} MB`)

      let downloadBytes = 0
      const reader = resp.body?.getReader()

      if (!reader) {
        throw new Error('获取文件流失败')
      }

      if (existsSync(this.savePath)) {
        unlinkSync(this.savePath)
      }
      const fileWriter = createWriteStream(this.savePath)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        downloadBytes += value.length
        fileWriter.write(value)

        if (totalBytes > 0) {
          const progress = (downloadBytes / totalBytes) * 100
          if (!isAppQuitting) {
            this.manager.handleDownloadProgress({
              percent: progress,
              transferred: downloadBytes,
              total: totalBytes,
              bytesPerSecond: 0,
            } as any)
          }
        }
      }

      fileWriter.end()
      logger.debug('File download complete')
      if (!isAppQuitting) {
        this.manager.handleDownloadReady()
      }
    } catch (err) {
      if (isAppQuitting) return
      const message = `下载文件失败：${errorMessage(err)}`
      logger.error(message)
      await this.manager.handleUpdaterError(message, {
        downloadURL: fileUrl,
        recoverable: true,
        canRollback: true,
      })
    }
  }

  async quitAndInstall() {
    if (!this.savePath) {
      throw new Error('未指定下载文件路径')
    }

    if (existsSync(this.savePath)) {
      await shell.openPath(this.savePath)
      await sleep(3000)
      if (isAppQuitting) return
      app.quit()
    } else {
      logger.error(`下载文件 ${this.savePath} 不存在`)
    }
  }

  private calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha512')
      const stream = createReadStream(filePath)

      stream.on('data', chunk => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('base64')))
      stream.on('error', reject)
    })
  }
}

export const enhancedUpdateManager = new EnhancedUpdateManager()
