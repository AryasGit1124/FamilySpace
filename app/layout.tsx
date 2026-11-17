import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { LayoutWrapper } from '@/app/components/LayoutWrapper'
import { AppStateProvider } from '@/components/app-state-provider'
import { AuthProvider } from '@/components/auth-provider'
import { BottomTabBar } from '@/components/bottom-tab-bar'
import './globals.css'

export const metadata: Metadata = {
  title: '学习打卡',
  description: '孩子每日学习打卡：线下课程与线上/线下任务一目了然',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <head>
        {/*
          部署后旧页面缓存仍引用上一版 chunk，会报 ChunkLoadError / 404 导致整页 JS 失效。
          这里在 HTML 里内联一段兜底脚本：一旦捕获到 chunk 加载失败就自动刷新一次（30 秒内只刷一次，避免死循环）。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var k='chunk-reload-at';function r(){var last=+(sessionStorage.getItem(k)||0);if(Date.now()-last<30000)return;sessionStorage.setItem(k,String(Date.now()));location.reload();}function m(t){return /ChunkLoadError|Loading chunk |Failed to fetch dynamically imported module|Importing a module script failed/i.test(t||'');}window.addEventListener('error',function(e){var t=(e&&e.message)||'';var el=e&&e.target;if(el&&el.tagName==='SCRIPT'&&el.src)t+=' chunk';if(m(t))r();},true);window.addEventListener('unhandledrejection',function(e){var x=e&&e.reason;if(m(((x&&x.name)||'')+' '+((x&&x.message)||'')))r();});}catch(_){}})();",
          }}
        />
      </head>
      <body className="min-h-screen bg-gray-50 antialiased">
        <AuthProvider>
          <AppStateProvider>
            <LayoutWrapper>
              {/* 手机端占满；iPad 竖屏居中留白，横屏（lg）放宽到 max-w-7xl 减少两侧空白 */}
              <main className="mx-auto w-full max-w-5xl overflow-x-clip md:px-6 lg:max-w-7xl lg:px-8">{children}</main>
            </LayoutWrapper>
            <BottomTabBar />
          </AppStateProvider>
        </AuthProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
