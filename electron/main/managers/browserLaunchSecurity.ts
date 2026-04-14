export function shouldDisableChromiumSandbox(): boolean {
  return process.env.PLAYWRIGHT_DISABLE_SANDBOX === 'true'
}

export function buildChromiumLaunchArgs(headless: boolean): string[] {
  const commonArgs = [
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',
  ]

  if (!headless) {
    return commonArgs
  }

  const headlessArgs = [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--mute-audio',
    '--hide-scrollbars',
  ]

  if (shouldDisableChromiumSandbox()) {
    headlessArgs.push('--no-sandbox', '--disable-setuid-sandbox')
  }

  return [...commonArgs, ...headlessArgs]
}
