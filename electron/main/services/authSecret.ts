export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET 环境变量未设置')
  }
  if (secret.trim().length < 32) {
    throw new Error('JWT_SECRET 长度不足 32 字符')
  }
  return secret
}
