import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
// @ts-expect-error - Tailwind CSS Vite plugin is ESM only
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

/** 主进程构建完成后复制 runtime（含 load-playwright.cjs），dev 时也会执行，避免主进程 require 报错 */
function copyMainRuntime() {
  return {
    name: 'copy-main-runtime',
    closeBundle() {
      const root = process.cwd()
      const srcDir = path.join(root, 'electron', 'main', 'runtime')
      const destDir = path.join(root, 'dist-electron', 'main', 'runtime')
      const file = 'load-playwright.cjs'
      if (!existsSync(path.join(srcDir, file))) return
      mkdirSync(destDir, { recursive: true })
      copyFileSync(path.join(srcDir, file), path.join(destDir, file))
    },
  }
}

console.log('>>> USING VITE CONFIG:', __filename)

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const isServe = command === 'serve'
  const isBuild = command === 'build'
  // 仅在生产构建时清空 dist-electron，开发时保留以免 Electron 启动找不到 main
  if (isBuild) {
    rmSync('dist-electron', { recursive: true, force: true })
  }
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  return {
    base: isBuild ? './' : '/',
    build: {
      // 生产构建不打 sourcemap，减小发行包体积
      sourcemap: isBuild ? false : sourcemap,
      // 生产构建去掉 console/debugger，减少控制台泄露与噪音
      ...(isBuild && { esbuild: { drop: ['console', 'debugger'] } }),
      // chunk 大小警告限制
      chunkSizeWarningLimit: 1000,
      // CSS 压缩
      cssMinify: true,
      // 启用代码压缩
      minify: isBuild ? 'esbuild' : false,
      // 目标浏览器
      target: 'esnext',
      // Rollup 配置 - chunk 分割策略
      rollupOptions: {
        output: {
          // 手动 chunk 分割，优化缓存策略
          manualChunks: {
            // React 核心库单独打包
            'react-vendor': ['react', 'react-dom', 'react-router'],
            // Radix UI 组件库单独打包
            'ui-vendor': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-popover',
              '@radix-ui/react-select',
              '@radix-ui/react-toast',
              '@radix-ui/react-tooltip',
              '@radix-ui/react-tabs',
              '@radix-ui/react-switch',
              '@radix-ui/react-checkbox',
              '@radix-ui/react-alert-dialog',
              '@radix-ui/react-scroll-area',
              '@radix-ui/react-separator',
              '@radix-ui/react-toggle',
              '@radix-ui/react-label',
              '@radix-ui/react-progress',
              '@radix-ui/react-radio-group',
              '@radix-ui/react-collapsible',
              '@radix-ui/react-context-menu',
            ],
            // Markdown 相关库单独打包（按需加载）
            'markdown-vendor': ['react-markdown', 'remark-gfm'],
            // HTML 清洗单独打包，避免和 Markdown 高亮强绑定
            'html-vendor': ['dompurify'],
            // 工具库单独打包
            'utils-vendor': ['lodash-es', 'zustand', 'immer', 'ahooks', 'clsx', 'tailwind-merge'],
            // 图标库单独打包
            'icons-vendor': ['lucide-react'],
            // 表单验证库单独打包
            'form-vendor': ['class-variance-authority'],
          },
          // chunk 文件命名优化
          chunkFileNames: chunkInfo => {
            const name = chunkInfo.name
            if (name?.includes('vendor')) {
              return 'assets/vendor/[name]-[hash].js'
            }
            return 'assets/js/[name]-[hash].js'
          },
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: assetInfo => {
            const info = assetInfo.name?.split('.') || []
            const ext = info[info.length - 1] || ''
            if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(assetInfo.name || '')) {
              return 'assets/images/[name]-[hash][extname]'
            }
            if (/\.(woff2?|ttf|otf|eot)$/i.test(assetInfo.name || '')) {
              return 'assets/fonts/[name]-[hash][extname]'
            }
            if (ext === 'css') {
              return 'assets/css/[name]-[hash][extname]'
            }
            return 'assets/[name]-[hash][extname]'
          },
        },
      },
      // 报告压缩后大小
      reportCompressedSize: isBuild,
    },
    // 优化依赖预构建
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router',
        'zustand',
        'immer',
        'lodash-es',
        'lucide-react',
        'clsx',
        'tailwind-merge',
        'class-variance-authority',
      ],
      exclude: ['playwright', 'better-sqlite3', 'electron-updater', 'electron-log'],
    },
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
        '#': path.join(__dirname, 'electron/main'),
        shared: path.join(__dirname, 'shared'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      electron({
        main: {
          entry: 'electron/main/index.ts',
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log('[startup] Electron App')
            } else {
              console.log('\n[Electron] 正在启动桌面窗口，请稍候…')
              args.startup()
              console.log(
                '[Electron] 已启动。若未看到窗口，请检查任务栏/系统托盘，或在浏览器打开上方显示的 Local 地址。\n',
              )
            }
          },
          vite: {
            build: {
              sourcemap: !isBuild,
              minify: isBuild,
              outDir: 'dist-electron/main',
              ...(isBuild && { esbuild: { drop: ['console', 'debugger'] } }),
              rollupOptions: {
                external: [
                  'electron',
                  'playwright',
                  'bufferutil',
                  'utf-8-validate',
                  'better-sqlite3',
                  'electron-updater',
                  'exceljs',
                ],
                output: {
                  // 主进程运行期间如果重新 build，哈希 chunk 会被替换掉，
                  // 旧进程后续再动态 require('./dev-旧hash.js') 就会报 Cannot find module。
                  // 这里把主进程的动态 chunk 名固定下来，避免运行中的旧进程引用失效。
                  chunkFileNames: '[name]-chunk.js',
                },
              },
            },
            resolve: {
              alias: {
                '#': path.join(__dirname, 'electron/main'),
                shared: path.join(__dirname, 'shared'),
              },
            },
            plugins: [copyMainRuntime()],
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          vite: {
            build: {
              sourcemap: isBuild ? false : sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron/preload',
              ...(isBuild && { esbuild: { drop: ['console', 'debugger'] } }),
              rollupOptions: {
                external: [
                  'playwright',
                  'bufferutil',
                  'utf-8-validate',
                  'better-sqlite3',
                  'electron-updater',
                  'exceljs',
                ],
              },
            },
            resolve: {
              alias: {
                shared: path.join(__dirname, 'shared'),
              },
            },
          },
        },
        renderer: {},
      }),
    ],
    server: {
      // 强制使用 IPv4，避免 Electron 连接 IPv6 失败
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // 忽略监视特定文件，防止不必要的页面重载
      watch: {
        ignored: [
          '**/*.md',
          '**/FINAL_SECURITY_RELEASE_AUDIT.md',
          '**/.git/**',
          '**/node_modules/**',
          '**/dist/**',
          '**/dist-electron/**',
          '**/release/**',
        ],
      },
    },
    clearScreen: false,
  }
})
