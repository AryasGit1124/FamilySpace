'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CalendarCheck, Gift, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { fetchSubjects } from '@/lib/supabase-queries'
import { getSubjectMeta } from '@/lib/subject-meta'
import { SUBJECT_MODULES } from '@/lib/subject-modules'
import { cn } from '@/lib/utils'

type Tab = {
  href: string
  label: string
  icon: LucideIcon
  /** 自定义激活判定；不传则按 href 前缀匹配 */
  isActive?: (pathname: string) => boolean
}

/** 从当前路径推断所在学科（学科页或该学科的模块页） */
function getActiveSubject(
  pathname: string,
  subjects: { id: string; name: string }[],
): { id: string; name: string } | null {
  const subjectMatch = pathname.match(/^\/subject\/([^/]+)/)
  if (subjectMatch) return subjects.find((s) => s.id === subjectMatch[1]) ?? null

  const mod = SUBJECT_MODULES.find((m) => pathname.startsWith(m.gameRoute))
  if (mod) return subjects.find((s) => s.name === mod.subjectName) ?? null
  return null
}

/**
 * 动态底部导航：固定「今日」+ Supabase subjects 表（show_in_tab=true，按 sort_order 排序）。
 * 挂载 / pathname 变化 / 收到 subjects-changed 事件时 refetch ——
 * 学科设置页开关切换后无需跳转页面，底部 Tab 立即联动。
 */
export function BottomTabBar() {
  const pathname = usePathname()
  const { role } = useAuth()
  const [tabSubjects, setTabSubjects] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    try {
      const rows = await fetchSubjects()
      setTabSubjects(
        rows
          .filter((s) => s.show_in_tab)
          .map((s) => ({ id: s.id, name: s.name })),
      )
    } catch (err) {
      // Supabase 未初始化 / 查询失败 —— 不阻塞 UI，只是学科 tab 不显示
      console.warn('[BottomTabBar] 加载失败:', err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, pathname])

  useEffect(() => {
    const onSubjectsChanged = () => {
      void load()
    }
    window.addEventListener('subjects-changed', onSubjectsChanged)
    return () => window.removeEventListener('subjects-changed', onSubjectsChanged)
  }, [load])

  const isChild = role === 'child'
  const activeSubject = useMemo(() => getActiveSubject(pathname, tabSubjects), [pathname, tabSubjects])

  // 登录页不显示底部导航（必须放在所有 hooks 之后，否则路由切换时 hooks 数量不一致会崩溃）
  if (pathname === '/login') return null

  // 孩子端：今日 + 当前学科（在模块/学科页时）+ 星星商城；家长端：今日 + 全部学科
  const tabs: Tab[] = isChild
    ? [
        { href: '/', label: '今日', icon: CalendarCheck, isActive: (p) => p === '/' },
        ...(activeSubject
          ? [
              {
                href: `/subject/${activeSubject.id}`,
                label: activeSubject.name,
                icon: getSubjectMeta(activeSubject.id).icon,
                isActive: (p: string) =>
                  p.startsWith(`/subject/${activeSubject.id}`) ||
                  SUBJECT_MODULES.filter((m) => m.subjectName === activeSubject.name).some((m) =>
                    p.startsWith(m.gameRoute),
                  ),
              } as Tab,
            ]
          : []),
        { href: '/store', label: '星星商城', icon: Gift, isActive: (p) => p.startsWith('/store') },
      ]
    : [
        { href: '/', label: '今日', icon: CalendarCheck, isActive: (p) => p === '/' },
        ...tabSubjects.map((s) => ({
          href: `/subject/${s.id}`,
          label: s.name,
          icon: getSubjectMeta(s.id).icon,
          isActive: (p: string) => p.startsWith(`/subject/${s.id}`),
        })),
      ]

  return (
    <nav
      aria-label="主导航"
      className="fixed bottom-0 z-30 h-20 w-full border-t bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-full max-w-md">
        {tabs.map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive ? isActive(pathname) : pathname.startsWith(href)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                    active && 'bg-primary/10',
                  )}
                >
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
