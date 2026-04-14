export const MIN_PASSWORD_LENGTH = 8

export function isPasswordLongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
}

export function getPasswordLengthMessage(): string {
  return `密码长度至少${MIN_PASSWORD_LENGTH}位`
}
