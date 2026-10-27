'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  Baby,
  BarChart3,
  ClipboardCheck,
  Library,
  LogOut,
  Package,
  Settings,
  UploadCloud,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { roleLabel } from '@/lib/family'
import { fetchPendingCheckinCount } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type MenuItem = { href: string; label: string; icon: LucideIcon; sub?: boolean }

const MENU_ITEMS: MenuItem[] = [
  { href: '/parent/approvals', label: '打卡审核', icon: ClipboardCheck },
  { href: '/stats', label: '学习统计', icon: BarChart3 },
  { href: '/upload', label: '上传资料', icon: UploadCloud },
  { href: '/library', label: '资料库', icon: Library },
  { href: '/settings', label: '设置', icon: Settings },
  { href: '/settings/store-config', label: '商城配置', icon: Package, sub: true },
  { href: '/settings/members', label: '用户管理', icon: Users, sub: true },
]

/** 左侧抽屉菜单：滑入滑出动画 + 遮罩关闭；手机 w-[85%]，iPad 宽屏固定 w-80 */
export function SideMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { signOut, profile, setViewAsChild } = useAuth()
  /** 待审核打卡数量：侧边栏「打卡审核」红点 */
  const [pendingCount, setPendingCount] = useState(0)

  const loadPendingCount = useCallback(async () => {
    try {
      setPendingCount(await fetchPendingCheckinCount())
    } catch (err) {
      console.warn('[SideMenu] 读取待审核数量失败:', err)
    }
  }, [])

  // 打开抽屉时刷新一次，保证红点是最新的
  useEffect(() => {
    if (isOpen) void loadPendingCount()
  }, [isOpen, loadPendingCount])

  // 孩子提交打卡 / 家长审核后立即刷新红点
  useEffect(() => {
    const onChange = () => {
      void loadPendingCount()
    }
    window.addEventListener('checkins-changed', onChange)
    return () => window.removeEventListener('checkins-changed', onChange)
  }, [loadPendingCount])

  return (
    <>
      {/* 遮罩层：点击关闭抽屉 */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      {/* 抽屉本体 */}
      <aside
        aria-hidden={!isOpen}
        className={cn(
          'fixed left-0 top-0 z-50 h-full w-[85%] bg-white shadow-xl transition-transform duration-300 sm:w-72 lg:w-80',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b px-5">
          <span className="text-lg font-bold">我的学习台</span>
          {profile && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
              {roleLabel(profile.display_name, profile.role)}
            </span>
          )}
        </div>
        <nav className="flex flex-col gap-1 p-3" aria-label="主菜单">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center rounded-xl font-medium transition-colors hover:bg-muted active:bg-muted/80',
                  item.sub
                    ? 'ml-8 gap-3 px-3 py-3 text-sm text-muted-foreground'
                    : 'gap-4 px-4 py-4 text-base',
                )}
              >
                <Icon className={item.sub ? 'size-5 text-primary' : 'size-7 text-primary'} aria-hidden="true" />
                {item.label}
                {item.href === '/parent/approvals' && pendingCount > 0 && (
                  <span className="ml-auto flex min-w-6 items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => {
              onClose()
              setViewAsChild(true)
            }}
            className="mt-2 flex items-center gap-4 rounded-xl bg-amber-50 px-4 py-4 text-base font-medium text-amber-700 transition-colors hover:bg-amber-100 active:bg-amber-200"
          >
            <Baby className="size-7" aria-hidden="true" />
            切换到孩子端
          </button>
          <button
            type="button"
            onClick={() => {
              onClose()
              void signOut()
            }}
            className="mt-2 flex items-center gap-4 rounded-xl px-4 py-4 text-base font-medium text-muted-foreground transition-colors hover:bg-muted active:bg-muted/80"
          >
            <LogOut className="size-7" aria-hidden="true" />
            退出登录
          </button>
        </nav>
      </aside>
    </>
  )
}
