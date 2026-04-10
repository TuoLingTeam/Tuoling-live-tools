/**
 * 云鉴权 Token 存储：主进程读写，优先安全存储。
 * 当前实现：加密文件（AES 简单封装）。可选接入 keytar（系统凭据库），见文档说明。
 * 运行时策略：
 * - 官方构建/CI/服务端链路要求显式设置 AUTH_STORAGE_SECRET
 * - 终端用户打包客户端首次运行时，允许在本地 userData 生成 .key 作为设备密钥
 * 风险：加密文件仍可能被提取后离线破解，生产建议接入 keytar 或系统钥匙串。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  deriveEncryptionKey,
  ensurePrivateDir,
  ensurePrivateFile,
  getOrCreateSecretMaterial,
} from '#/utils/secretMaterial'

const ALG = 'aes-256-gcm'
const KEY_LEN = 32
const IV_LEN = 16
const SALT_LEN = 32
const TAG_LEN = 16

let cachedStoragePath: string | null = null
let cachedSecretMaterial: string | null = null

function getPrimaryStoragePath(): string {
  const userData = app.getPath('userData')
  const dir = path.join(userData, 'auth')
  return path.join(dir, 'tokens.enc')
}

function getStoragePath(): string {
  if (cachedStoragePath) {
    return cachedStoragePath
  }

  const primaryPath = getPrimaryStoragePath()
  ensurePrivateDir(path.dirname(primaryPath))
  cachedStoragePath = primaryPath
  return primaryPath
}

function getSecretMaterial(): string {
  if (cachedSecretMaterial) {
    return cachedSecretMaterial
  }

  const keyFilePath = path.join(app.getPath('userData'), 'auth', '.key')
  cachedSecretMaterial = getOrCreateSecretMaterial({
    envSecret: process.env.AUTH_STORAGE_SECRET,
    filePath: keyFilePath,
    logPrefix: '[CloudAuthStorage]',
  })
  return cachedSecretMaterial
}

export interface StoredTokens {
  access_token: string | null
  refresh_token: string | null
}

export function getStoredTokens(): StoredTokens {
  const filePath = getStoragePath()
  if (!existsSync(filePath)) return { access_token: null, refresh_token: null }
  try {
    const raw = readFileSync(filePath)
    const secretMaterial = getSecretMaterial()
    const salt = raw.subarray(0, SALT_LEN)
    const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN)
    const tag = raw.subarray(raw.length - TAG_LEN)
    const enc = raw.subarray(SALT_LEN + IV_LEN, raw.length - TAG_LEN)
    const keyDerived = deriveEncryptionKey(secretMaterial, salt, KEY_LEN)
    const dec = createDecipheriv(ALG, keyDerived, iv)
    dec.setAuthTag(tag)
    const text = Buffer.concat([dec.update(enc), dec.final()]).toString('utf8')
    const data = JSON.parse(text) as StoredTokens
    return {
      access_token: data.access_token ?? null,
      refresh_token: data.refresh_token ?? null,
    }
  } catch (error) {
    console.error('[CloudAuthStorage] Failed to get stored tokens:', error)
    return { access_token: null, refresh_token: null }
  }
}

export function setStoredTokens(tokens: StoredTokens): void {
  try {
    const filePath = getStoragePath()
    const secretMaterial = getSecretMaterial()
    const salt = randomBytes(SALT_LEN)
    const keyDerived = deriveEncryptionKey(secretMaterial, salt, KEY_LEN)
    const iv = randomBytes(IV_LEN)
    const enc = createCipheriv(ALG, keyDerived, iv)
    const plain = JSON.stringify(tokens)
    const encBuf = Buffer.concat([enc.update(plain, 'utf8'), enc.final()])
    const tag = enc.getAuthTag()
    writeFileSync(filePath, Buffer.concat([salt, iv, encBuf, tag]), { mode: 0o600 })
    ensurePrivateFile(filePath)
  } catch (err) {
    console.error('[CloudAuthStorage] Failed to store tokens:', err)
    throw err
  }
}

/**
 * 修正已有 token 文件权限
 * 在应用启动时调用，确保历史文件权限正确
 */
export function fixTokenFilePermissions(): void {
  try {
    const filePath = getStoragePath()
    ensurePrivateDir(path.dirname(filePath))
    if (existsSync(filePath)) {
      ensurePrivateFile(filePath)
    }
    const keyFilePath = path.join(app.getPath('userData'), 'auth', '.key')
    if (existsSync(keyFilePath)) {
      ensurePrivateFile(keyFilePath)
    }
  } catch (err) {
    console.warn('[CloudAuthStorage] Failed to fix token file permissions:', err)
  }
}

export function clearStoredTokens(): void {
  const filePath = getStoragePath()
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
    } catch (error) {
      console.warn('[CloudAuthStorage] Failed to clear stored tokens:', error)
    }
  }
}
