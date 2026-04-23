#!/usr/bin/env node
/**
 * 发布防事故系统 - Release Guard
 * 在发布前执行高风险检查，发现问题直接阻止构建
 *
 * 检查级别：
 * - BLOCKER: 会阻止发布的硬阻塞项
 * - WARNING: 审计警告，需人工确认但不会阻止发布
 * - INFO: 信息提示
 *
 * CI 环境适配：
 * - 检测到 CI 环境时放宽 Git 检查
 * - 保留核心安全阻塞项
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

// 兼容旧 remote：当前正式口径以 Xiuer-Chinese 为准，但脚本仍接受历史 dashu521 remote。
const VALID_REPO_SLUGS = ['Xiuer-Chinese/Xiuer-live-tools', 'dashu521/Xiuer-live-tools'];
const ALLOWED_REMOTES = new Set(['origin', 'backup', 'legacy-origin']);
const FORMAL_PRODUCTION_API = 'https://auth.xiuer.work';
const LEGACY_EMERGENCY_API = 'http://121.41.179.197:8000';
const ALLOWED_LOOPBACK_FINDINGS = [
  {
    file: 'src/pages/AutoReply/AutoReplySettings/components/WebSocketSetting.tsx',
    pattern: 'ws://127.0.0.1:',
    note: '本地评论监听 WebSocket 仅允许回环地址，属于预期的安全边界',
  },
  {
    file: 'src/pages/AutoReply/AutoReplySettings/components/WebSocketSetting.tsx',
    pattern: '>127.0.0.1<',
    note: '设置页展示的回环地址提示，属于预期文案',
  }
];

let hasBlocker = false;
const blockers = [];
const warnings = [];
const infos = [];

// 检测是否在 CI 环境中
function isCI() {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.TRAVIS ||
    process.env.CIRCLECI ||
    process.env.JENKINS ||
    process.env.GITLAB_CI
  );
}

const CI_MODE = isCI();

function addBlocker(category, message, details = '') {
  hasBlocker = true;
  blockers.push({ category, message, details });
}

function addWarning(category, message, details = '') {
  warnings.push({ category, message, details });
}

function addInfo(category, message, details = '') {
  infos.push({ category, message, details });
}

function log(title, status, details = '') {
  const icon = status === 'PASS' ? '✅' : status === 'BLOCKER' ? '❌' : status === 'WARNING' ? '⚠️' : 'ℹ️';
  const color = status === 'PASS' ? colors.green : status === 'BLOCKER' ? colors.red : status === 'WARNING' ? colors.yellow : colors.cyan;
  console.log(`${icon} ${color}${colors.bold}[${status}]${colors.reset} ${title}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options }).trim();
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

// ==================== 1. Git 检查 ====================
function checkGit() {
  console.log(`\n${colors.blue}${colors.bold}🔍 Git 检查${colors.reset}\n`);

  // CI 模式下显示提示
  if (CI_MODE) {
    log('检测到 CI 环境，放宽 Git 检查', 'INFO');
    console.log('');
  }

  // 1.1 检查当前分支
  try {
    const branch = exec('git branch --show-current');
    if (branch === 'main') {
      log('当前分支是 main', 'PASS');
    } else {
      if (CI_MODE) {
        // CI 模式下允许 detached HEAD 或其他分支
        log(`当前分支: ${branch || '(detached HEAD)'}`, 'INFO');
        addInfo('Git', `CI 环境分支: ${branch || 'detached HEAD'}`);
      } else {
        log('当前分支必须是 main', 'BLOCKER', `当前分支: ${branch}`);
        addBlocker('Git', '当前分支不是 main', `当前分支: ${branch}`);
      }
    }
  } catch (error) {
    if (CI_MODE) {
      // CI 模式下允许无法获取分支（可能是 detached HEAD）
      log('无法获取当前分支（可能是 detached HEAD）', 'INFO');
      addInfo('Git', 'CI 环境 detached HEAD');
    } else {
      log('无法获取当前分支', 'BLOCKER', error.message);
      addBlocker('Git', '无法获取当前分支', error.message);
    }
  }

  // 1.2 检查 git status 是否干净
  try {
    const status = exec('git status --porcelain');
    if (status === '') {
      log('Git 工作区干净', 'PASS');
    } else {
      if (CI_MODE) {
        // CI 模式下，检出时应该是干净的
        log('Git 工作区存在未提交修改', 'WARNING', 'CI 环境中通常应该干净');
        addWarning('Git', 'Git 工作区不干净', '存在未提交的修改');
      } else {
        log('Git 工作区存在未提交修改', 'BLOCKER', '请执行 git status 查看详情');
        addBlocker('Git', 'Git 工作区不干净', '存在未提交的修改');
      }
    }
  } catch (error) {
    log('无法检查 Git 状态', 'BLOCKER', error.message);
    addBlocker('Git', '无法检查 Git 状态', error.message);
  }

  // 1.3 检查 remote 数量
  try {
    const remotes = exec('git remote').split('\n').filter(r => r.trim());
    const unexpectedRemotes = remotes.filter(remote => !ALLOWED_REMOTES.has(remote));
    const hasOrigin = remotes.includes('origin');

    if (hasOrigin && unexpectedRemotes.length === 0) {
      if (remotes.length === 1) {
        log('Remote 配置正确（仅 origin）', 'PASS');
      } else {
        log(`Remote 配置可接受（${remotes.join(', ')}）`, 'PASS');
        addInfo('Git', `检测到镜像 remote: ${remotes.join(', ')}`);
      }
    } else {
      if (CI_MODE) {
        log(`发现 ${remotes.length} 个 remote`, 'INFO');
        addInfo('Git', `CI 环境 remote: ${remotes.join(', ')}`);
      } else {
        log(
          'Remote 配置错误',
          'BLOCKER',
          `发现 ${remotes.length} 个 remote: ${remotes.join(', ')}${unexpectedRemotes.length > 0 ? `；未知 remote: ${unexpectedRemotes.join(', ')}` : ''}`,
        );
        addBlocker(
          'Git',
          'Remote 配置错误',
          `发现 ${remotes.length} 个 remote，未知 remote: ${unexpectedRemotes.join(', ') || '无'}`,
        );
      }
    }
  } catch (error) {
    log('无法检查 remote', 'BLOCKER', error.message);
    addBlocker('Git', '无法检查 remote', error.message);
  }

  // 1.4 检查 origin URL
  try {
    const originUrl = getOriginUrl();
    const matchedSlug = getRepoSlugFromUrl(originUrl);

    // 宽松匹配：只要包含正确仓库路径即可
    const isValidRepo = originUrl.includes('Xiuer-Chinese/Xiuer-live-tools') || originUrl.includes('dashu521/Xiuer-live-tools');

    if (isValidRepo) {
      log('Origin URL 正确', 'PASS');
      if (matchedSlug === 'dashu521/Xiuer-live-tools') {
        addInfo('Git', `检测到历史兼容 origin: ${matchedSlug}`);
      }
    } else {
      log(
        'Origin URL 错误',
        'BLOCKER',
        `期望包含: ${VALID_REPO_SLUGS.join(' 或 ')}\n   实际: ${originUrl}`,
      );
      addBlocker(
        'Git',
        'Origin URL 错误',
        `期望包含: ${VALID_REPO_SLUGS.join(' 或 ')}, 实际: ${originUrl}`,
      );
    }
  } catch (error) {
    log('无法获取 origin URL', 'BLOCKER', error.message);
    addBlocker('Git', '无法获取 origin URL', error.message);
  }
}

// ==================== 2. Git 跟踪文件检查 ====================
function checkTrackedFiles() {
  console.log(`\n${colors.blue}${colors.bold}🔍 Git 跟踪文件检查${colors.reset}\n`);

  const forbiddenPatterns = [
    { pattern: /^release\//, name: 'release/' },
    { pattern: /^dist\//, name: 'dist/' },
    { pattern: /^dist-electron\//, name: 'dist-electron/' },
    { pattern: /^build\//, name: 'build/' },
    { pattern: /^out\//, name: 'out/' },
    { pattern: /\.db$/, name: '*.db' },
    { pattern: /\.sqlite$/, name: '*.sqlite' },
    { pattern: /\.sqlite3$/, name: '*.sqlite3' },
    { pattern: /^\.env$/, name: '.env' }
  ];

  try {
    const trackedFiles = exec('git ls-files').split('\n').filter(f => f.trim());
    const violations = [];

    for (const file of trackedFiles) {
      for (const { pattern, name } of forbiddenPatterns) {
        if (pattern.test(file)) {
          violations.push({ file, pattern: name });
          break;
        }
      }
    }

    if (violations.length === 0) {
      log('未发现被跟踪的禁止文件', 'PASS');
    } else {
      log('发现被 Git 跟踪的禁止文件', 'BLOCKER');
      for (const { file, pattern } of violations.slice(0, 10)) {
        console.log(`   ❌ ${file} (${pattern})`);
      }
      if (violations.length > 10) {
        console.log(`   ... 还有 ${violations.length - 10} 个文件`);
      }
      addBlocker('Git 跟踪文件', '发现被跟踪的禁止文件', `${violations.length} 个文件`);
    }
  } catch (error) {
    log('无法检查跟踪文件', 'BLOCKER', error.message);
    addBlocker('Git 跟踪文件', '无法检查', error.message);
  }
}

// ==================== 3. 配置检查 ====================
function checkConfig() {
  console.log(`\n${colors.blue}${colors.bold}🔍 配置检查${colors.reset}\n`);

  // 3.1 检查 package.json version
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    if (packageJson.version) {
      log(`package.json version: ${packageJson.version}`, 'PASS');
      addInfo('版本', `当前版本: ${packageJson.version}`);
    } else {
      log('package.json 缺少 version 字段', 'BLOCKER');
      addBlocker('配置', 'package.json 缺少 version 字段');
    }
  } catch (error) {
    log('无法读取 package.json', 'BLOCKER', error.message);
    addBlocker('配置', '无法读取 package.json', error.message);
  }

  // 3.2 检查 electron-builder.json publish 配置
  try {
    const builderConfig = JSON.parse(fs.readFileSync('electron-builder.json', 'utf-8'));
    const publish = builderConfig.publish;

    if (!publish) {
      log('electron-builder.json 缺少 publish 配置', 'BLOCKER');
      addBlocker('配置', '缺少 publish 配置');
    } else if (publish.provider === 'generic') {
      // 支持 generic provider（用于 CDN 分发）
      log(`electron-builder.json publish.provider: generic (CDN 模式)`, 'PASS');
      addInfo('配置', `更新源: ${publish.url || '未设置'}`);
    } else if (publish.provider === 'github') {
      // GitHub provider 模式
      if (publish.owner !== 'Xiuer-Chinese') {
        log('electron-builder.json publish.owner 错误', 'BLOCKER', `期望: Xiuer-Chinese, 实际: ${publish.owner}`);
        addBlocker('配置', 'publish.owner 错误');
      } else if (publish.repo !== 'Xiuer-live-tools') {
        log('electron-builder.json publish.repo 错误', 'BLOCKER', `期望: Xiuer-live-tools, 实际: ${publish.repo}`);
        addBlocker('配置', 'publish.repo 错误');
      } else {
        log('electron-builder.json publish 配置正确 (GitHub 模式)', 'PASS');
      }
    } else {
      log(`electron-builder.json publish.provider 不支持: ${publish.provider}`, 'BLOCKER');
      addBlocker('配置', 'publish.provider 错误', `实际: ${publish.provider}`);
    }
  } catch (error) {
    log('无法读取 electron-builder.json', 'BLOCKER', error.message);
    addBlocker('配置', '无法读取 electron-builder.json', error.message);
  }
}

// ==================== 4. 环境变量检查 ====================
function checkEnv() {
  console.log(`\n${colors.blue}${colors.bold}🔍 环境变量检查${colors.reset}\n`);

  const PRODUCTION_API = FORMAL_PRODUCTION_API;
  const apiBaseUrl = process.env.VITE_AUTH_API_BASE_URL;
  const authStorageSecret = process.env.AUTH_STORAGE_SECRET?.trim();

  if (!apiBaseUrl) {
    log('VITE_AUTH_API_BASE_URL 未设置', 'BLOCKER', `发布时必须设置为 ${PRODUCTION_API}`);
    addBlocker('环境变量', 'VITE_AUTH_API_BASE_URL 未设置');
  } else if (
    apiBaseUrl.includes('localhost') ||
    apiBaseUrl.includes('127.0.0.1') ||
    apiBaseUrl !== PRODUCTION_API
  ) {
    log(
      `VITE_AUTH_API_BASE_URL 值不正确: ${apiBaseUrl}`,
      'BLOCKER',
      `必须精确为 ${PRODUCTION_API}${apiBaseUrl === LEGACY_EMERGENCY_API ? '；旧裸 IP 仅可视为历史应急地址，不得再作为正式发布值' : ''}`,
    );
    addBlocker('环境变量', `VITE_AUTH_API_BASE_URL 值不正确，当前值: ${apiBaseUrl}`);
  } else {
    log(`VITE_AUTH_API_BASE_URL: ${apiBaseUrl}`, 'PASS');
    addInfo('环境变量', `API 地址: ${apiBaseUrl}`);
  }

  if (!authStorageSecret) {
    log(
      'AUTH_STORAGE_SECRET 未设置',
      'BLOCKER',
      '发布时必须设置主进程安全存储密钥，禁止回退到开发态默认密钥',
    );
    addBlocker('环境变量', 'AUTH_STORAGE_SECRET 未设置');
  } else if (authStorageSecret.length < 32) {
    log(
      `AUTH_STORAGE_SECRET 长度不足: ${authStorageSecret.length} < 32`,
      'BLOCKER',
      '生产构建必须使用长度 >= 32 的高熵随机字符串',
    );
    addBlocker('环境变量', `AUTH_STORAGE_SECRET 长度不足 ${authStorageSecret.length} < 32`);
  } else {
    log(`AUTH_STORAGE_SECRET 已设置（长度: ${authStorageSecret.length}）`, 'PASS');
    addInfo('环境变量', `AUTH_STORAGE_SECRET 长度: ${authStorageSecret.length}`);
  }
}

// ==================== 5. 高风险内容扫描 ====================
function scanHighRiskContent() {
  console.log(`\n${colors.blue}${colors.bold}🔍 高风险内容扫描${colors.reset}\n`);

  // 高风险目录：这些目录中的 localhost 会被视为 BLOCKER
  const highRiskDirs = ['src', 'shared'];

  // 中风险目录：这些目录中的 localhost 会被视为 WARNING
  const mediumRiskDirs = ['electron/main', 'preload'];

  // 低风险目录：这些目录中的 localhost 会被视为 INFO（脚本自身）
  const lowRiskDirs = ['scripts'];

  const riskPatterns = [
    { pattern: /http:\/\/localhost/, name: 'http://localhost' },
    { pattern: /127\.0\.0\.1/, name: '127.0.0.1' },
    { pattern: /test_users\.db/, name: 'test_users.db' },
    { pattern: /auth-api\/data\//, name: 'auth-api/data/' },
    { pattern: /17701259200/, name: '17701259200' }
  ];

  const blockerFindings = [];
  const warningFindings = [];
  const infoFindings = [];

  const scannedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.cjs', '.mjs'];

  function getRiskLevel(filePath) {
    // 检查是否在脚本目录
    for (const dir of lowRiskDirs) {
      if (filePath.startsWith(dir + path.sep) || filePath === dir) {
        return 'info';
      }
    }

    // 检查是否在中风险目录
    for (const dir of mediumRiskDirs) {
      if (filePath.startsWith(dir + path.sep) || filePath === dir) {
        return 'warning';
      }
    }

    // 检查是否在高风险目录
    for (const dir of highRiskDirs) {
      if (filePath.startsWith(dir + path.sep) || filePath === dir) {
        return 'blocker';
      }
    }

    // 默认 info
    return 'info';
  }

  function isFallbackPattern(line) {
    // 检测是否是 fallback 模式：env || 'localhost'
    const fallbackPatterns = [
      /import\.meta\.env\.\w+.*\|\|.*localhost/,
      /process\.env\.\w+.*\|\|.*localhost/,
      /\|\|.*localhost/,
      /\|\|.*127\.0\.0\.1/
    ];
    return fallbackPatterns.some(p => p.test(line));
  }

  function isSafeProdDevAuthApiFallback(line) {
    return (
      line.includes('import.meta.env.PROD') &&
      line.includes(LEGACY_EMERGENCY_API) &&
      line.includes('http://localhost:8000')
    );
  }

  function isAllowedLoopbackFinding(filePath, line) {
    const normalizedPath = filePath.split(path.sep).join('/');
    return ALLOWED_LOOPBACK_FINDINGS.find(entry =>
      normalizedPath === entry.file && line.includes(entry.pattern)
    );
  }

  function isTestFixtureFile(filePath) {
    const normalizedPath = filePath.split(path.sep).join('/');
    return (
      normalizedPath.includes('/__tests__/') ||
      normalizedPath.endsWith('.test.ts') ||
      normalizedPath.endsWith('.test.tsx') ||
      normalizedPath.endsWith('.spec.ts') ||
      normalizedPath.endsWith('.spec.tsx')
    );
  }

  function scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const riskLevel = getRiskLevel(filePath);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { pattern, name } of riskPatterns) {
          if (pattern.test(line)) {
            const allowedLoopback = isAllowedLoopbackFinding(filePath, line);
            if (allowedLoopback) {
              infoFindings.push({
                file: filePath,
                line: i + 1,
                content: line.trim().substring(0, 80),
                risk: name,
                note: allowedLoopback.note,
                isFallback: false,
              });
              continue;
            }

            if (isTestFixtureFile(filePath) && (name === '17701259200' || name === 'test_users.db')) {
              infoFindings.push({
                file: filePath,
                line: i + 1,
                content: line.trim().substring(0, 80),
                risk: name,
                note: '测试夹具命中，已按非生产风险处理',
                isFallback: false,
              });
              continue;
            }

            const finding = {
              file: filePath,
              line: i + 1,
              content: line.trim().substring(0, 80),
              risk: name,
              isFallback: isFallbackPattern(line)
            };

            // 特殊处理 src/config/authApiBase.ts（兼容 Windows 路径）
            if (
              (filePath.includes('src/config/authApiBase.ts') || filePath.includes('src\\config\\authApiBase.ts')) &&
              (finding.isFallback || line.includes('localhost'))
            ) {
              if (isSafeProdDevAuthApiFallback(line)) {
                infoFindings.push({ ...finding, note: '生产走应急直连 HTTP、开发走 localhost 的显式分流' });
                continue;
              }
              // 如果环境变量已设置且不是 localhost
              const apiBaseUrl = process.env.VITE_AUTH_API_BASE_URL;
              if (
                apiBaseUrl &&
                !apiBaseUrl.includes('localhost') &&
                !apiBaseUrl.includes('127.0.0.1') &&
                (apiBaseUrl === LEGACY_EMERGENCY_API || apiBaseUrl.startsWith('https://'))
              ) {
                // CI 模式下降级为 WARNING，本地模式也降级为 WARNING（因为环境变量已设置）
                warningFindings.push({ ...finding, note: 'fallback 模式，但环境变量已正确设置' });
              } else {
                blockerFindings.push({ ...finding, note: 'fallback 模式且环境变量未设置或无效' });
              }
            } else {
              // 根据目录风险级别分类
              if (riskLevel === 'blocker') {
                blockerFindings.push(finding);
              } else if (riskLevel === 'warning') {
                warningFindings.push(finding);
              } else {
                infoFindings.push(finding);
              }
            }
          }
        }
      }
    } catch (error) {
      // 跳过无法读取的文件
    }
  }

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过 node_modules 和 .git
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          scanDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (scannedExtensions.includes(ext)) {
          scanFile(fullPath);
        }
      }
    }
  }

  // 扫描所有目录
  const allDirs = [...highRiskDirs, ...mediumRiskDirs, ...lowRiskDirs];
  for (const dir of allDirs) {
    scanDir(dir);
  }

  // 输出结果
  if (blockerFindings.length === 0 && warningFindings.length === 0 && infoFindings.length === 0) {
    log('未发现高风险内容', 'PASS');
  } else {
    // 输出 BLOCKER
    if (blockerFindings.length > 0) {
      log(`发现 ${blockerFindings.length} 处高风险内容（会阻止发布）`, 'BLOCKER');
      for (const finding of blockerFindings.slice(0, 10)) {
        console.log(`   ❌ ${finding.file}:${finding.line}`);
        console.log(`      [${finding.risk}] ${finding.content}`);
        if (finding.note) console.log(`      说明: ${finding.note}`);
      }
      if (blockerFindings.length > 10) {
        console.log(`   ... 还有 ${blockerFindings.length - 10} 处`);
      }
      addBlocker('高风险内容', '发现高风险 localhost/127.0.0.1', `${blockerFindings.length} 处`);
    }

    // 输出 WARNING
    if (warningFindings.length > 0) {
      log(`发现 ${warningFindings.length} 处警告内容（需人工确认）`, 'WARNING');
      for (const finding of warningFindings.slice(0, 10)) {
        console.log(`   ⚠️  ${finding.file}:${finding.line}`);
        console.log(`      [${finding.risk}] ${finding.content}`);
        if (finding.note) console.log(`      说明: ${finding.note}`);
      }
      if (warningFindings.length > 10) {
        console.log(`   ... 还有 ${warningFindings.length - 10} 处`);
      }
      addWarning('潜在风险', '发现需要确认的内容', `${warningFindings.length} 处`);
    }

    // 输出 INFO（仅当存在时）
    if (infoFindings.length > 0) {
      log(`发现 ${infoFindings.length} 处信息项（脚本/工具中的正常引用）`, 'INFO');
      for (const finding of infoFindings.slice(0, 5)) {
        console.log(`   ℹ️  ${finding.file}:${finding.line}`);
        console.log(`      [${finding.risk}] ${finding.content.substring(0, 60)}...`);
      }
      if (infoFindings.length > 5) {
        console.log(`   ... 还有 ${infoFindings.length - 5} 处（已省略）`);
      }
    }
  }
}

// ==================== 主程序 ====================
function printSummary() {
  console.log(`\n${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`);

  // 显示运行模式
  if (CI_MODE) {
    console.log(`${colors.cyan}${colors.bold}【运行模式: CI 环境】${colors.reset}\n`);
  }

  // BLOCKER 汇总
  if (blockers.length > 0) {
    console.log(`${colors.red}${colors.bold}【BLOCKER - 会阻止发布的问题】${colors.reset}`);
    for (const b of blockers) {
      console.log(`  ❌ [${b.category}] ${b.message}`);
      if (b.details) console.log(`     详情: ${b.details}`);
    }
    console.log('');
  }

  // WARNING 汇总
  if (warnings.length > 0) {
    console.log(`${colors.yellow}${colors.bold}【WARNING - 需人工确认的警告】${colors.reset}`);
    for (const w of warnings) {
      console.log(`  ⚠️  [${w.category}] ${w.message}`);
      if (w.details) console.log(`     详情: ${w.details}`);
    }
    console.log('');
  }

  // INFO 汇总
  if (infos.length > 0) {
    console.log(`${colors.cyan}${colors.bold}【INFO - 信息提示】${colors.reset}`);
    for (const i of infos) {
      console.log(`  ℹ️  [${i.category}] ${i.message}`);
      if (i.details) console.log(`     详情: ${i.details}`);
    }
    console.log('');
  }

  // 最终结论
  console.log(`${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`);

  if (hasBlocker) {
    console.log(`${colors.red}${colors.bold}❌ 检查失败！存在 ${blockers.length} 个阻塞问题，请修复后再尝试发布。${colors.reset}\n`);
    console.log(`${colors.yellow}⚠️  注意：WARNING 级别的问题不会阻止发布，但建议人工确认。${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}${colors.bold}✅ 所有阻塞检查通过！可以安全发布。${colors.reset}\n`);
    if (warnings.length > 0) {
      console.log(`${colors.yellow}⚠️  存在 ${warnings.length} 个警告项，建议人工确认。${colors.reset}\n`);
    }
    process.exit(0);
  }
}

function main() {
  console.log(`${colors.bold}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           🛡️  发布防事故系统 - Release Guard                ║');
  console.log('║              检查级别: BLOCKER | WARNING | INFO             ║');
  if (CI_MODE) {
    console.log('║              【CI 环境模式 - 放宽 Git 检查】                 ║');
  }
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);

  checkGit();
  checkTrackedFiles();
  checkConfig();
  checkEnv();
  scanHighRiskContent();

  printSummary();
}

main();
