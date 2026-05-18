#!/usr/bin/env node
/**
 * 一键发布系统 - Release Script
 *
 * 职责：
 * 1. 运行审计和阻断检查
 * 2. 检查发布前置条件
 * 3. 执行 macOS 构建
 * 4. 输出构建结果和下一步指引
 *
 * 注意：本脚本不会自动创建 tag、不会自动 push、不会自动发布到 GitHub Release
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

const PRODUCTION_API = 'https://auth.xiuer.work';
// 兼容旧 remote：当前正式口径以 Xiuer-Chinese 为准，但脚本仍接受历史 dashu521 remote。
const VALID_REPO_SLUGS = ['Xiuer-Chinese/Xiuer-live-tools', 'dashu521/Xiuer-live-tools'];

let step = 0;

function logStep(title) {
  step++;
  console.log(`\n${colors.cyan}${colors.bold}═══ Step ${step}: ${title} ═══${colors.reset}\n`);
}

function logPass(message) {
  console.log(`${colors.green}✅ PASS${colors.reset} ${message}`);
}

function logFail(message) {
  console.log(`${colors.red}❌ FAIL${colors.reset} ${message}`);
}

function logWarn(message) {
  console.log(`${colors.yellow}⚠️  WARN${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ️  INFO${colors.reset} ${message}`);
}

function logNext(message) {
  console.log(`${colors.cyan}➡️  NEXT${colors.reset} ${message}`);
}

function exec(command, options = {}) {
  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options });
    return typeof output === 'string' ? output.trim() : '';
  } catch (error) {
    if (options.ignoreError) return '';
    throw error;
  }
}

function getOriginUrl() {
  return exec('git remote get-url origin');
}

function getRepoSlugFromUrl(url) {
  return VALID_REPO_SLUGS.find(slug => url.includes(slug)) || null;
}

function getRepoWebUrl() {
  const slug = getRepoSlugFromUrl(getOriginUrl()) || VALID_REPO_SLUGS[0];
  return `https://github.com/${slug}`;
}

function checkCommand(command) {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ==================== 主流程 ====================
async function main() {
  console.log(`${colors.bold}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           🚀 秀儿直播助手 - 一键发布系统                    ║');
  console.log('║                                                            ║');
  console.log('║  发布架构：                                                ║');
  console.log('║  • 本地 Mac (任意机型) → 构建 macOS 安装包                ║');
  console.log('║  • GitHub Actions → 构建 Windows 安装包                   ║');
  console.log('║  • GitHub Releases → 统一分发                            ║');
  console.log('║                                                            ║');
  console.log('║  构建类型：                                                ║');
  console.log('║  • 测试构建：无需证书，生成未签名应用（Gatekeeper 需手动允许）║');
  console.log('║  • 正式发布：需 Apple Developer ID 证书进行签名和公证      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);

  // Step 1: 环境检查
  logStep('环境检查');

  // 检查 Node.js
  try {
    const nodeVersion = exec('node --version');
    logPass(`Node.js: ${nodeVersion}`);
  } catch {
    logFail('Node.js 未安装或不在 PATH 中');
    process.exit(1);
  }

  // 检查 npm
  try {
    const npmVersion = exec('npm --version');
    logPass(`npm: ${npmVersion}`);
  } catch {
    logFail('npm 未安装或不在 PATH 中');
    process.exit(1);
  }

  // 检查 Git
  try {
    const gitVersion = exec('git --version');
    logPass(`Git: ${gitVersion}`);
  } catch {
    logFail('Git 未安装或不在 PATH 中');
    process.exit(1);
  }

  // Step 2: 读取版本信息
  logStep('读取版本信息');

  let version;
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    version = packageJson.version;
    if (!version) {
      logFail('package.json 中缺少 version 字段');
      process.exit(1);
    }
    logPass(`当前版本: ${version}`);
  } catch (error) {
    logFail(`读取 package.json 失败: ${error.message}`);
    process.exit(1);
  }

  // Step 3: 检查 Git 状态
  logStep('Git 状态检查');

  // 检查分支
  const branch = exec('git branch --show-current');
  if (branch !== 'main') {
    logFail(`当前分支不是 main，当前: ${branch}`);
    process.exit(1);
  }
  logPass('当前分支: main');

  // 检查是否有未提交修改
  const gitStatus = exec('git status --porcelain');
  if (gitStatus !== '') {
    logFail('Git 工作区存在未提交修改');
    console.log('\n未提交的文件:');
    console.log(gitStatus);
    console.log(`\n${colors.yellow}请先执行:${colors.reset}`);
    console.log('  git add .');
    console.log('  git commit -m "chore: prepare release v' + version + '"');
    process.exit(1);
  }
  logPass('Git 工作区干净');

  // 检查 remote
  const remotes = exec('git remote').split('\n').filter(r => r.trim());
  const allowedRemotes = new Set(['origin', 'backup', 'legacy-origin']);
  const unexpectedRemotes = remotes.filter(remote => !allowedRemotes.has(remote));
  if (!remotes.includes('origin') || unexpectedRemotes.length > 0) {
    logFail(`Remote 配置错误: ${remotes.join(', ')}`);
    process.exit(1);
  }

  const originUrl = getOriginUrl();
  if (!getRepoSlugFromUrl(originUrl)) {
    logFail(`Origin URL 错误`);
    logInfo(`期望包含: ${VALID_REPO_SLUGS.join(' 或 ')}`);
    logInfo(`实际: ${originUrl}`);
    process.exit(1);
  }
  logPass('Remote 配置正确');

  // Step 4: 检查 tag 是否已存在
  logStep('检查 Tag');

  const tagName = `v${version}`;
  try {
    const existingTags = exec('git tag');
    if (existingTags.split('\n').includes(tagName)) {
      logFail(`Tag ${tagName} 已存在`);
      logInfo('如需重新发布，请先删除现有 tag:');
      logInfo(`  git tag -d ${tagName}`);
      logInfo(`  git push origin :refs/tags/${tagName}`);
      process.exit(1);
    }
    logPass(`Tag ${tagName} 可用`);
  } catch {
    logPass(`Tag ${tagName} 可用`);
  }

  // Step 5: 检查环境变量
  logStep('检查环境变量');

  const apiBaseUrl = process.env.VITE_AUTH_API_BASE_URL;
  if (!apiBaseUrl) {
    logFail('VITE_AUTH_API_BASE_URL 未设置');
    logInfo('正式生产 API 地址: ' + PRODUCTION_API);
    logInfo(`\n${colors.yellow}请设置环境变量后重新运行:${colors.reset}`);
    logInfo(`  export VITE_AUTH_API_BASE_URL=${PRODUCTION_API}`);
    process.exit(1);
  }

  if (
    apiBaseUrl.includes('localhost') ||
    apiBaseUrl.includes('127.0.0.1') ||
    apiBaseUrl !== PRODUCTION_API
  ) {
    logFail('VITE_AUTH_API_BASE_URL 必须是允许的生产地址');
    logInfo(`当前值: ${apiBaseUrl}`);
    logInfo(`\n${colors.yellow}请设置为生产地址:${colors.reset}`);
    logInfo(`  export VITE_AUTH_API_BASE_URL=${PRODUCTION_API}`);
    process.exit(1);
  }

  logPass(`API 地址: ${apiBaseUrl}`);

  // Step 6: 运行审计
  logStep('运行发布审计');

  try {
    exec('npm run release:audit', { stdio: 'inherit' });
    logPass('审计完成');
  } catch (error) {
    logWarn('审计发现问题，请查看上方输出');
  }

  // Step 7: 运行阻断检查
  logStep('运行阻断检查 (release:guard)');

  try {
    exec('npm run release:guard', { stdio: 'inherit' });
    logPass('阻断检查通过');
  } catch (error) {
    logFail('阻断检查未通过，请修复上述问题');
    process.exit(1);
  }

  // Step 8: 执行 macOS 构建
  logStep('执行 macOS 构建');

  logInfo('开始构建 macOS 安装包...');
  logInfo('这可能需要几分钟时间，请耐心等待...\n');

  try {
    exec('npm run release:mac', { stdio: 'inherit' });
  } catch (error) {
    logFail('macOS 构建失败');
    process.exit(1);
  }

  // Step 9: 检查构建产物
  logStep('检查构建产物');

  const releaseDir = `release/${version}`;
  if (!fs.existsSync(releaseDir)) {
    logFail(`构建目录不存在: ${releaseDir}`);
    process.exit(1);
  }

  // 查找 dmg 文件
  const dmgFiles = [];
  function findDmg(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findDmg(fullPath);
      } else if (entry.name.endsWith('.dmg')) {
        dmgFiles.push(fullPath);
      }
    }
  }
  findDmg(releaseDir);

  if (dmgFiles.length === 0) {
    logWarn('未找到 .dmg 文件');
  } else {
    logPass(`找到 ${dmgFiles.length} 个 macOS 安装包:`);
    for (const dmg of dmgFiles) {
      const stats = fs.statSync(dmg);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      logInfo(`  ${dmg} (${sizeMB} MB)`);
    }
  }

  // 最终输出
  console.log(`\n${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.green}${colors.bold}  ✅ macOS 构建成功！版本: ${version}${colors.reset}`);
  console.log(`${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`);

  logNext('本地测试安装包');
  console.log(`  open "${releaseDir}"\n`);

  logNext('创建并推送 Tag（触发 Windows 构建）');
  console.log(`  git tag v${version}`);
  console.log(`  git push origin v${version}\n`);

  logNext('Windows 构建状态');
  console.log('  推送 tag 后，GitHub Actions 将自动构建 Windows 安装包');
  console.log(`  请访问: ${getRepoWebUrl()}/actions\n`);

  logNext('发布到 GitHub Releases');
  console.log('  1. 等待 GitHub Actions Windows 构建完成');
  console.log(`  2. 访问: ${getRepoWebUrl()}/releases`);
  console.log('  3. 创建新 Release，选择 tag v' + version);
  console.log('  4. 上传文件:');
  for (const dmg of dmgFiles) {
    console.log(`     - ${path.basename(dmg)}`);
  }
  console.log('     - Windows 构建产物（从 Actions 下载）');
  console.log('');

  logInfo('发布检查清单:');
  console.log('  ☐ macOS 安装包已本地测试');
  console.log('  ☐ Tag 已推送');
  console.log('  ☐ Windows 构建已完成');
  console.log('  ☐ GitHub Release 已创建');
  console.log('  ☐ 所有安装包已上传');
  console.log('');
}

main().catch(err => {
  console.error(`${colors.red}执行出错:${colors.reset}`, err);
  process.exit(1);
});
