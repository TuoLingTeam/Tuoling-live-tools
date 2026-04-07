import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type { App } from 'electron'

type StartupLogs = {
  debugStartupLog: (message: string) => void
  writeStartupLog: (message: string) => void
}

export type AppPathResolution = {
  mainDist: string
  rendererDist: string
  viteDevServerUrl: string | undefined
  preloadPath: string
  indexHtmlPath: string
}

export function resolveAppPaths(params: {
  app: App
  startupDebug: boolean
  logs: StartupLogs
}): AppPathResolution {
  const { app, startupDebug, logs } = params
  const __dirname = path.dirname(fileURLToPath(import.meta.url))

  process.env.APP_ROOT = path.join(__dirname, '../..')

  const mainDist = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'dist-electron')
    : path.join(process.env.APP_ROOT, 'dist-electron')

  const rendererDist = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'dist')
    : path.join(process.env.APP_ROOT, 'dist')

  const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL

  process.env.VITE_PUBLIC = viteDevServerUrl
    ? path.join(process.env.APP_ROOT, 'public')
    : app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'public')
      : path.join(process.env.APP_ROOT, 'public')

  const possiblePreloadPaths = [
    path.join(__dirname, '../preload/index.js'),
    path.join(__dirname, '../preload/index.mjs'),
    path.join(mainDist, 'preload/index.js'),
    path.join(mainDist, 'preload/index.mjs'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked/dist-electron/preload/index.js'),
    path.join(process.resourcesPath || '', 'app/dist-electron/preload/index.js'),
  ]

  let preloadPath = ''
  for (const candidate of possiblePreloadPaths) {
    if (existsSync(candidate)) {
      preloadPath = candidate
      logs.debugStartupLog(`找到 preload: ${candidate}`)
      break
    }
  }

  if (!preloadPath) {
    logs.writeStartupLog('警告: 未找到 preload 文件，将尝试使用默认路径')
    preloadPath = possiblePreloadPaths[0]
  }

  const indexHtmlPath = path.join(rendererDist, 'index.html')

  logs.debugStartupLog(`index.html 路径: ${indexHtmlPath}`)
  logs.debugStartupLog(`index.html 存在: ${existsSync(indexHtmlPath)}`)
  logs.debugStartupLog(`RENDERER_DIST: ${rendererDist}`)
  logs.debugStartupLog(`MAIN_DIST: ${mainDist}`)

  if (startupDebug) {
    logs.writeStartupLog('========== 路径诊断开始 ==========')
    logs.debugStartupLog(`__dirname: ${__dirname}`)
    logs.debugStartupLog(`process.env.APP_ROOT: ${process.env.APP_ROOT}`)
    logs.debugStartupLog(`app.getAppPath(): ${app.getAppPath()}`)
    logs.debugStartupLog(`process.resourcesPath: ${process.resourcesPath || 'N/A'}`)
    logs.debugStartupLog(`process.execPath: ${process.execPath}`)
    logs.debugStartupLog(`process.cwd(): ${process.cwd()}`)

    try {
      if (existsSync(rendererDist)) {
        const files = readdirSync(rendererDist)
        logs.debugStartupLog(`RENDERER_DIST 目录内容: ${files.join(', ')}`)
      } else {
        logs.debugStartupLog(`RENDERER_DIST 目录不存在: ${rendererDist}`)
      }
    } catch (error) {
      logs.debugStartupLog(`无法读取 RENDERER_DIST: ${error}`)
    }

    const asarPath = path.join(process.resourcesPath || '', 'app.asar')
    logs.debugStartupLog(`app.asar 路径: ${asarPath}`)
    logs.debugStartupLog(`app.asar 存在: ${existsSync(asarPath)}`)

    const unpackedPath = path.join(process.resourcesPath || '', 'app.asar.unpacked')
    logs.debugStartupLog(`app.asar.unpacked 路径: ${unpackedPath}`)
    logs.debugStartupLog(`app.asar.unpacked 存在: ${existsSync(unpackedPath)}`)
    logs.writeStartupLog('========== 路径诊断结束 ==========')
  }

  return {
    mainDist,
    rendererDist,
    viteDevServerUrl,
    preloadPath,
    indexHtmlPath,
  }
}
