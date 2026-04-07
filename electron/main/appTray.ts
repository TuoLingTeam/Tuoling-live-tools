import path from 'node:path'
import { type App, type BrowserWindow, Menu, type NativeImage, nativeImage, Tray } from 'electron'

type CreateAppTrayOptions = {
  app: App
  getMainWindow: () => BrowserWindow | null
  createWindow: () => void
  quitApp: () => void
  vitePublicPath: string
  writeStartupLog: (message: string) => void
  writeMainLog: (level: string, message: string) => void
}

export function createAppTray({
  app,
  getMainWindow,
  createWindow,
  quitApp,
  vitePublicPath,
  writeStartupLog,
  writeMainLog,
}: CreateAppTrayOptions): Tray {
  writeStartupLog('createTray 开始')

  const iconPath = path.join(vitePublicPath, 'favicon.png')
  let trayIcon: NativeImage

  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.getSize().width > 16) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 })
    }
    writeStartupLog('托盘图标加载成功')
  } catch (error) {
    writeStartupLog(`托盘图标加载失败: ${error}`)
    writeMainLog('WARN', `Failed to load tray icon: ${error}`)
    trayIcon = nativeImage.createEmpty()
  }

  const tray = new Tray(trayIcon)
  tray.setToolTip(app.getName())
  writeStartupLog('托盘已创建')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        writeStartupLog('托盘菜单: 显示主窗口')
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.show()
          win.setSkipTaskbar(false)
          win.focus()
          win.moveTop()
          writeStartupLog('主窗口已显示')
        } else {
          writeStartupLog('主窗口不存在，创建新窗口')
          createWindow()
        }
      },
    },
    {
      type: 'separator',
    },
    {
      label: '退出程序',
      click: () => {
        writeStartupLog('托盘菜单: 退出程序')
        quitApp()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    writeStartupLog('托盘点击事件')
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      if (win.isVisible()) {
        win.focus()
        writeStartupLog('托盘点击: 窗口已可见，执行聚焦')
      } else {
        win.show()
        win.setSkipTaskbar(false)
        win.focus()
        writeStartupLog('托盘点击: 窗口已显示并聚焦')
      }
    } else {
      writeStartupLog('托盘点击: 窗口不存在，创建新窗口')
      createWindow()
    }
  })

  writeStartupLog('createTray 完成')
  return tray
}
