import { describe, expect, it } from 'vitest'
import {
  getPasswordLengthMessage,
  isPasswordLongEnough,
  MIN_PASSWORD_LENGTH,
} from '../passwordPolicy'

describe('passwordPolicy', () => {
  it('requires passwords to be at least eight characters long', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(isPasswordLongEnough('1234567')).toBe(false)
    expect(isPasswordLongEnough('12345678')).toBe(true)
  })

  it('returns a user-facing minimum length message', () => {
    expect(getPasswordLengthMessage()).toBe('密码长度至少8位')
  })
})
