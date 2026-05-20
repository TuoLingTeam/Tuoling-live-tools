import { dialog } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { typedIpcMainHandle } from '#/utils'
import {
  findChromium,
  listDetectedBrowsers,
  validateBrowserExecutableFile,
} from '#/utils/checkChrome'

let browserSessionManagerPromise: Promise<
  typeof import('#/managers/BrowserSessionManager')
> | null = null

async function getBrowserManager() {
  if (!browserSessionManagerPromise) {
    browserSessionManagerPromise = import('#/managers/BrowserSessionManager')
  }
  return (await browserSessionManagerPromise).browserManager
}

function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.chrome.listBrowsers, async (_, preferEdge = false) => {
    return await listDetectedBrowsers(preferEdge)
  })

  typedIpcMainHandle(IPC_CHANNELS.chrome.getPath, async (_, edge) => {
    const path = await findChromium(edge)
    return path
  })

  typedIpcMainHandle(IPC_CHANNELS.chrome.testBrowser, async (_, browserPath: string) => {
    return await (await getBrowserManager()).testBrowserLaunch(browserPath)
  })

  typedIpcMainHandle(IPC_CHANNELS.chrome.selectPath, async () => {
    // 打开文件选择器，允许用户选择任意浏览器可执行文件
    if (process.platform === 'darwin') {
      dialog.showErrorBox(
        '无法选择文件',
        '考虑到安全性，暂时不向 MacOS 平台提供浏览器路径的选择，请使用上方的自动检测浏览器功能',
      )
      // const result = await dialog.showOpenDialog({
      //   properties: ['openFile', 'treatPackageAsDirectory'],
      //   defaultPath: '/Applications',
      // })

      // if (result.canceled || result.filePaths.length === 0) {
      //   return null
      // }

      // const selectedPath = result.filePaths[0]
      // const pathParts = selectedPath.split(path.sep)

      // // 必须是可执行文件
      // const looksLikeMacExecutable =
      //   pathParts.includes('Contents') &&
      //   pathParts.includes('MacOS') &&
      //   fs.existsSync(selectedPath) &&
      //   !fs.lstatSync(selectedPath).isDirectory()

      // const executableName = path.basename(selectedPath)
      // const isValidName =
      //   executableName === 'Google Chrome' || executableName === 'Microsoft Edge'
      // if (looksLikeMacExecutable && isValidName) {
      //   return selectedPath
      // }
      // dialog.showErrorBox(
      //   '无效的选择',
      //   `选择的文件（${executableName}）似乎不是正确的可执行文件。\n\n请进入应用程序包（例如 Google Chrome.app）内部，找到 'Contents' -> 'MacOS' 文件夹，并选择名为 'Google Chrome' 或 'Microsoft Edge' 的文件。`,
      // )
    } else {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'treatPackageAsDirectory'],
        filters: [{ name: 'Browser Executable', extensions: ['exe'] }],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      const selectedPath = result.filePaths[0]
      const validation = validateBrowserExecutableFile(selectedPath)
      if (!validation.valid) {
        dialog.showErrorBox('无效的浏览器路径', validation.reason)
        return null
      }

      return validation.normalizedPath
    }
    return null
  })
}

export function setupBrowserIpcHandlers() {
  setupIpcHandlers()
}
