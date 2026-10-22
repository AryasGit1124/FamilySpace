'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, Settings, type LucideIcon } from 'lucide-react'
import { useAppState } from '@/components/app-state-provider'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

type Tab = { href: string; label: string; icon: LucideIcon }

export function BottomTabBar() {
  const pathname = usePathname()
  const { subjects } = useAppState()

  const tabs: Tab[] = [
    { href: '/', label: '今日', icon: CalendarCheck },
    ...subjects
      .filter((s) => s.showInTab)
      .map((s) => ({ href: `/subject/${s.id}`, label: s.name, icon: getSubjectMeta(s.id).icon })),
    { href: '/settings', label: '设置', icon: Settings },
  ]

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-10 items-center justify-center rounded-full transition-colors',
                    active && 'bg-primary/10',
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
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
