import type { PlanType } from 'shared/planRules'

export interface User {
  id: string
  username: string
  email: string
  phone?: string
  passwordHash: string
  createdAt: string
  lastLogin: string | null
  status: 'active' | 'inactive' | 'banned'
  plan: PlanType
  expire_at: string | null
  deviceId: string
  machineFingerprint: string
  balance: number
}

export interface AuthToken {
  token: string
  userId: string
  expiresAt: string
  deviceInfo: string
  lastUsed: string
}

export interface UserConfig {
  id: string
  userId: string
  configData: string
  platform: string
  createdAt: string
  updatedAt: string
}

export interface LoginCredentials {
  username: string
  password: string
  rememberMe?: boolean
}

export interface RegisterData {
  username: string
  email: string
  password: string
  confirmPassword: string
}

export type SafeUser = Omit<User, 'passwordHash'>

export interface AuthResponse {
  success: boolean
  user?: SafeUser
  token?: string
  refresh_token?: string
  error?: string
}

export interface CloudUserOut {
  id: string
  email: string | null
  phone: string | null
  created_at: string
  last_login_at: string | null
  status: string
}

export interface CloudSubscriptionOut {
  plan: PlanType
  status: string
  current_period_end: number | null
  features: string[]
}

export interface CloudAuthResponse {
  user: CloudUserOut
  access_token: string
  refresh_token: string
  token_type?: string
}

export interface CloudRefreshResponse {
  access_token: string
  token_type?: string
}

export interface CloudMeResponse {
  user: CloudUserOut
  subscription: CloudSubscriptionOut
}

export interface CloudErrorDetail {
  code: string
  message: string
}

export interface UserStatus {
  user_id?: string
  username: string
  status: 'active' | 'disabled'
  plan: PlanType
  max_accounts?: number
  has_password?: boolean
  created_at?: string
  last_login_at?: string
  expire_at?: string | null
  trial?: {
    start_at?: string | null
    end_at?: string | null
    is_active?: boolean
    is_expired?: boolean
  }
  capabilities?: {
    is_paid_user?: boolean
    can_use_all_features?: boolean
    max_live_accounts?: number
    feature_access?: Record<
      string,
      {
        requires_auth?: boolean
        required_plan?: PlanType
        can_access?: boolean
      }
    >
  }
}
