#!/usr/bin/env node

const { buildStatus } = require('./release-status')
const { colors, exec, getRepoWebUrl } = require('./release-utils')

function logPass(message) {
  console.log(`${colors.green}✅ PASS${colors.reset} ${message}`)
}

function logFail(message) {
  console.log(`${colors.red}❌ FAIL${colors.reset} ${message}`)
}

function logWarn(message) {
  console.log(`${colors.yellow}⚠️  WARN${colors.reset} ${message}`)
}

function checkWebsiteVersionSync(version) {
  try {
    const html = exec('curl -fsSL --max-time 25 https://xiuer.work/')
    const expectedBadge = `v${version} 当前稳定版`
    if (html.includes(expectedBadge)) {
      return { ok: true, error: null }
    }

    const actualBadge = html.match(/v\d+\.\d+\.\d+\s*当前稳定版/)
    return {
      ok: false,
      error: `官网首页版本不一致: 期望 ${expectedBadge}, 实际 ${actualBadge ? actualBadge[0] : '未找到版本标记'}`,
    }
  } catch (error) {
    const output = error.stdout || error.stderr || error.message
    return {
      ok: false,
      error: `官网首页版本检查失败: ${String(output).trim() || error.message}`,
    }
  }
}

function main() {
  console.log(`${colors.bold}`)
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           🚀 安全版一键发布系统 - 纯验收阶段               ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log(`${colors.reset}\n`)

  const status = buildStatus()

  console.log(`${colors.cyan}${colors.bold}📋 检查版本: ${status.version}${colors.reset}\n`)

  const websiteVersion = checkWebsiteVersionSync(status.version)

  console.log(`${colors.cyan}检查 1/5: GitHub Actions Windows 构建状态${colors.reset}`)
  if (!status.windows.run.found) {
    logFail(`未找到 ${status.tagName} 的 Windows 构建 run`)
  } else if (status.windows.run.status === 'in_progress') {
    logWarn(`Windows 构建进行中: ${status.windows.run.url}`)
  } else if (status.windows.run.conclusion === 'success') {
    logPass('Windows 构建成功')
  } else {
    logFail(`Windows 构建失败: ${status.windows.run.url || '无链接'}`)
  }

  console.log(`\n${colors.cyan}检查 2/5: GitHub Release 资产完整性${colors.reset}`)
  if (!status.release.exists) {
    logFail('GitHub Release 不存在')
  } else {
    console.log('\n资产检查结果:')
    console.log(`\n${colors.bold}Windows:${colors.reset}`)
    status.assetSummary.windowsExe
      ? logPass('Windows 安装包 (.exe)')
      : logFail('Windows 安装包 (.exe)')
    status.assetSummary.windowsZip
      ? logPass('Windows 便携版 (.zip)')
      : logFail('Windows 便携版 (.zip)')
    status.assetSummary.latestYml
      ? logPass('Windows 自动更新配置 (latest.yml)')
      : logFail('Windows 自动更新配置 (latest.yml)')

    console.log(`\n${colors.bold}macOS:${colors.reset}`)
    status.assetSummary.macDmg ? logPass('macOS 安装包 (.dmg)') : logFail('macOS 安装包 (.dmg)')
    status.assetSummary.latestMacYml
      ? logPass('macOS 自动更新配置 (latest-mac.yml)')
      : logFail('macOS 自动更新配置 (latest-mac.yml)')

    console.log(`\n${colors.bold}其他:${colors.reset}`)
    status.assetSummary.blockmap
      ? logPass('差分更新文件 (.blockmap)')
      : logWarn('差分更新文件 (.blockmap) - 可选')
  }

  console.log(`\n${colors.cyan}检查 3/5: mac CDN latest 与当前版本一致性${colors.reset}`)
  status.mac.cdnReady
    ? logPass('mac CDN latest 已同步到当前 package.json 版本')
    : logFail(status.mac.cdnError || 'mac CDN latest 尚未同步到当前版本')

  console.log(`\n${colors.cyan}检查 4/5: 官网主站版本一致性${colors.reset}`)
  websiteVersion.ok
    ? logPass('xiuer.work 首页版本已同步到当前 package.json 版本')
    : logFail(websiteVersion.error)

  console.log(`\n${colors.cyan}检查 5/5: 自动更新完整性${colors.reset}`)
  status.autoUpdateReady
    ? logPass('自动更新清单完整')
    : logFail('自动更新清单仍不完整')

  console.log(`\n${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`)

  const releaseComplete =
    status.windows.run.conclusion === 'success' &&
    status.windows.releaseAssetsReady &&
    status.mac.releaseAssetsReady &&
    status.mac.cdnReady &&
    websiteVersion.ok &&
    status.autoUpdateReady

  if (releaseComplete) {
    console.log(`${colors.green}${colors.bold}🎉 发布完整！${colors.reset}\n`)
    console.log(`${colors.cyan}${colors.bold}📊 发布摘要${colors.reset}`)
    console.log('  Windows: ✅ 已发布')
    console.log('  macOS: ✅ 已发布')
    console.log('  官网主站: ✅ 已同步')
    console.log('  自动更新: ✅ 可用\n')
    console.log(`${colors.cyan}${colors.bold}🔗 Release URL${colors.reset}`)
    console.log(`  ${status.release.url || `${getRepoWebUrl()}/releases/tag/${status.tagName}`}\n`)
    console.log(`${colors.green}✅ 所有检查通过，发布完成！${colors.reset}\n`)
  } else {
    console.log(`${colors.yellow}${colors.bold}⚠️  发布尚未完成${colors.reset}\n`)
    console.log(`${colors.cyan}${colors.bold}📊 发布摘要${colors.reset}`)
    console.log(
      `  Windows: ${
        status.windows.run.conclusion === 'success' && status.windows.releaseAssetsReady ? '✅ 已发布' : '❌ 未完成'
      }`,
    )
    console.log(
      `  macOS: ${status.mac.releaseAssetsReady && status.mac.cdnReady ? '✅ 已发布' : '❌ 未完成'}`,
    )
    console.log(`  官网主站: ${websiteVersion.ok ? '✅ 已同步' : '❌ 未同步'}`)
    console.log(`  自动更新: ${status.autoUpdateReady ? '✅ 可用' : '❌ 不完整'}\n`)
    console.log(`${colors.yellow}建议操作:${colors.reset}`)
    console.log('  1. 运行 npm run release:status 查看当前状态')
    console.log('  2. 如官网主站未同步，运行 npm run deploy:website 部署当前版本首页')
    console.log('  3. 运行 npm run publish:orchestrate 触发缺失的补动作')
    console.log('  4. 再次执行 npm run publish:verify\n')
    process.exit(1)
  }
}

main()
