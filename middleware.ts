import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * 刷新 Supabase 登录态 cookie：
 * 浏览器端客户端把会话存在 cookie 里，token 过期后由这里续期并写回，
 * 保证服务端渲染（Server Component）拿到的始终是有效用户身份，
 * 开启 RLS 后 auth.uid() 才不会失效。
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

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

  // 触发一次 getUser，使过期的 access token 在这里被刷新
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|ffmpeg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|woff2|ttf)$).*)',
  ],
}
