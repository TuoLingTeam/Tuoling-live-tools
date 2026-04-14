import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'
import { getOrCreateSecretMaterial } from './secretMaterial'

const ALGORITHM = 'aes-256-gcm'
const KEY_LEN = 32
const IV_LEN = 16
const SALT_LEN = 32

let cachedSecretMaterial: string | null = null

function deriveKey(key: string, salt: Buffer): Buffer {
  return scryptSync(key, salt, KEY_LEN)
}

function getSecretMaterial(customKey?: string): string {
  const normalizedCustomKey = customKey?.trim()
  if (normalizedCustomKey) {
    return normalizedCustomKey
  }

  if (cachedSecretMaterial) {
    return cachedSecretMaterial
  }

  const keyFilePath = path.join(app.getPath('userData'), 'auth', '.key')
  cachedSecretMaterial = getOrCreateSecretMaterial({
    envSecret: process.env.AUTH_STORAGE_SECRET,
    filePath: keyFilePath,
    logPrefix: '[main/utils/crypto]',
  })
  return cachedSecretMaterial
}

export function encrypt(text: string, customKey?: string): string {
  const key = getSecretMaterial(customKey)
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)

  const cipherKey = deriveKey(key, salt)
  const cipher = createCipheriv(ALGORITHM, cipherKey, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return (
    salt.toString('hex') +
    ':' +
    iv.toString('hex') +
    ':' +
    authTag.toString('hex') +
    ':' +
    encrypted
  )
}

export function decrypt(encryptedText: string, customKey?: string): string {
  const key = getSecretMaterial(customKey)

  const parts = encryptedText.split(':')
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format')
  }

  const salt = Buffer.from(parts[0], 'hex')
  const iv = Buffer.from(parts[1], 'hex')
  const authTag = Buffer.from(parts[2], 'hex')
  const encrypted = parts[3]

  const cipherKey = deriveKey(key, salt)
  const decipher = createDecipheriv(ALGORITHM, cipherKey, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

export function hashCode(code: string): string {
  const salt = `giftcard-hash-salt:${getSecretMaterial()}`
  return scryptSync(code, salt, 32).toString('hex')
}
