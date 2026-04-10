import { randomBytes, scryptSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'

const PRIVATE_DIR_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

const cachedSecrets = new Map<string, string>()

type SecretEnvelope =
  | {
      version: 2
      mode: 'safe-storage'
      payload: string
    }
  | {
      version: 2
      mode: 'plain'
      payload: string
    }

function isProductionRuntime(): boolean {
  return app.isPackaged || process.env.NODE_ENV === 'production'
}

export function ensurePrivateDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE })
  }
  try {
    chmodSync(dirPath, PRIVATE_DIR_MODE)
  } catch {
    // 忽略 chmod 失败，调用方会在后续写文件时得到更具体的错误。
  }
}

export function ensurePrivateFile(filePath: string, mode = PRIVATE_FILE_MODE): void {
  if (!existsSync(filePath)) {
    return
  }
  try {
    chmodSync(filePath, mode)
  } catch {
    // 某些平台上 chmod 可能不可用，静默忽略即可。
  }
}

function readSecretEnvelope(raw: string, logPrefix: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  if (!trimmed.startsWith('{')) {
    return trimmed.length >= 32 ? trimmed : null
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<SecretEnvelope>
    if (parsed.version !== 2 || typeof parsed.payload !== 'string') {
      return null
    }

    if (parsed.mode === 'safe-storage') {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn(`${logPrefix} safeStorage 不可用，无法读取加密设备密钥`)
        return null
      }
      return safeStorage.decryptString(Buffer.from(parsed.payload, 'base64'))
    }

    if (parsed.mode === 'plain') {
      return parsed.payload.trim() || null
    }
  } catch (error) {
    console.warn(`${logPrefix} 解析设备密钥失败:`, error)
  }

  return null
}

function readSecretFromFile(filePath: string, logPrefix: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }
    const raw = readFileSync(filePath, 'utf8')
    const secret = readSecretEnvelope(raw, logPrefix)
    return secret && secret.length >= 32 ? secret : null
  } catch (error) {
    console.warn(`${logPrefix} 读取设备密钥失败:`, error)
    return null
  }
}

function persistSecretToFile(filePath: string, secret: string): void {
  ensurePrivateDir(path.dirname(filePath))

  const payload = safeStorage.isEncryptionAvailable()
    ? JSON.stringify({
        version: 2,
        mode: 'safe-storage',
        payload: safeStorage.encryptString(secret).toString('base64'),
      } satisfies SecretEnvelope)
    : JSON.stringify({
        version: 2,
        mode: 'plain',
        payload: secret,
      } satisfies SecretEnvelope)

  writeFileSync(filePath, payload, { mode: PRIVATE_FILE_MODE })
  ensurePrivateFile(filePath)
}

export function getOrCreateSecretMaterial(options: {
  envSecret?: string | null
  filePath: string
  logPrefix: string
  allowEphemeralFallback?: boolean
}): string {
  const {
    envSecret,
    filePath,
    logPrefix,
    allowEphemeralFallback = !isProductionRuntime(),
  } = options

  const normalizedEnvSecret = envSecret?.trim()
  if (normalizedEnvSecret) {
    if (normalizedEnvSecret.length < 32) {
      throw new Error(`${logPrefix} AUTH_STORAGE_SECRET 长度不足 32 字符`)
    }
    return normalizedEnvSecret
  }

  const cached = cachedSecrets.get(filePath)
  if (cached) {
    return cached
  }

  const storedSecret = readSecretFromFile(filePath, logPrefix)
  if (storedSecret) {
    cachedSecrets.set(filePath, storedSecret)
    return storedSecret
  }

  const generatedSecret = randomBytes(32).toString('hex')
  try {
    persistSecretToFile(filePath, generatedSecret)
    cachedSecrets.set(filePath, generatedSecret)
    return generatedSecret
  } catch (error) {
    if (!allowEphemeralFallback) {
      throw new Error(
        `${logPrefix} 无法持久化设备密钥: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    console.warn(
      `${logPrefix} 无法持久化设备密钥，已退回到当前进程内存密钥；重启后需重新建立本地会话`,
      error,
    )
    cachedSecrets.set(filePath, generatedSecret)
    return generatedSecret
  }
}

export function deriveEncryptionKey(
  secretMaterial: string,
  salt: Buffer,
  keyLength: number,
): Buffer {
  return scryptSync(secretMaterial, salt, keyLength)
}
