import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export function PageHeader({
  title,
  subtitle,
  action,
  backHref,
  backLabel,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  /** 子页面返回上级（如学科子模块返回学科主页） */
  backHref?: string
  backLabel?: string
}) {
  return (
    <header className="flex items-end justify-between gap-4 px-5 pt-8 pb-4">
      <div>
        {backHref && (
          <Link
            href={backHref}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {backLabel ?? '返回'}
          </Link>
        )}
        {subtitle && <p className="text-base font-medium text-muted-foreground" suppressHydrationWarning>{subtitle}</p>}
        <h1 className="text-2xl font-bold text-balance">{title}</h1>
      </div>
      {action}
    </header>
  )
}
