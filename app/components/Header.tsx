'use client'

import { LogOut, Menu } from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { StarBadge } from './StarBadge'

/** 顶部导航头：左侧 App 标题，右侧星星计数 + 菜单/退出按钮 */
export function Header({ onMenuOpen }: { onMenuOpen: () => void }) {
  const { role, viewAsChild, setViewAsChild, signOut } = useAuth()
  const isParent = role === 'parent' && !viewAsChild
  const isRealChild = role === 'child' && !viewAsChild

  return (
    <header className="fixed top-0 z-30 flex h-16 w-full items-center bg-white/80 px-4 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-md items-center justify-between md:max-w-3xl lg:max-w-6xl">
        <span className="text-lg font-bold">我的学习台</span>
        <div className="flex items-center gap-2">
          <StarBadge />
          {viewAsChild && (
            <button
              type="button"
              onClick={() => setViewAsChild(false)}
              className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700 transition-colors active:bg-amber-200"
            >
              返回家长端
            </button>
          )}
          {isRealChild && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('确定要退出登录吗？')) void signOut()
              }}
              aria-label="退出登录"
              className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted active:bg-muted/80"
            >
              <LogOut className="size-5" aria-hidden="true" />
            </button>
          )}
          {isParent && (
            <button
              type="button"
              onClick={onMenuOpen}
              aria-label="打开菜单"
              className="flex size-10 items-center justify-center rounded-xl transition-colors hover:bg-muted active:bg-muted/80"
            >
              <Menu className="size-6" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
