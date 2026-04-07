import type { AIChatContextMessage, AISharedStoreSnapshot } from 'shared/aiChat'
import { providers } from 'shared/providers'
import { createLogger } from '#/logger'

// 引入 useAIChat store 类型用于共享配置
// 注意：这里使用类型导入避免循环依赖，实际获取通过函数参数

type ProviderType = keyof typeof providers

type ChatMessage = Pick<AIChatContextMessage, 'role' | 'content'>

const checkAPIKeyErrors = {
  NotFoundError: '目标平台不支持测试 API KEY，你可以跳过测试直接使用',
  AuthenticationError: 'API KEY 验证失败，请确认是否输入正确',
  UnknownError: '未知错误',
} as const

interface CheckAPIKeySuccess {
  kind: 'success'
}

interface CheckAPIKeyFail {
  kind: 'fail'
  type: keyof typeof checkAPIKeyErrors
  message?: string
}

type CheckAPIKeyResult = CheckAPIKeySuccess | CheckAPIKeyFail

type OpenAIConstructor = typeof import('openai').default
type OpenAIClient = InstanceType<OpenAIConstructor>
type OpenAIErrorConstructors = {
  AuthenticationError: typeof import('openai').AuthenticationError
  NotFoundError: typeof import('openai').NotFoundError
}

let openaiModulePromise: Promise<{ OpenAI: OpenAIConstructor } & OpenAIErrorConstructors> | null =
  null

async function loadOpenAIModule() {
  if (!openaiModulePromise) {
    openaiModulePromise = import('openai').then(module => ({
      OpenAI: module.default,
      AuthenticationError: module.AuthenticationError,
      NotFoundError: module.NotFoundError,
    }))
  }
  return openaiModulePromise
}

export class AIChatService {
  private logger: ReturnType<typeof createLogger> = createLogger('AI对话')
  private openai: OpenAIClient
  private apiKey: string
  private AuthenticationError: OpenAIErrorConstructors['AuthenticationError']
  private NotFoundError: OpenAIErrorConstructors['NotFoundError']
  private constructor(
    apiKey: string,
    openai: OpenAIClient,
    errors: OpenAIErrorConstructors,
    private provider: ProviderType,
  ) {
    this.apiKey = apiKey
    this.openai = openai
    this.AuthenticationError = errors.AuthenticationError
    this.NotFoundError = errors.NotFoundError
  }

  public static async createService(
    apiKey: string,
    provider: ProviderType,
    customBaseURL?: string,
  ) {
    let baseURL: string
    if (provider === 'custom') {
      if (!customBaseURL) {
        throw new Error('使用自定义 provider 请提供 baseURL')
      }
      baseURL = customBaseURL
    } else {
      baseURL = providers[provider].baseURL
    }

    const { OpenAI, AuthenticationError, NotFoundError } = await loadOpenAIModule()
    const openai = new OpenAI({ apiKey, baseURL })
    return new AIChatService(apiKey, openai, { AuthenticationError, NotFoundError }, provider)
  }

  public async *chatStream(messages: ChatMessage[], model: string) {
    try {
      this.logger.debug('流式 chatStream 请求', { model })
      const stream = await this.openai.chat.completions.create({
        model,
        messages,
        stream: true,
      })

      let contentLength = 0
      let reasoningLength = 0

      for await (const chunk of stream) {
        // 安全访问：检查 choices 是否存在且不为空
        if (!chunk.choices?.length) {
          continue
        }
        const delta = chunk.choices[0]?.delta
        if (!delta) {
          continue
        }
        const { content, reasoning_content: reasoning } = delta as typeof delta & {
          reasoning_content?: string
        }

        contentLength += content?.length ?? 0
        reasoningLength += reasoning?.length ?? 0

        if (content || reasoning) {
          yield { content, reasoning }
        }
      }

      this.logger.debug('chatStream 响应完成', {
        contentLength,
        reasoningLength,
      })
    } catch (error) {
      this.logger.error('AI 不想回答：chatStream 错误', error)
      throw error
    }
  }

  public async chat(messages: ChatMessage[], model: string) {
    try {
      this.logger.debug('非流式 chat 请求', { model })

      const response = await this.openai.chat.completions.create({
        model,
        messages,
        stream: false,
      })

      const output = response.choices[0].message.content ?? ''

      this.logger.debug('chat 响应完成', { outputLength: output.length })

      return output
    } catch (error) {
      this.logger.error('AI 不想回答：chat 错误', error)
      throw error
    }
  }

