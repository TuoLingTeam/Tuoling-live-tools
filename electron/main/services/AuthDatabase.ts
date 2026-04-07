import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import type { AuthToken, User, UserConfig } from 'shared/auth'
import { v4 as uuidv4 } from 'uuid'

// Database row types
interface UserRow {
  id: string
  username: string
  email: string
  password_hash: string
  created_at: string
  last_login: string | null
  status: string
  license_type: string
  expiry_date: string | null
  device_id: string
  machine_fingerprint: string
  balance: number
}

interface AuthTokenRow {
  token: string
  user_id: string
  expires_at: string
  device_info: string
  last_used: string
}

interface UserConfigRow {
  id: string
  user_id: string
  config_data: string
  platform: string
  created_at: string
  updated_at: string
}

export class AuthDatabase {
  private db: Database.Database

  constructor() {
    const userDataPath = app.getPath('userData')

    let dbDir = userDataPath
    if (!existsSync(userDataPath)) {
      dbDir = app.getPath('temp')
    }

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    const dbPath = join(dbDir, 'auth.db')
    this.db = new Database(dbPath)
    this.initTables()
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        license_type TEXT NOT NULL DEFAULT 'free',
        expiry_date TEXT,
        device_id TEXT,
        machine_fingerprint TEXT,
        balance INTEGER NOT NULL DEFAULT 0
      )
    `)

    // Auth tokens table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        device_info TEXT,
        last_used TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `)

    // User configs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_configs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        config_data TEXT NOT NULL,
        platform TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `)

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_configs_user_id ON user_configs(user_id);
    `)
  }

  // User operations
  createUser(user: Omit<User, 'id' | 'createdAt'>): User {
    const id = uuidv4()
    const now = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO users (
        id, username, email, password_hash, created_at, last_login,
        status, license_type, expiry_date, device_id, machine_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      user.username,
      user.email,
      user.passwordHash,
      now,
      user.lastLogin,
      user.status,
      user.plan,
      user.expire_at ?? null,
      user.deviceId,
      user.machineFingerprint,
    )

    return {
      id,
      ...user,
      createdAt: now,
    }
  }

  getUserByUsername(username: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?')
    const row = stmt.get(username) as UserRow | undefined
    return row ? this.mapRowToUser(row) : null
  }

  getUserByEmail(email: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?')
    const row = stmt.get(email) as UserRow | undefined
    return row ? this.mapRowToUser(row) : null
  }

  getUserById(id: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?')
    const row = stmt.get(id) as UserRow | undefined
    return row ? this.mapRowToUser(row) : null
  }

  updateUserLastLogin(userId: string): void {
    const stmt = this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?')
    stmt.run(new Date().toISOString(), userId)
  }

  updateUserAccount(
    userId: string,
    data: {
      balance?: number
      plan?: User['plan']
      expire_at?: string | null
    },
  ): void {
    const updates: string[] = []
    const values: (string | number | null)[] = []

    if (data.balance !== undefined) {
      updates.push('balance = ?')
      values.push(data.balance)
    }
    if (data.plan !== undefined) {
      updates.push('license_type = ?')
      values.push(data.plan)
    }
    if (data.expire_at !== undefined) {
      updates.push('expiry_date = ?')
      values.push(data.expire_at ?? null)
    }

    if (updates.length > 0) {
      values.push(userId)
      const stmt = this.db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      stmt.run(...values)
    }
  }

  // Token operations
  createToken(token: Omit<AuthToken, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO auth_tokens (token, user_id, expires_at, device_info, last_used)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(token.token, token.userId, token.expiresAt, token.deviceInfo, token.lastUsed)
  }

  getToken(token: string): AuthToken | null {
    const stmt = this.db.prepare('SELECT * FROM auth_tokens WHERE token = ?')
    const row = stmt.get(token) as AuthTokenRow | undefined
    return row ? this.mapRowToToken(row) : null
  }

  updateTokenLastUsed(token: string): void {
    const stmt = this.db.prepare('UPDATE auth_tokens SET last_used = ? WHERE token = ?')
    stmt.run(new Date().toISOString(), token)
  }

  deleteToken(token: string): void {
    const stmt = this.db.prepare('DELETE FROM auth_tokens WHERE token = ?')
    stmt.run(token)
  }

  deleteExpiredTokens(): void {
    const stmt = this.db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?')
    stmt.run(new Date().toISOString())
  }

  // Config operations
  saveUserConfig(config: Omit<UserConfig, 'id' | 'createdAt' | 'updatedAt'>): UserConfig {
    const id = uuidv4()
    const now = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO user_configs (id, user_id, config_data, platform, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(id, config.userId, config.configData, config.platform, now, now)

    return {
      id,
      ...config,
      createdAt: now,
      updatedAt: now,
    }
  }

  getUserConfig(userId: string, platform: string): UserConfig | null {
    const stmt = this.db.prepare('SELECT * FROM user_configs WHERE user_id = ? AND platform = ?')
    const row = stmt.get(userId, platform) as UserConfigRow | undefined
    return row ? this.mapRowToConfig(row) : null
  }

  updateUserConfig(configId: string, configData: string): void {
    const stmt = this.db.prepare(
      'UPDATE user_configs SET config_data = ?, updated_at = ? WHERE id = ?',
    )
    stmt.run(configData, new Date().toISOString(), configId)
  }

  // Helper methods
  private mapRowToUser(row: UserRow): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      lastLogin: row.last_login,
      status: row.status as User['status'],
      plan: row.license_type as User['plan'],
      expire_at: row.expiry_date ?? null,
      deviceId: row.device_id,
      machineFingerprint: row.machine_fingerprint,
      balance: row.balance || 0,
    }
  }

  private mapRowToToken(row: AuthTokenRow): AuthToken {
    return {
      token: row.token,
      userId: row.user_id,
      expiresAt: row.expires_at,
      deviceInfo: row.device_info,
      lastUsed: row.last_used,
    }
  }

  private mapRowToConfig(row: UserConfigRow): UserConfig {
    return {
      id: row.id,
      userId: row.user_id,
      configData: row.config_data,
      platform: row.platform,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  close(): void {
    this.db.close()
  }
}

// Singleton instance
let authDatabase: AuthDatabase | null = null

export function getAuthDatabase(): AuthDatabase {
  if (!authDatabase) {
    authDatabase = new AuthDatabase()
  }
  return authDatabase
}
