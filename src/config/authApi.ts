/**
 * Auth API 基址：与 authApiBase.ts 约定一致，渲染进程 getMe/refresh/status 等用此 base。
 * 正式环境统一通过 https://auth.xiuer.work 对外访问。
 */
import { AUTH_API_BASE } from './authApiBase'

const metaEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env

// 【修复】增加 trim() 处理，避免前后空格导致 URL 解析失败
const rawBase = (metaEnv?.VITE_AUTH_API_BASE_URL ?? AUTH_API_BASE).trim()

// 直接使用配置的基址（默认来自 AUTH_API_BASE），不再强制改写端口
export const API_BASE_URL = rawBase

export const isCloudAuthEnabled = (): boolean => {
  const url = metaEnv?.VITE_AUTH_API_BASE_URL ?? AUTH_API_BASE
  return typeof url === 'string' && url.length > 0
}
