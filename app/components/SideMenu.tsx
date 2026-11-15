'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  Baby,
  BarChart3,
  Camera,
  ChevronDown,
  ClipboardCheck,
  Home,
  Inbox,
  Library,
  LogOut,
  Package,
  PieChart,
  Settings,
  SlidersHorizontal,
  UploadCloud,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { roleLabel } from '@/lib/family'
import { fetchPendingCheckinCount } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type MenuItem = { href: string; label: string; icon: LucideIcon; sub?: boolean }

const MENU_ITEMS: MenuItem[] = [
  { href: '/', label: '返回学习台 / 今日', icon: Home },
  { href: '/parent/approvals', label: '审核中心', icon: ClipboardCheck },
  { href: '/growth', label: '成长档案', icon: Camera },
  { href: '/stats', label: '学习统计', icon: BarChart3 },
]

/** 家庭账单子菜单：导入 → 规则 → 统计 */
const BILL_ITEMS: MenuItem[] = [
  { href: '/bills/import', label: '账单导入', icon: Inbox },
  { href: '/bills/rules', label: '规则定义', icon: SlidersHorizontal },
  { href: '/bills/stats', label: '数据统计', icon: PieChart },
]

const TAIL_ITEMS: MenuItem[] = [
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
  const pathname = usePathname()
  const billsActive = pathname.startsWith('/bills')
  /** 家庭账单子菜单：进入账单相关页面时自动展开 */
  const [billsOpen, setBillsOpen] = useState(billsActive)

  useEffect(() => {
    if (billsActive) setBillsOpen(true)
  }, [billsActive])

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

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon
    const active = pathname === item.href
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 rounded-lg font-medium transition-colors',
          item.sub
            ? 'py-2.5 pl-10 pr-3 text-sm'
            : 'px-3 py-3 text-[15px]',
          active
            ? 'bg-muted text-foreground'
            : item.sub
              ? 'text-muted-foreground hover:bg-muted/70'
              : 'text-slate-700 hover:bg-muted/70 active:bg-muted',
        )}
      >
        <Icon
          className={cn('size-5 shrink-0', active ? 'text-primary' : 'text-slate-400')}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.href === '/parent/approvals' && pendingCount > 0 && (
          <span className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </Link>
    )
  }

  return (
    <>
      {/* 遮罩层：仅在菜单打开时渲染，点击关闭抽屉。
          z-60 高于底部 Tab（z-50），打开抽屉时 Tab 只是被遮住、不会消失；
          抽屉本体 z-70 位于遮罩之上。 */}
      {isOpen && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-[60] bg-black/50"
        />
      )}
      {/* 抽屉本体：关闭时同时禁用指针事件，避免移动端不可见的抽屉拦截点击 */}
      <aside
        aria-hidden={!isOpen}
        className={cn(
          'fixed left-0 top-0 z-[70] flex h-full w-[85%] flex-col bg-white shadow-xl transition-transform duration-300 sm:w-72 lg:w-80',
          isOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <span className="text-lg font-bold">我的学习台</span>
          {profile && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              {roleLabel(profile.display_name, profile.role)}
            </span>
          )}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2.5" aria-label="主菜单">
          {MENU_ITEMS.map(renderItem)}

          <div className="my-1 h-px shrink-0 bg-border" aria-hidden="true" />

          {/* 家庭账单：可展开子菜单（导入 / 规则 / 统计） */}
          <button
            type="button"
            onClick={() => setBillsOpen((prev) => !prev)}
            aria-expanded={billsOpen}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors',
              billsActive ? 'bg-muted text-foreground' : 'text-slate-700 hover:bg-muted/70 active:bg-muted',
            )}
          >
            <Wallet
              className={cn('size-5 shrink-0', billsActive ? 'text-primary' : 'text-slate-400')}
              aria-hidden="true"
            />
            <span className="flex-1 truncate text-left">家庭账单</span>
            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-slate-400 transition-transform',
                billsOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          {billsOpen && (
            <div className="flex flex-col gap-0.5">
              {BILL_ITEMS.map((item) => {
                const Icon = item.icon
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 rounded-lg py-2.5 pl-10 pr-3 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted/70',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          )}

          <div className="my-1 h-px shrink-0 bg-border" aria-hidden="true" />

          {TAIL_ITEMS.map(renderItem)}

          <div className="my-1 h-px shrink-0 bg-border" aria-hidden="true" />

          <button
            type="button"
            onClick={() => {
              onClose()
              setViewAsChild(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium text-amber-700 transition-colors hover:bg-amber-50 active:bg-amber-100"
          >
            <Baby className="size-5 shrink-0" aria-hidden="true" />
            切换到孩子端
          </button>
          <button
            type="button"
            onClick={() => {
              onClose()
              void signOut()
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 active:bg-muted"
          >
            <LogOut className="size-5 shrink-0" aria-hidden="true" />
            退出登录
          </button>
        </nav>
      </aside>
    </>
  )
}
