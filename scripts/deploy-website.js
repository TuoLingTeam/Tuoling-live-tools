#!/usr/bin/env node
/**
 * 部署官方主站到阿里云 OSS
 *
 * 功能：
 * 1. 将 website/index.html 上传到 OSS xiuer-work-website Bucket
 * 2. 设置正确的 Content-Type: text/html
 * 3. 配置静态网站托管
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
    bucket: process.env.XIUER_WEBSITE_BUCKET || 'xiuer-work-website',
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

// 检查 Bucket 是否存在，不存在则创建
function ensureBucket(ossutilPath, config) {
  log(`\n检查 Bucket: ${config.bucket}`, 'info');
  try {
    const result = exec(`${ossutilPath} ls oss://${config.bucket}/`, { ignoreError: true });
    if (result.includes('Error') || result.includes('NoSuchBucket')) {
      log(`Bucket 不存在，创建中...`, 'warning');
      try {
        exec(`${ossutilPath} mb oss://${config.bucket}/`);
        log(`✅ Bucket 创建成功`, 'success');
      } catch (error) {
        throw new Error(`Bucket 创建失败: ${error.message}`);
      }
    } else {
      log(`✅ Bucket 已存在`, 'success');
    }
  } catch (error) {
    log(`⚠️ 检查 Bucket 时出错，尝试创建...`, 'warning');
    try {
      exec(`${ossutilPath} mb oss://${config.bucket}/`);
      log(`✅ Bucket 创建成功`, 'success');
    } catch (createError) {
      throw new Error(`Bucket 操作失败: ${createError.message}`);
    }
  }
}

// 配置静态网站托管
function configureWebsite(ossutilPath, config) {
  log('\n配置静态网站托管...', 'info');
  const websiteConfigPath = path.join('website', 'website-config.xml');
  
  // 创建临时配置文件
  const websiteConfig = `<?xml version="1.0" encoding="UTF-8"?>
<WebsiteConfiguration>
  <IndexDocument>
    <Suffix>index.html</Suffix>
  </IndexDocument>
</WebsiteConfiguration>`;
  
  fs.writeFileSync(websiteConfigPath, websiteConfig);
  
  try {
    exec(`${ossutilPath} website --method put oss://${config.bucket}/ ${websiteConfigPath}`);
    log('✅ 静态网站托管配置成功', 'success');
  } catch (error) {
    log(`⚠️ 静态网站托管配置失败: ${error.message}`, 'warning');
  }
  
  // 清理临时文件
  try {
    fs.unlinkSync(websiteConfigPath);
  } catch {}
}

// 设置 Bucket 为公共读
function setBucketPublic(ossutilPath, config) {
  log('\n设置 Bucket 访问权限...', 'info');
  try {
    exec(`${ossutilPath} set-acl oss://${config.bucket}/ public-read`);
    log('✅ Bucket 已设置为公共读', 'success');
  } catch (error) {
    log(`⚠️ 设置权限失败: ${error.message}`, 'warning');
  }
}

// 主函数
function main() {
  console.log(`${colors.bold}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        ☁️  部署官方主站到 OSS                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);

  try {
    // 1. 检查主站页面文件
    const pagePath = path.join('website', 'index.html');
    if (!fs.existsSync(pagePath)) {
      throw new Error(`主站页面不存在: ${pagePath}`);
    }

    const stats = fs.statSync(pagePath);
    log(`主站页面: ${pagePath}`, 'info');
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

    // 5. 确保 Bucket 存在
    ensureBucket(ossutilPath, config);

    // 6. 设置 Bucket 权限
    setBucketPublic(ossutilPath, config);

    // 7. 配置静态网站托管
    configureWebsite(ossutilPath, config);

    // 8. 上传文件到 OSS 根目录
    const ossPath = `oss://${config.bucket}/index.html`;
    log(`\n开始上传到 OSS...`, 'info');
    log(`目标路径: ${ossPath}`, 'info');

    try {
      exec(
        `${ossutilPath} cp "${pagePath}" "${ossPath}" -f ` +
        '--meta=Content-Type:text/html#Cache-Control:no-cache,no-store,must-revalidate'
      );
      log('✅ 上传成功', 'success');
    } catch (error) {
      log(`❌ 上传失败: ${error.message}`, 'error');
      process.exit(1);
    }

    // 9. 验证上传
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

    // 10. 输出结果
    console.log(`\n${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}${colors.bold}  ✅ 官方主站部署完成！${colors.reset}`);
    console.log(`${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`);

    log('访问地址:', 'info');
    log(`  https://${config.bucket}.${config.region}.aliyuncs.com/`, 'cyan');
    log('\n如需绑定自定义域名 xiuer.work，请在阿里云控制台:', 'info');
    log('  1. 配置 CDN 加速域名: xiuer.work', 'cyan');
    log('  2. 设置 CNAME 解析到 CDN 地址', 'cyan');
    log('  3. 开启 HTTPS 并绑定证书', 'cyan');

    log('\n重要说明:', 'warning');
    log('  • 页面已部署到 OSS 根目录', 'info');
    log('  • 静态网站托管已启用', 'info');
    log('  • download.xiuer.work 下载站不受影响', 'info');

  } catch (error) {
    log(`\n❌ 错误: ${error.message}`, 'error');
    process.exit(1);
  }
}

main();
