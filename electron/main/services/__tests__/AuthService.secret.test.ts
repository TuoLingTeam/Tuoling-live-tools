import { afterEach, describe, expect, it } from 'vitest'

describe('getJwtSecret', () => {
  const originalSecret = process.env.JWT_SECRET

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET
      return
    }
    process.env.JWT_SECRET = originalSecret
  })

  it('rejects short JWT secrets', async () => {
    process.env.JWT_SECRET = 'short-secret'

    const { getJwtSecret } = await import('#/services/authSecret')

    expect(() => getJwtSecret()).toThrow('JWT_SECRET 长度不足 32 字符')
  })

  it('accepts JWT secrets with at least 32 characters', async () => {
    process.env.JWT_SECRET = '12345678901234567890123456789012'

    const { getJwtSecret } = await import('#/services/authSecret')

    expect(getJwtSecret()).toBe('12345678901234567890123456789012')
  })
})
