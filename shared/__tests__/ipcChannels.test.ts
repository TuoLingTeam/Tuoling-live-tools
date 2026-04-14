/**
 * IPC 通道契约测试
 * 验证 IPC_CHANNELS 常量定义的正确性和完整性
 */

import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../ipcChannels'

describe('IPC 通道契约测试', () => {
  describe('auth 命名空间', () => {
    it('应包含所有 auth 通道', () => {
      const expectedAuthChannels = [
        'register',
        'login',
        'loginWithSms',
        'logout',
        'validateToken',
        'getCurrentUser',
        'restoreSession',
        'refreshSession',
        'getAuthSummary',
        'proxyRequest',
        'startMessageStream',
        'stopMessageStream',
        'messageStreamSnapshot',
        'messageStreamState',
        'clearTokens',
        'checkFeatureAccess',
        'stateChanged',
        'loginRequired',
      ]

      expectedAuthChannels.forEach(channel => {
        expect(IPC_CHANNELS.auth).toHaveProperty(channel)
        expect(typeof IPC_CHANNELS.auth[channel as keyof typeof IPC_CHANNELS.auth]).toBe('string')
      })
    })

    it('auth 通道命名应符合规范', () => {
      Object.entries(IPC_CHANNELS.auth).forEach(([_key, value]) => {
        // 通道名应以 'auth:' 开头
        expect(value).toMatch(/^auth:/)
        // 通道名不应包含空格
        expect(value).not.toContain(' ')
      })
    })

    it('auth 通道名应与键名一致', () => {
      Object.entries(IPC_CHANNELS.auth).forEach(([key, value]) => {
        // 例如: login -> auth:login
        expect(value).toBe(`auth:${key}`)
      })
    })
  })

  describe('tasks 命名空间', () => {
    it('应包含 liveControl 子命名空间', () => {
      expect(IPC_CHANNELS.tasks).toHaveProperty('liveControl')
      expect(IPC_CHANNELS.tasks.liveControl).toHaveProperty('connect')
      expect(IPC_CHANNELS.tasks.liveControl).toHaveProperty('disconnect')
    })

    it('应包含 autoMessage 子命名空间', () => {
      expect(IPC_CHANNELS.tasks).toHaveProperty('autoMessage')
      expect(IPC_CHANNELS.tasks.autoMessage).toHaveProperty('start')
      expect(IPC_CHANNELS.tasks.autoMessage).toHaveProperty('stop')
    })

    it('应包含 commentListener 子命名空间', () => {
      expect(IPC_CHANNELS.tasks).toHaveProperty('commentListener')
      expect(IPC_CHANNELS.tasks.commentListener).toHaveProperty('start')
      expect(IPC_CHANNELS.tasks.commentListener).toHaveProperty('stop')
    })

    it('应包含 subAccount 子命名空间', () => {
      expect(IPC_CHANNELS.tasks).toHaveProperty('subAccount')
      expect(IPC_CHANNELS.tasks.subAccount).toHaveProperty('start')
      expect(IPC_CHANNELS.tasks.subAccount).toHaveProperty('stop')
    })
  })

  describe('通道命名唯一性', () => {
    it('所有通道值应唯一', () => {
      const allChannels: string[] = []

      // 收集所有通道值
      Object.entries(IPC_CHANNELS).forEach(([_key, value]) => {
        if (typeof value === 'string') {
          allChannels.push(value)
        } else if (typeof value === 'object' && value !== null) {
          Object.entries(value).forEach(([_subKey, subValue]) => {
            if (typeof subValue === 'string') {
              allChannels.push(subValue)
            } else if (typeof subValue === 'object' && subValue !== null) {
              Object.entries(subValue).forEach(([_deepKey, deepValue]) => {
                if (typeof deepValue === 'string') {
                  allChannels.push(deepValue)
                }
              })
            }
          })
        }
      })

      const uniqueChannels = new Set(allChannels)
      expect(uniqueChannels.size).toBe(allChannels.length)
    })
  })

  describe('关键通道存在性检查', () => {
    it('应包含关键诊断通道', () => {
      expect(IPC_CHANNELS.diagnostics).toBeDefined()
      expect(IPC_CHANNELS.diagnostics.getRuntimeStats).toBe('diagnostics:getRuntimeStats')
    })

    it('应包含配置通道', () => {
      expect(IPC_CHANNELS.config).toBeDefined()
      expect(IPC_CHANNELS.config.save).toBe('config:save')
      expect(IPC_CHANNELS.config.load).toBe('config:load')
    })

    it('应包含日志通道', () => {
      expect(IPC_CHANNELS.log).toBe('log')
    })

    it('应包含应用通道', () => {
      expect(IPC_CHANNELS.app).toBeDefined()
      expect(IPC_CHANNELS.app.openLogFolder).toBe('app:openLogFolder')
    })

    it('应包含更新通道', () => {
      expect(IPC_CHANNELS.updater).toBeDefined()
      expect(IPC_CHANNELS.updater.getStatus).toBe('updater:getStatus')
      expect(IPC_CHANNELS.updater.listBackups).toBe('updater:listBackups')
      expect(IPC_CHANNELS.updater.rollback).toBe('updater:rollback')
    })
  })

  describe('通道命名规范', () => {
    it('所有字符串通道应使用字母、数字、冒号、连字符和下划线', () => {
      const checkNaming = (obj: Record<string, unknown>, prefix = '') => {
        Object.entries(obj).forEach(([key, value]) => {
          if (typeof value === 'string') {
            // 应使用字母、数字、冒号、连字符和下划线
            expect(value).toMatch(/^[a-zA-Z0-9:_-]+$/)
          } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            checkNaming(value as Record<string, unknown>, `${prefix}${key}.`)
          }
          // 跳过函数类型（如 stoppedFor）
        })
      }

      checkNaming(IPC_CHANNELS as Record<string, unknown>)
    })

    it('函数类型通道应返回符合规范的字符串', () => {
      // 测试 stoppedFor 函数
      const accountId = 'test_account_123'
      const stoppedChannel = IPC_CHANNELS.tasks.autoMessage.stoppedFor(accountId)
      // 允许字母、数字、冒号、连字符和下划线
      expect(stoppedChannel).toMatch(/^[a-zA-Z0-9:_-]+$/)
      expect(stoppedChannel).toBe(`tasks:autoMessage:stopped:${accountId}`)
    })
  })
})
