/**
 * AI API Key 存储：
 * - 官方构建/CI/服务端链路要求显式设置 AUTH_STORAGE_SECRET
 * - 终端用户打包客户端首次运行时，允许在本地 userData 生成 .key 作为设备密钥
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { providers } from 'shared/providers'
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

export type StoredAIApiKeys = Partial<Record<keyof typeof providers, string>>

function getPrimaryStoragePath(): string {
  const userData = app.getPath('userData')
  const dir = path.join(userData, 'auth')
  return path.join(dir, 'ai-api-keys.enc')
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
    logPrefix: '[AISecretsStorage]',
  })
  return cachedSecretMaterial
}

function sanitizeApiKeys(apiKeys: StoredAIApiKeys): StoredAIApiKeys {
  return Object.fromEntries(
    Object.entries(apiKeys).filter(
      ([, value]) => typeof value === 'string' && value.trim().length > 0,
    ),
  ) as StoredAIApiKeys
}

export function getStoredAIApiKeys(): StoredAIApiKeys {
  const filePath = getStoragePath()
  if (!existsSync(filePath)) return {}

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
    return sanitizeApiKeys(JSON.parse(text) as StoredAIApiKeys)
  } catch (error) {
    console.error('[AISecretsStorage] Failed to get stored API keys:', error)
    return {}
  }
}

export function setStoredAIApiKeys(apiKeys: StoredAIApiKeys): void {
  const sanitized = sanitizeApiKeys(apiKeys)

  if (Object.keys(sanitized).length === 0) {
    clearStoredAIApiKeys()
    return
  }

  try {
    const filePath = getStoragePath()
    const secretMaterial = getSecretMaterial()
    const salt = randomBytes(SALT_LEN)
    const keyDerived = deriveEncryptionKey(secretMaterial, salt, KEY_LEN)
    const iv = randomBytes(IV_LEN)
    const enc = createCipheriv(ALG, keyDerived, iv)
    const plain = JSON.stringify(sanitized)
    const encBuf = Buffer.concat([enc.update(plain, 'utf8'), enc.final()])
    const tag = enc.getAuthTag()
    writeFileSync(filePath, Buffer.concat([salt, iv, encBuf, tag]), { mode: 0o600 })
    ensurePrivateFile(filePath)
  } catch (err) {
    console.error('[AISecretsStorage] Failed to store API keys:', err)
    throw err
  }
}

export function clearStoredAIApiKeys(): void {
  const filePath = getStoragePath()
  if (!existsSync(filePath)) return

  try {
    unlinkSync(filePath)
  } catch (error) {
    console.warn('[AISecretsStorage] Failed to clear stored API keys:', error)
  }
}
