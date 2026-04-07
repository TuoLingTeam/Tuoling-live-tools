import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { App } from 'electron'
import { createLogger } from './logger'

export interface AppConfig {
  hideToTrayTipDismissed: boolean
  closeBehavior?: 'tray' | 'quit'
}

export function createAppConfigStore(app: App) {
  const getConfigPath = () => path.join(app.getPath('userData'), 'app-config.json')

  function getConfig(): AppConfig {
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8')
        const parsed = JSON.parse(content) as AppConfig
        if (!parsed.closeBehavior) {
          parsed.closeBehavior = 'tray'
        }
        return parsed
      } catch (error) {
        createLogger('config').error('Failed to read config file:', error)
      }
    }

    return {
      hideToTrayTipDismissed: false,
      closeBehavior: 'tray',
    }
  }

  function setConfig(config: AppConfig) {
    const configPath = getConfigPath()
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (error) {
      createLogger('config').error('Failed to write config file:', error)
    }
  }

  return {
    getConfig,
    setConfig,
  }
}
