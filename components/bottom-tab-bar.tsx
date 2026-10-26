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
  const { role, profile } = useAuth()
  const [tabSubjects, setTabSubjects] = useState<{ id: string; name: string }[]>([])
  /** 家庭 id：登录信息异步加载完成前为 undefined，拿到后触发一次重新拉取 */
  const familyId = profile?.family_id ?? null

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

  // 首次挂载时 AuthProvider 可能还没拿到 profile，此时家庭上下文为空、
  // 查询会因 RLS 返回空数组；等 familyId 就绪后必须再拉一次，否则 Tab 永远只剩「今日」
  useEffect(() => {
    void load()
  }, [load, pathname, familyId, role])

  useEffect(() => {
    const onSubjectsChanged = () => {
      void load()
    }
    window.addEventListener('subjects-changed', onSubjectsChanged)
    return () => window.removeEventListener('subjects-changed', onSubjectsChanged)
  }, [load])

  // 角色还没加载出来时按家长端渲染，避免登录后 Tab 只剩「今日」看起来像坏了
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
      className="fixed bottom-0 z-50 w-full border-t bg-white pb-[env(safe-area-inset-bottom)]"
    >
      {/* 手机端等分铺满；iPad 端（md+）收窄居中 + 固定间距，Tab 不再散落到屏幕两端。
          高度放在 ul 上：避开 iPhone 底部安全区把 h-20 吃掉一半导致文字被裁剪 */}
      <ul className="mx-auto flex h-20 w-full max-w-md items-center justify-around md:gap-4 md:max-w-2xl">
        {tabs.map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive ? isActive(pathname) : pathname.startsWith(href)
          return (
            <li key={href} className="flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-1 px-2 text-xs font-medium transition-colors md:px-4 md:text-sm',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full transition-colors md:size-9',
                    active && 'bg-primary/10',
                  )}
                >
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <span className="whitespace-nowrap">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
