import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 px-5 pt-8 pb-4">
      <div>
        {subtitle && <p className="text-sm text-muted-foreground" suppressHydrationWarning>{subtitle}</p>}
        <h1 className="text-2xl font-bold text-balance">{title}</h1>
      </div>
      {action}
    </header>
  )
}
