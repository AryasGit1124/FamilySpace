import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] 缺少环境变量 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY，请在 .env.local 中配置',
  )
}

/**
 * 服务端/浏览器到 Supabase 的连接偶发 ECONNRESET（undici 复用的 keep-alive 连接被对端关闭），
 * 表现为 `TypeError: fetch failed` + `cause.code = 'ECONNRESET'`，会让整页数据凭空消失。
 * 这里对幂等请求（GET/HEAD）自动重试，写请求不重试，避免重复插入。
 */
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'])
const RETRYABLE_METHODS = new Set(['GET', 'HEAD'])

function errorCode(err: unknown): string | null {
  let current: unknown = err
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

function describeNetError(err: unknown): string {
  const code = errorCode(err)
  const message = err instanceof Error ? err.message : String(err)
  return code ? `${message} (${code})` : message
}

/** 对 Supabase 的 GET/HEAD 请求自动重试网络层错误 */
async function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const attempts = 3
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Request 的 body 只能读一次，重试前克隆一份原始请求
      const request = input instanceof Request ? input.clone() : input
      return await fetch(request, init)
    } catch (err) {
      lastError = err
      const retryable = RETRYABLE_METHODS.has(method) && RETRYABLE_CODES.has(errorCode(err) ?? '')
      if (attempt >= attempts || !retryable) break
      const wait = 200 * attempt
      console.warn(`[supabase] ${method} 第 ${attempt} 次请求失败，${wait}ms 后重试：${describeNetError(err)}`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  throw lastError
}

/**
 * 浏览器端客户端：会话写入 cookie 而不是 localStorage，
 * 这样服务端渲染（Server Component）能读到同一份登录态，
 * 开启 RLS 后 auth.uid() 在服务端同样生效。
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey && typeof window !== 'undefined'
    ? createBrowserClient(supabaseUrl, supabaseAnonKey, { global: { fetch: retryingFetch } })
    : null

/**
 * 统一获取 Supabase 客户端：
 * - 浏览器端复用上面的单例（带用户身份，authenticated 角色）
 * - 服务端按当前请求的 cookie 创建客户端（同样带用户身份）
 * 服务端必须 await，因为在 RSC 中读取 cookies() 是异步的。
 */
export async function requireSupabase(): Promise<SupabaseClient> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase 客户端未初始化，请检查 .env.local 配置')
  }

  if (typeof window !== 'undefined') {
    if (!supabase) throw new Error('Supabase 客户端未初始化，请检查 .env.local 配置')
    return supabase
  }

  // 服务端分支：动态 import，避免 next/headers 被打进浏览器包
  const { cookies } = await import('next/headers')
  const { createServerClient } = await import('@supabase/ssr')
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: retryingFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component 渲染期间不允许写 cookie，续期交给 middleware 处理
        }
      },
    },
  })
}
