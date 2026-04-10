#!/usr/bin/env node
/**
 * 部署下载页面到阿里云 OSS 根目录
 *
 * 功能：
 * 1. 将 download-page/index.html 上传到 OSS 根目录
 * 2. 设置正确的 Content-Type: text/html
 * 3. 不影响 releases/latest/ 目录
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

function log(message, type = 'info') {
  const color = type === 'success' ? colors.green : type === 'warning' ? colors.yellow : type === 'error' ? colors.red : colors.blue;
  console.log(`${color}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options }).trim();
  } catch (error) {
    if (options.ignoreError) return '';
    throw error;
  }
}

// 检查环境变量
function checkEnvironment() {
  const required = [
    'ALIYUN_ACCESS_KEY_ID',
    'ALIYUN_ACCESS_KEY_SECRET'
  ];

  const missing = [];
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    log('\n❌ 缺少必需的环境变量:', 'error');
    for (const key of missing) {
      log(`   - ${key}`, 'error');
    }
    log('\n请设置环境变量后重试:', 'info');
    log('  export ALIYUN_ACCESS_KEY_ID=your_access_key_id', 'cyan');
    log('  export ALIYUN_ACCESS_KEY_SECRET=your_access_key_secret', 'cyan');
    process.exit(1);
  }

  return {
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET || 'xiuer-live-tools-download',
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-hangzhou'
  };
}

// 检查 ossutil 是否存在
function checkOssutil() {
  const localCandidates = [
    path.join(process.cwd(), 'tools', 'ossutil', 'ossutil'),
    path.join(process.cwd(), 'ossutil')
  ];

  for (const ossutilPath of localCandidates) {
    if (fs.existsSync(ossutilPath)) {
      return ossutilPath;
    }
  }

  try {
    exec('which ossutil');
    return 'ossutil';
  } catch {
    log('\n❌ 未找到 ossutil', 'error');
    log('请确保 ossutil 位于 tools/ossutil、项目根目录或系统 PATH 中', 'info');
    process.exit(1);
  }
}

// 配置 ossutil
function configureOssutil(ossutilPath, config) {
  log('\n配置 ossutil...', 'info');
  try {
    exec(`${ossutilPath} config -e ${config.region}.aliyuncs.com -i "${config.accessKeyId}" -k "${config.accessKeySecret}" -L CH`);
    log('✅ ossutil 配置成功', 'success');
  } catch (error) {
    throw new Error(`ossutil 配置失败: ${error.message}`);
  }
}

// 主函数
function main() {
  console.log(`${colors.bold}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        ☁️  部署下载页面到 OSS 根目录                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);

  try {
    // 1. 检查下载页面文件
    const pagePath = path.join('download-page', 'index.html');
    if (!fs.existsSync(pagePath)) {
      throw new Error(`下载页面不存在: ${pagePath}`);
    }

    const stats = fs.statSync(pagePath);
    log(`下载页面: ${pagePath}`, 'info');
    log(`文件大小: ${(stats.size / 1024).toFixed(2)} KB`, 'info');

    // 2. 检查环境变量
    const config = checkEnvironment();
    log(`\nOSS Bucket: ${config.bucket}`, 'info');
    log(`OSS Region: ${config.region}`, 'info');

    // 3. 检查 ossutil
    const ossutilPath = checkOssutil();
    log(`\n使用 ossutil: ${ossutilPath}`, 'info');

    // 4. 配置 ossutil
    configureOssutil(ossutilPath, config);

    // 5. 上传文件到 OSS 根目录
    const ossPath = `oss://${config.bucket}/index.html`;
    log(`\n开始上传到 OSS...`, 'info');
    log(`目标路径: ${ossPath}`, 'info');

    try {
      // 强制覆盖，并为 HTML 显式关闭缓存，避免版本发布后页面仍显示旧版本。
      exec(
        `${ossutilPath} cp "${pagePath}" "${ossPath}" -f ` +
        '--meta=Content-Type:text/html#Cache-Control:no-cache,no-store,must-revalidate'
      );
      log('✅ 上传成功', 'success');
    } catch (error) {
      log(`❌ 上传失败: ${error.message}`, 'error');
      process.exit(1);
    }

    // 6. 验证上传
    log('\n验证上传...', 'info');
    try {
      const result = exec(`${ossutilPath} ls ${ossPath}`);
      if (result.includes('index.html')) {
        log('✅ 文件已存在于 OSS', 'success');
      } else {
        log('⚠️ 无法确认文件是否存在', 'warning');
      }
    } catch (error) {
      log(`⚠️ 验证失败: ${error.message}`, 'warning');
    }

    // 7. 输出结果
    console.log(`\n${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}${colors.bold}  ✅ 下载页面部署完成！${colors.reset}`);
    console.log(`${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`);

    log('访问地址:', 'info');
    log('  https://download.xiuer.work/', 'cyan');
    log('  https://download.xiuer.work/index.html', 'cyan');

    log('\n重要说明:', 'warning');
    log('  • 页面已部署到 OSS 根目录', 'info');
    log('  • releases/latest/ 目录不受影响', 'info');
    log('  • 自动更新链路保持不变', 'info');

    log('\n验证命令:', 'info');
    log('  curl -I https://download.xiuer.work/', 'cyan');
    log('  curl -I https://download.xiuer.work/releases/latest/latest.yml', 'cyan');

  } catch (error) {
    log(`\n❌ 错误: ${error.message}`, 'error');
    process.exit(1);
  }
}

main();
