import { afterEach, describe, expect, it } from 'vitest'
import {
  buildChromiumLaunchArgs,
  buildChromiumUserLaunchArgs,
  shouldDisableChromiumSandbox,
} from '#/managers/browserLaunchSecurity'

describe('browserLaunchSecurity', () => {
  const originalValue = process.env.PLAYWRIGHT_DISABLE_SANDBOX

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.PLAYWRIGHT_DISABLE_SANDBOX
    } else {
      process.env.PLAYWRIGHT_DISABLE_SANDBOX = originalValue
    }
  })

  it('keeps Chromium sandbox enabled by default', () => {
    delete process.env.PLAYWRIGHT_DISABLE_SANDBOX

    expect(shouldDisableChromiumSandbox()).toBe(false)
    expect(buildChromiumLaunchArgs(true)).not.toContain('--no-sandbox')
    expect(buildChromiumLaunchArgs(true)).not.toContain('--disable-setuid-sandbox')
  })

  it('allows explicitly disabling sandbox through environment override', () => {
    process.env.PLAYWRIGHT_DISABLE_SANDBOX = 'true'

    expect(shouldDisableChromiumSandbox()).toBe(true)
    expect(buildChromiumLaunchArgs(true)).toContain('--no-sandbox')
    expect(buildChromiumLaunchArgs(true)).toContain('--disable-setuid-sandbox')
  })

  it('does not add headless-only flags for headed browser sessions', () => {
    process.env.PLAYWRIGHT_DISABLE_SANDBOX = 'true'

    const args = buildChromiumLaunchArgs(false)
    expect(args).not.toContain('--disable-gpu')
    expect(args).not.toContain('--no-sandbox')
  })

  it('keeps user-visible browser sessions close to a normal browser', () => {
    const args = buildChromiumUserLaunchArgs()

    expect(args).toContain('--disable-blink-features=AutomationControlled')
    expect(args).not.toContain('--disable-background-networking')
    expect(args).not.toContain('--disable-extensions')
  })
})
