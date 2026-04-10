import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { type RawData, WebSocket, WebSocketServer } from 'ws'
import { createLogger } from '#/logger'

const DEFAULT_PORT = 12354
const DEFAULT_HOST = '127.0.0.1'
const AUTH_TIMEOUT_MS = 5000

type StartOptions = {
  port: number
  token: string
}

type AuthPayload = {
  type: 'auth'
  token: string
}

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) {
    return false
  }
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

function parseAuthPayload(raw: RawData): AuthPayload | null {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8')
  try {
    const payload = JSON.parse(text) as Partial<AuthPayload>
    if (payload.type === 'auth' && typeof payload.token === 'string') {
      return { type: 'auth', token: payload.token }
    }
  } catch {
    // ignore invalid auth payload
  }
  return null
}

function isAuthorizedByQuery(request: IncomingMessage, expectedToken: string): boolean {
  const requestUrl = request.url
  if (!requestUrl) {
    return false
  }

  try {
    const url = new URL(requestUrl, `ws://${DEFAULT_HOST}`)
    const token = url.searchParams.get('token')
    return typeof token === 'string' && tokensMatch(expectedToken, token)
  } catch {
    return false
  }
}

export class WebSocketService {
  private wss: WebSocketServer | null = null
  private logger: ReturnType<typeof createLogger>
  private authenticatedClients = new WeakSet<WebSocket>()

  constructor() {
    this.logger = createLogger('WebSocket服务')
  }

  start(options: StartOptions) {
    return new Promise<void>((resolve, reject) => {
      let _port = options.port
      if (
        !options.port ||
        Number.isNaN(options.port) ||
        options.port < 0 ||
        !Number.isInteger(options.port)
      ) {
        _port = DEFAULT_PORT
      }
      const token = options.token?.trim()
      if (!token) {
        reject(new Error('WebSocket 服务缺少鉴权 token'))
        return
      }
      if (this.wss) {
        this.logger.warn('WebSocket服务已在运行')
        return resolve()
      }
      const server = new WebSocketServer({ host: DEFAULT_HOST, port: _port })

      const startErrorHandler = (err: Error) => {
        this.logger.error('WebSocket服务启动失败', err)
        this.wss = null
        server.close()
        reject(err)
      }
      // 如果端口被占用会报错
      server.once('error', startErrorHandler)
      server.once('listening', () => {
        this.logger.success(`WebSocket服务已启动，地址: ws://${DEFAULT_HOST}:${_port}`)
        server.off('error', startErrorHandler)
        resolve()
      })
      server.on('connection', (ws, request) => {
        let authTimer: NodeJS.Timeout | null = null

        const markAuthenticated = () => {
          this.authenticatedClients.add(ws)
          if (authTimer) {
            clearTimeout(authTimer)
            authTimer = null
          }
          ws.send(JSON.stringify({ type: 'auth-ok' }))
          this.logger.info('客户端已通过 WebSocket 鉴权')
        }

        const rejectConnection = (reason: string) => {
          if (authTimer) {
            clearTimeout(authTimer)
            authTimer = null
          }
          this.authenticatedClients.delete(ws)
          this.logger.warn(`拒绝未鉴权的 WebSocket 客户端: ${reason}`)
          ws.close(4401, reason)
        }

        if (isAuthorizedByQuery(request, token)) {
          markAuthenticated()
        } else {
          authTimer = setTimeout(() => {
            rejectConnection('Authentication timeout')
          }, AUTH_TIMEOUT_MS)

          ws.once('message', raw => {
            const payload = parseAuthPayload(raw)
            if (payload && tokensMatch(token, payload.token)) {
              markAuthenticated()
              return
            }
            rejectConnection('Invalid token')
          })
        }

        ws.on('close', () => {
          this.authenticatedClients.delete(ws)
          this.logger.info('客户端已断开')
        })
      })
      this.wss = server
    })
  }

  broadcast<T>(data: T) {
    if (!this.wss) return

    const message = JSON.stringify(data)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN && this.authenticatedClients.has(client)) {
        client.send(message)
      }
    }
  }

  stop(reason?: unknown) {
    if (this.wss) {
      this.wss.close()
      this.wss = null
      this.authenticatedClients = new WeakSet<WebSocket>()
      this.logger.info('WebSocket服务已停止', reason)
    }
  }
}
