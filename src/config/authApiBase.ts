/**
 * auth-api 基准地址（与后端约定唯一配置）
 * 所有登录/注册请求必须使用本常量拼接：POST ${API_BASE}/login、POST ${API_BASE}/register
 * 后端仅支持无 /auth 前缀：/login、/register
 * 正式默认值：生产环境统一走 https://auth.xiuer.work；
 * 开发环境默认走本地地址，必要时可通过环境变量覆盖。
 */
const metaEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env

export const AUTH_API_BASE =
  metaEnv?.VITE_AUTH_API_BASE_URL ||
  (metaEnv?.PROD ? 'https://auth.xiuer.work' : 'http://localhost:8000')
