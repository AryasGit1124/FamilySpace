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
 * 浏览器端客户端：会话写入 cookie 而不是 localStorage，
 * 这样服务端渲染（Server Component）能读到同一份登录态，
 * 开启 RLS 后 auth.uid() 在服务端同样生效。
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey && typeof window !== 'undefined'
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
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
