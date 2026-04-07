import type { AuthResponse, SafeUser } from 'shared/auth'

export type {
  AuthResponse,
  AuthToken,
  CloudAuthResponse,
  CloudErrorDetail,
  CloudMeResponse,
  CloudRefreshResponse,
  CloudSubscriptionOut,
  CloudUserOut,
  LoginCredentials,
  RegisterData,
  SafeUser,
  User,
  UserConfig,
  UserStatus,
} from 'shared/auth'

export interface AuthState {
  isAuthenticated: boolean
  user: SafeUser | null
  token: string | null
  isLoading: boolean
  error: string | null
}

/** 登录错误类型 */
export type LoginErrorType =
  | 'USER_NOT_FOUND'
  | 'INVALID_PASSWORD'
  | 'ACCOUNT_DISABLED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR'

/** 带错误类型的认证响应 */
export interface AuthResponseWithErrorType extends AuthResponse {
  errorType?: LoginErrorType
}

/** 发送验证码请求 */
export interface SendCodeRequest {
  phone: string
  purpose: 'login' | 'register' | 'reset_password'
}

/** 发送验证码响应 */
export interface SendCodeResponse {
  success: boolean
  message: string
  expires_in: number
}

/** 手机验证码登录请求 */
export interface PhoneLoginRequest {
  phone: string
  code: string
}

/** 手机验证码注册请求 */
export interface PhoneRegisterRequest {
  phone: string
  code: string
  password: string
}
