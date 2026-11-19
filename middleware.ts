import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/** 从 base64 / base64url 解出 UTF-8 字符串（middleware 跑在 Edge，没有 Buffer） */
function decodeBase64(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

type TokenState = {
  /** 是否带有 Supabase 会话 cookie */
  hasToken: boolean
  /** access_token 的过期时间（毫秒）；解析失败为 null */
  expiresAt: number | null
}

/**
 * 本地解析会话 cookie 里 access_token 的 exp，用于判断是否需要联网续期。
 * @supabase/ssr 会把会话写成 sb-<ref>-auth-token（大 session 会分片 .0/.1…），
 * 值可能是 base64- 前缀的编码串，也可能是 URL 编码的 JSON。
 */
function readTokenState(request: NextRequest): TokenState {
  const cookies = request.cookies
    .getAll()
    .filter((cookie) => /-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (cookies.length === 0) return { hasToken: false, expiresAt: null }

  let raw = cookies.map((cookie) => cookie.value).join('')
  if (!raw) return { hasToken: false, expiresAt: null }

  try {
    raw = decodeURIComponent(raw)
  } catch {
    // 不是 URL 编码就按原样处理
  }

  try {
    if (raw.startsWith('base64-')) raw = decodeBase64(raw.slice('base64-'.length))
    const parsed: unknown = JSON.parse(raw)
    const session = Array.isArray(parsed) ? parsed[0] : parsed
    const token = (session as { access_token?: unknown } | null)?.access_token
    if (typeof token !== 'string') return { hasToken: true, expiresAt: null }
    const payload = token.split('.')[1]
    if (!payload) return { hasToken: true, expiresAt: null }
    const claims = JSON.parse(decodeBase64(payload)) as { exp?: unknown }
    return {
      hasToken: true,
      expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : null,
    }
  } catch {
    // 解析失败时保守地走一次 getUser 校验
    return { hasToken: true, expiresAt: null }
  }
}

/**
 * 刷新 Supabase 登录态 cookie：
 * 浏览器端客户端把会话存在 cookie 里，token 过期后由这里续期并写回，
 * 保证服务端渲染（Server Component）拿到的始终是有效用户身份，
 * 开启 RLS 后 auth.uid() 才不会失效。
 *
 * 性能：不再每次页面跳转都 await auth.getUser()（那是一次额外的外部网络往返）。
 * 先本地解析 cookie 里 access_token 的 exp：
 *   - 没有 token      → 直接放行（详细鉴权交给页面组件 / AuthProvider）
 *   - token 仍在有效期内 → 直接放行，不发任何网络请求
 *   - token 已过期 / 临期 / 解析失败 → 才调用 getUser 续期
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const token = readTokenState(request)
  if (!token.hasToken) return response
  // 留 60 秒余量，避免请求还没到 Supabase 就过期
  if (token.expiresAt !== null && token.expiresAt - Date.now() > 60_000) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // 只有 token 过期 / 临期时才联网续期。
  // 网络异常（如手机访问时 Supabase 暂时不可达）只跳过续期，绝不能让整页挂起/报错。
  try {
    await supabase.auth.getUser()
  } catch (err) {
    console.warn('[middleware] 刷新登录态失败，跳过本次续期:', err)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|ffmpeg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|woff2|ttf)$).*)',
  ],
}
