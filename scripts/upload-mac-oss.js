#!/usr/bin/env node
/**
 * Mac 产物自动上传到阿里云 OSS/CDN
 * 
 * 功能：
 * 1. 读取 package.json 当前 version
 * 2. 自动定位 release/<version>/ 目录中的 macOS 产物
 * 3. 检查阿里云 AccessKey 环境变量
 * 4. 使用 ossutil 上传文件到 OSS releases/latest/ 目录
 * 5. 支持覆盖已有文件，避免重复失败
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

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

function fail(message) {
  log(`\n❌ ${message}`, 'error');
  process.exit(1);
}

function getOssutilConfigPath() {
  return process.env.OSSUTIL_CONFIG_FILE || path.join(process.env.HOME || '', '.ossutilconfig');
}

// 读取 package.json 版本
function getVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    return packageJson.version;
  } catch (error) {
    throw new Error(`读取 package.json 失败: ${error.message}`);
  }
}

// 查找 Mac 产物文件
function findMacArtifacts(releaseDir) {
  const artifacts = [];
  
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release 目录不存在: ${releaseDir}`);
  }
  
  const patterns = [
    /_macos_arm64\.dmg$/,
    /_macos_x64\.dmg$/,
    /latest-mac\.yml$/,
    /\.blockmap$/
  ];
  
  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        for (const pattern of patterns) {
          if (pattern.test(entry.name)) {
            artifacts.push(fullPath);
            break;
          }
        }
      }
    }
  }
  
  scanDir(releaseDir);
  return artifacts;
}

function validateLocalMacArtifacts(version, artifacts) {
  const latestYmlPath = artifacts.find(file => path.basename(file) === 'latest-mac.yml');
  if (!latestYmlPath) {
    throw new Error('缺少 latest-mac.yml，本次 mac 产物不完整');
  }

  const latestYml = YAML.parse(fs.readFileSync(latestYmlPath, 'utf-8'));
  const expectedArm64 = `Xiuer-Live-Assistant_${version}_macos_arm64.dmg`;
  const expectedX64 = `Xiuer-Live-Assistant_${version}_macos_x64.dmg`;
  const expectedArm64Blockmap = `${expectedArm64}.blockmap`;
  const expectedX64Blockmap = `${expectedX64}.blockmap`;

  if (latestYml.version !== version) {
    throw new Error(`latest-mac.yml 版本不匹配: 期望 ${version}, 实际 ${latestYml.version || '空'}`);
  }

  const fileNames = Array.isArray(latestYml.files) ? latestYml.files.map(file => file.url) : [];
  if (!fileNames.includes(expectedArm64) || !fileNames.includes(expectedX64)) {
    throw new Error(`latest-mac.yml 未声明当前版本的双架构 dmg: ${expectedArm64}, ${expectedX64}`);
  }

  const artifactNames = new Set(artifacts.map(file => path.basename(file)));
  for (const fileName of [expectedArm64, expectedX64, expectedArm64Blockmap, expectedX64Blockmap]) {
    if (!artifactNames.has(fileName)) {
      throw new Error(`本地缺少发布文件: ${fileName}`);
    }
  }

  return {
    expectedFiles: ['latest-mac.yml', expectedArm64, expectedX64, expectedArm64Blockmap, expectedX64Blockmap],
  };
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
  
  return {
    hasExplicitCredentials: missing.length === 0,
    missing,
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET || 'xiuer-live-tools-download',
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-hangzhou',
    prefix: process.env.ALIYUN_OSS_PREFIX || 'releases/latest'
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
    exec(`"${ossutilPath}" config -e ${config.region}.aliyuncs.com -i "${config.accessKeyId}" -k "${config.accessKeySecret}" -L CH`);
    log('✅ ossutil 配置成功', 'success');
  } catch (error) {
    throw new Error(`ossutil 配置失败: ${error.message}`);
  }
}

function verifyOssAccess(ossutilPath, config) {
  const verifyPath = `oss://${config.bucket}/${config.prefix}/`;
  try {
    exec(`"${ossutilPath}" ls "${verifyPath}"`, { ignoreError: false });
    log('✅ OSS 凭据校验通过', 'success');
  } catch (error) {
    const message = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n');
    if (message.includes('SignatureDoesNotMatch')) {
      throw new Error('OSS 凭据无效：签名不匹配，请更新 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 或修复本地 ossutil 配置');
    }
    if (message.includes('InvalidAccessKeyId')) {
      throw new Error('OSS 凭据无效：AccessKeyId 不存在');
    }
    if (message.includes('AccessDenied')) {
      throw new Error('OSS 凭据权限不足：当前账号无权访问目标 Bucket');
    }
    throw new Error(`OSS 连接校验失败: ${message}`);
  }
}

// 主函数
function main() {
  console.log(`${colors.bold}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        ☁️  Mac 产物自动上传到 OSS/CDN                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);
  
  try {
    // 1. 获取版本
    const version = getVersion();
    log(`当前版本: v${version}`, 'success');
    
    const releaseDir = path.join('release', version);
    
    // 2. 检查环境变量
    const config = checkEnvironment();
    log(`OSS Bucket: ${config.bucket}`, 'info');
    log(`OSS Region: ${config.region}`, 'info');
    log(`上传路径: ${config.prefix}/`, 'info');
    if (!config.hasExplicitCredentials) {
      log('\n未检测到显式阿里云环境变量，准备尝试现有 ossutil 配置', 'warning');
      log(`  当前配置文件: ${getOssutilConfigPath()}`, 'info');
    }
    
    // 3. 查找产物文件
    log(`\n扫描目录: ${releaseDir}`, 'info');
    const artifacts = findMacArtifacts(releaseDir);
    
    if (artifacts.length === 0) {
      fail('未找到 Mac 产物文件，请确保已运行 npm run release:mac');
    }
    
    log(`找到 ${artifacts.length} 个产物文件:`, 'success');
    for (const file of artifacts) {
      const stats = fs.statSync(file);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      log(`  - ${path.basename(file)} (${sizeMB} MB)`, 'info');
    }

    const { expectedFiles } = validateLocalMacArtifacts(version, artifacts);
    log('\n本地 mac 产物版本校验通过', 'success');
    
    // 4. 检查 ossutil
    const ossutilPath = checkOssutil();
    log(`\n使用 ossutil: ${ossutilPath}`, 'info');
    
    // 5. 配置 ossutil
    if (config.hasExplicitCredentials) {
      configureOssutil(ossutilPath, config);
    } else {
      const configPath = getOssutilConfigPath();
      if (!fs.existsSync(configPath)) {
        log('\n❌ 缺少必需的环境变量:', 'error');
        for (const key of config.missing) {
          log(`   - ${key}`, 'error');
        }
        fail(`未找到可复用的 ossutil 配置文件: ${configPath}`);
      }
      log('使用现有 ossutil 配置文件', 'info');
    }

    verifyOssAccess(ossutilPath, config);
    
    // 6. 上传文件
    const ossPath = `oss://${config.bucket}/${config.prefix}/`;
    log(`\n开始上传到 OSS...`, 'info');
    log(`目标路径: ${ossPath}`, 'info');
    
    for (const file of artifacts) {
      const fileName = path.basename(file);
      log(`\n上传: ${fileName}`, 'info');
      
      try {
        const metaArgs =
          fileName === 'latest-mac.yml'
            ? ' --meta "Cache-Control:no-cache#Content-Type:application/yaml"'
            : '';
        exec(`"${ossutilPath}" cp "${file}" "${ossPath}${fileName}" -f${metaArgs}`);
        log(`  ✅ 成功`, 'success');
      } catch (error) {
        log(`  ❌ 失败: ${error.message}`, 'error');
        process.exit(1);
      }
    }
    
    // 7. 输出结果
    console.log(`\n${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}${colors.bold}  ✅ Mac 产物 OSS 上传完成！版本: ${version}${colors.reset}`);
    console.log(`${colors.green}${colors.bold}════════════════════════════════════════════════════════════${colors.reset}\n`);
    
    log('OSS 下载地址:', 'info');
    log(`  https://${config.bucket}.${config.region}.aliyuncs.com/${config.prefix}/latest-mac.yml`, 'cyan');
    log(`  https://download.xiuer.work/${config.prefix}/latest-mac.yml`, 'cyan');
    
    log('\n已上传文件:', 'info');
    for (const fileName of expectedFiles) {
      log(`  ✓ ${fileName}`, 'success');
    }
    
  } catch (error) {
    fail(error.message);
  }
}

main();
