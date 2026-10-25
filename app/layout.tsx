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
      <body className="min-h-screen bg-gray-50 antialiased">
        <AuthProvider>
          <AppStateProvider>
            <LayoutWrapper>
              <main className="mx-auto w-full max-w-md">{children}</main>
            </LayoutWrapper>
            <BottomTabBar />
          </AppStateProvider>
        </AuthProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
