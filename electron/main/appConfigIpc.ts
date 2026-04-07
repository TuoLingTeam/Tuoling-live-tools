import { ipcMain } from 'electron'
import type { AppConfig } from './appConfigStore'

type RegisterAppConfigIpcOptions = {
  getConfig: () => AppConfig
  setConfig: (config: AppConfig) => void
  writeStartupLog: (message: string) => void
}

export function registerAppConfigIpc({
  getConfig,
  setConfig,
  writeStartupLog,
}: RegisterAppConfigIpcOptions) {
  ipcMain.handle('app:setHideToTrayTipDismissed', (_, dismissed: boolean) => {
    writeStartupLog(`IPC: setHideToTrayTipDismissed=${dismissed}`)
    const config = getConfig()
    config.hideToTrayTipDismissed = dismissed
    setConfig(config)
  })

  ipcMain.handle('app:getHideToTrayTipDismissed', () => {
    const config = getConfig()
    writeStartupLog(`IPC: getHideToTrayTipDismissed=${config.hideToTrayTipDismissed}`)
    return config.hideToTrayTipDismissed
  })

  ipcMain.handle('app:getCloseBehavior', () => {
    const config = getConfig()
    writeStartupLog(`IPC: getCloseBehavior=${config.closeBehavior}`)
    return config.closeBehavior || 'tray'
  })

  ipcMain.handle('app:setCloseBehavior', (_, behavior: 'tray' | 'quit') => {
    writeStartupLog(`IPC: setCloseBehavior=${behavior}`)
    const config = getConfig()
    config.closeBehavior = behavior
    setConfig(config)
  })
}
