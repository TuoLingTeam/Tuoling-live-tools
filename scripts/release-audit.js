#!/usr/bin/env node
/**
 * 发布前审计脚本 - Release Audit
 * 只做检查，不阻断构建，输出审计报告
 *
 * 检查级别：
 * - BLOCKER: 会阻止发布的硬阻塞项
 * - WARNING: 审计警告，需人工确认但不会阻止发布
 * - INFO: 信息提示
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
  },
];

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options }).trim();
  } catch (error) {
    if (options.ignoreError) return '';
    throw error;
  }
}

function printSection(title) {
  console.log(`\n${colors.cyan}${colors.bold}📋 ${title}${colors.reset}`);
  console.log('─'.repeat(60));
}

function printItem(label, value, status = 'info') {
  const color = status === 'ok' ? colors.green : status === 'warn' ? colors.yellow : status === 'error' ? colors.red : status === 'blocker' ? colors.red : colors.reset;
  const icon = status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : status === 'error' ? '❌' : status === 'blocker' ? '❌' : '•';
  console.log(`${icon} ${label}: ${color}${value}${colors.reset}`);
}

// ==================== 审计项目 ====================
function auditVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    printItem('当前版本', packageJson.version || '未设置', packageJson.version ? 'ok' : 'error');
    return packageJson.version;
  } catch (error) {
    printItem('当前版本', '读取失败', 'error');
    return null;
  }
}

function auditRemote() {
  try {
    const remotes = exec('git remote -v');
    if (remotes) {
      console.log(remotes.split('\n').map(r => `   ${r}`).join('\n'));
    } else {
      printItem('Remote', '未配置', 'warn');
    }
  } catch (error) {
    printItem('Remote', '读取失败', 'error');
  }
}

function auditGitStatus() {
  try {
    const status = exec('git status --short');
    if (status === '') {
      printItem('Git 状态', '干净（无未提交修改）', 'ok');
    } else {
      printItem('Git 状态', '存在未提交修改', 'warn');
      console.log('   修改文件列表：');
      console.log(status.split('\n').map(s => `     ${s}`).join('\n'));
    }
  } catch (error) {
    printItem('Git 状态', '检查失败', 'error');
  }
}

function auditGitignore() {
  printSection('.gitignore 关键规则检查');

  const requiredRules = [
    'node_modules',
    'dist',
    'dist-electron',
    'release',
    'build',
    'out',
    '*.db',
    '*.sqlite',
    '*.sqlite3',
    '.env',
    '*.local'
  ];

  try {
    const gitignore = fs.readFileSync('.gitignore', 'utf-8');
    const lines = gitignore.split('\n').map(l => l.trim());

    for (const rule of requiredRules) {
      const exists = lines.some(l => l === rule || l === `${rule}/` || l === `/${rule}`);
      printItem(rule, exists ? '已配置' : '未配置', exists ? 'ok' : 'warn');
    }
  } catch (error) {
    printItem('.gitignore', '文件不存在', 'error');
  }
}

function auditTrackedFiles() {
  printSection('Git 跟踪文件检查');

  const forbiddenPatterns = [
    { pattern: /^release\//, name: 'release/' },
    { pattern: /^dist\//, name: 'dist/' },
    { pattern: /^dist-electron\//, name: 'dist-electron/' },
    { pattern: /^build\//, name: 'build/' },
    { pattern: /^out\//, name: 'out/' },
    { pattern: /\.db$/, name: '*.db' },
    { pattern: /\.sqlite$/, name: '*.sqlite' },
    { pattern: /\.sqlite3$/, name: '*.sqlite3' },
    { pattern: /^\.env/, name: '.env*' }
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
      printItem('禁止文件检查', '未发现被跟踪的禁止文件', 'ok');
    } else {
      printItem('禁止文件检查', `发现 ${violations.length} 个被跟踪的禁止文件`, 'error');
      for (const { file, pattern } of violations.slice(0, 10)) {
        console.log(`   ❌ ${file} (${pattern})`);
      }
      if (violations.length > 10) {
        console.log(`   ... 还有 ${violations.length - 10} 个文件`);
      }
    }
  } catch (error) {
    printItem('Git 跟踪文件', '检查失败', 'error');
  }
}

function auditApiConfig() {
  printSection('API 地址配置');

  // 检查环境变量
  const envApiUrl = process.env.VITE_AUTH_API_BASE_URL;
  if (envApiUrl) {
    const isLocal = envApiUrl.includes('localhost') || envApiUrl.includes('127.0.0.1');
    printItem('环境变量 VITE_AUTH_API_BASE_URL', envApiUrl, isLocal ? 'warn' : 'ok');
    if (isLocal) {
      console.log('   ⚠️  警告：当前配置为本地地址，发布时请设置为生产环境地址');
    }
  } else {
    printItem('环境变量 VITE_AUTH_API_BASE_URL', '未设置', 'warn');
  }

  // 检查代码中的默认配置
  try {
    const authApiBasePath = 'src/config/authApiBase.ts';
    if (fs.existsSync(authApiBasePath)) {
      const content = fs.readFileSync(authApiBasePath, 'utf-8');
      const match = content.match(/['"`](http[^'"`]+)['"`]/);
      if (match) {
        const defaultUrl = match[1];
        const isLocal = defaultUrl.includes('localhost') || defaultUrl.includes('127.0.0.1');
        const isFallback = content.includes('||') && isLocal;

        const isProdDevFallback =
          (content.includes('import.meta.env.PROD') || content.includes('metaEnv?.PROD')) &&
          (content.includes('http://localhost') || content.includes('127.0.0.1'))

        if ((isFallback || isProdDevFallback) && envApiUrl && !envApiUrl.includes('localhost') && !envApiUrl.includes('127.0.0.1')) {
          // 环境变量已正确设置，fallback 只是安全网
          printItem('代码默认地址', `${defaultUrl} (fallback 模式)`, 'ok');
          console.log('   ℹ️  环境变量已正确设置，fallback 地址不会生效');
        } else if (isLocal) {
          printItem('代码默认地址', defaultUrl, 'warn');
          console.log('   ⚠️  代码中存在 localhost fallback，如环境变量未设置将使用本地地址');
        } else {
          printItem('代码默认地址', defaultUrl, 'ok');
        }
      }
    }
  } catch (error) {
    // 忽略
  }
}

function auditLocalhostScan() {
  printSection('Localhost 引用扫描（按目录风险级别）');

  // 高风险目录
  const highRiskDirs = ['src', 'shared'];
  // 中风险目录
  const mediumRiskDirs = ['electron/main', 'preload'];
  // 低风险目录
  const lowRiskDirs = ['scripts'];

  const riskPatterns = [
    { pattern: /http:\/\/localhost/, name: 'http://localhost' },
    { pattern: /127\.0\.0\.1/, name: '127.0.0.1' }
  ];

  const blockerFindings = [];
  const warningFindings = [];
  const infoFindings = [];

  const scannedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.cjs', '.mjs'];

  function getRiskLevel(filePath) {
    for (const dir of lowRiskDirs) {
      if (filePath.startsWith(dir + path.sep) || filePath === dir) return 'info';
    }
    for (const dir of mediumRiskDirs) {
      if (filePath.startsWith(dir + path.sep) || filePath === dir) return 'warning';
    }
    for (const dir of highRiskDirs) {
      if (filePath.startsWith(dir + path.sep) || filePath === dir) return 'blocker';
    }
    return 'info';
  }

  function isFallbackPattern(line) {
    return (
      /\|\|.*localhost/.test(line) ||
      /\|\|.*127\.0\.0\.1/.test(line) ||
      (/(import\.meta\.env\??\.PROD|metaEnv\?\.PROD)/.test(line) &&
        (/localhost/.test(line) || /127\.0\.0\.1/.test(line)))
    );
  }

  function getAllowedLoopbackNote(filePath, line) {
    const normalizedPath = filePath.split(path.sep).join('/');
    const allowed = ALLOWED_LOOPBACK_FINDINGS.find(
      item => item.file === normalizedPath && line.includes(item.pattern)
    );
    return allowed?.note || null;
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
            const allowedNote = getAllowedLoopbackNote(filePath, line);
            const finding = {
              file: filePath,
              line: i + 1,
              content: line.trim().substring(0, 60),
              risk: name,
              isFallback: isFallbackPattern(line)
            };

            if (allowedNote) {
              infoFindings.push({ ...finding, note: allowedNote });
            } else if (finding.isFallback) {
              warningFindings.push({ ...finding, note: 'fallback 模式' });
            } else if (riskLevel === 'blocker') {
              blockerFindings.push(finding);
            } else if (riskLevel === 'warning') {
              warningFindings.push(finding);
            } else {
              infoFindings.push(finding);
            }
          }
        }
      }
    } catch (error) {
      // 跳过
    }
  }

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          scanDir(fullPath);
        }
      } else if (entry.isFile() && scannedExtensions.includes(path.extname(entry.name))) {
        scanFile(fullPath);
      }
    }
  }

  const allDirs = [...highRiskDirs, ...mediumRiskDirs, ...lowRiskDirs];
  for (const dir of allDirs) scanDir(dir);

  // 输出结果
  if (blockerFindings.length > 0) {
    console.log(`${colors.red}【高风险目录中的 localhost（会阻止发布）】${colors.reset}`);
    for (const f of blockerFindings.slice(0, 5)) {
      console.log(`  ❌ ${f.file}:${f.line} [${f.risk}]`);
    }
    if (blockerFindings.length > 5) console.log(`  ... 还有 ${blockerFindings.length - 5} 处`);
  }

  if (warningFindings.length > 0) {
    console.log(`${colors.yellow}【中风险目录中的 localhost（需确认）】${colors.reset}`);
    for (const f of warningFindings.slice(0, 5)) {
      console.log(`  ⚠️  ${f.file}:${f.line} [${f.risk}]${f.note ? ` (${f.note})` : ''}`);
    }
    if (warningFindings.length > 5) console.log(`  ... 还有 ${warningFindings.length - 5} 处`);
  }

  if (infoFindings.length > 0) {
    console.log(`${colors.cyan}【低风险 localhost（脚本/工具/允许的本地边界）】${colors.reset}`);
    console.log(`  ℹ️  发现 ${infoFindings.length} 处（已省略详情）`);
  }

  if (blockerFindings.length === 0 && warningFindings.length === 0 && infoFindings.length === 0) {
    printItem('Localhost 扫描', '未发现 localhost/127.0.0.1 引用', 'ok');
  }
}

function auditPublishConfig() {
  printSection('自动更新 Publish 配置');

  try {
    const builderConfig = JSON.parse(fs.readFileSync('electron-builder.json', 'utf-8'));
    const publish = builderConfig.publish;

    if (!publish) {
      printItem('Publish 配置', '未配置', 'error');
      return;
    }

    if (publish.provider === 'generic') {
      const url = publish.url || '';
      const validCdnUrl = url.startsWith('https://download.xiuer.work/');
      printItem('Provider', 'generic (CDN 模式)', 'ok');
      printItem('URL', url || '未设置', validCdnUrl ? 'ok' : 'warn');
      printItem('Channel', publish.channel || '未设置', publish.channel ? 'ok' : 'warn');
      console.log('\n   ✅ Publish 配置为 CDN generic 模式，与 release:guard 口径一致');
      return;
    }

    printItem('Provider', publish.provider || '未设置', publish.provider === 'github' ? 'ok' : 'warn');
    printItem('Owner', publish.owner || '未设置', publish.owner === 'Xiuer-Chinese' ? 'ok' : 'warn');
    printItem('Repo', publish.repo || '未设置', publish.repo === 'Xiuer-live-tools' ? 'ok' : 'warn');

    if (publish.provider === 'github' && publish.owner === 'Xiuer-Chinese' && publish.repo === 'Xiuer-live-tools') {
      console.log('\n   ✅ Publish 配置完全正确');
    } else {
      console.log('\n   ⚠️  Publish 配置与预期不符');
      console.log('   期望: provider=github, owner=Xiuer-Chinese, repo=Xiuer-live-tools');
    }
  } catch (error) {
    printItem('Publish 配置', '读取失败', 'error');
  }
}

function auditRecentCommits() {
  printSection('最近提交记录');

  try {
    const commits = exec('git log --oneline -n 5');
    console.log(commits.split('\n').map(c => `   ${c}`).join('\n'));
  } catch (error) {
    printItem('提交记录', '读取失败', 'error');
  }
}

// ==================== 主程序 ====================
function main() {
  console.log(`${colors.bold}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              📊 发布前审计报告 - Release Audit              ║');
  console.log('║         检查级别: BLOCKER | WARNING | INFO                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);

  printSection('基本信息');
  auditVersion();
  printItem('当前分支', exec('git branch --show-current') || '未知');
  printItem('审计时间', new Date().toLocaleString('zh-CN'));

  auditRemote();
  auditGitStatus();
  auditRecentCommits();
  auditGitignore();
  auditTrackedFiles();
  auditApiConfig();
  auditLocalhostScan();
  auditPublishConfig();

  // 总结
  console.log(`\n${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`);
  console.log(`${colors.cyan}${colors.bold}💡 提示：此审计仅做检查，不会阻止构建。${colors.reset}`);
  console.log(`${colors.cyan}   如需强制检查，请运行: npm run release:guard${colors.reset}\n`);
}

main();