  public async checkAPIKey() {
    let result: CheckAPIKeyResult
    if (this.provider === 'openrouter') {
      result = await this.checkOpenRouterAPIKey()
    } else {
      result = await this.checkDefaultAPIKey()
    }

    if (result.kind === 'fail') {
      switch (result.type) {
        case 'NotFoundError':
          this.logger.error(checkAPIKeyErrors.NotFoundError)
          throw new Error(checkAPIKeyErrors.NotFoundError)
        case 'AuthenticationError':
          this.logger.error(checkAPIKeyErrors.AuthenticationError)
          throw new Error(checkAPIKeyErrors.AuthenticationError)
        default: {
          const errorMessage = `${checkAPIKeyErrors.UnknownError}: ${result.message}`
          this.logger.error(errorMessage)
          throw new Error(errorMessage)
        }
      }
    }

    this.logger.success('API Key 通过测试！你的 API Key 大概率是有效的')
  }

  private async checkDefaultAPIKey(): Promise<CheckAPIKeyResult> {
    try {
      await this.openai.models.list()
      return {
        kind: 'success',
      }
    } catch (error) {
      if (error instanceof this.NotFoundError) {
        return {
          kind: 'fail',
          type: 'NotFoundError',
        }
      }
      if (error instanceof this.AuthenticationError) {
        return {
          kind: 'fail',
          type: 'AuthenticationError',
        }
      }
      return {
        kind: 'fail',
        type: 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async checkOpenRouterAPIKey(): Promise<CheckAPIKeyResult> {
    const url = `${providers.openrouter.baseURL}/credits`
    const options = {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }
    const resp = await fetch(url, options)
    const data = await resp.json()
    switch (resp.status) {
      case 200:
        return {
          kind: 'success',
        }
      case 401: {
        return {
          kind: 'fail',
          type: 'AuthenticationError',
        }
      }
      default: {
        return {
          kind: 'fail',
          type: 'UnknownError',
          message: `${data?.error?.message}, CODE: ${data?.error?.code}`,
        }
      }
    }
  }
}

/**
 * 【P1-1 AI联动最小可用】AI 配置共享类
 *
 * 共享范围（严格限制）：
 * - 模型选择、API Key、BaseURL
 * - System Prompt
 * - Temperature
 * - 最近3轮对话上下文（只读）
 *
 * 明确不做：
 * - 历史写回 AI 对话
 * - 实时感知直播间评论
 * - 自动回复风格学习
 * - 失败回退机制
 * - 频率限制联动
 */
export class AISharedConfig {
  private static logger = createLogger('AISharedConfig')

  /**
   * 获取 AI 对话的共享配置
   * @param getStore 获取 useAIChat store 的函数（避免直接导入导致循环依赖）
   */
  static getConfig(getStore: () => AISharedStoreSnapshot) {
    try {
      const store = getStore()
      const provider = store.config.provider
      const providerConfig = providers[provider]

      const config = {
        // 基础配置
        provider,
        model: store.config.model,
        apiKey: store.apiKeys[provider] || '',
        baseURL: store.customBaseURL || providerConfig.baseURL,

        // 生成参数
        temperature: store.config.temperature ?? 0.7,

        // 系统提示词
        systemPrompt: store.systemPrompt || '你是一个 helpful assistant',

        // 最近3轮对话上下文（只读）
        // 取最后6条消息（3轮对话 = 3 user + 3 assistant）
        recentMessages: store.messages.slice(-6).map(m => ({
          role: m.role,
          content: m.content,
        })),
      }

      AISharedConfig.logger.debug('[getConfig] 共享配置获取成功', {
        provider: config.provider,
        model: config.model,
        temperature: config.temperature,
        recentMessagesCount: config.recentMessages.length,
      })

      return config
    } catch (error) {
      AISharedConfig.logger.error('[getConfig] 获取共享配置失败:', error)
      // 返回默认配置
      return {
        provider: 'deepseek' as const,
        model: providers.deepseek.models[0],
        apiKey: '',
        baseURL: providers.deepseek.baseURL,
        temperature: 0.7,
        systemPrompt: '你是一个 helpful assistant',
        recentMessages: [],
      }
    }
  }

  /**
   * 检查共享配置是否可用
   * @param getStore 获取 useAIChat store 的函数
   */
  static isConfigValid(getStore: () => AISharedStoreSnapshot): boolean {
    try {
      const store = getStore()
      const provider = store.config.provider
      const apiKey = store.apiKeys[provider]

      const isValid = !!apiKey && apiKey.length > 10

      AISharedConfig.logger.debug('[isConfigValid]', { provider, isValid })

      return isValid
    } catch (error) {
      AISharedConfig.logger.error('[isConfigValid] 检查失败:', error)
      return false
    }
  }
}
