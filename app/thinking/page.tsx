import Link from 'next/link'
import { LayoutGrid, Puzzle } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { fetchSubjectIdByName } from '@/lib/supabase-queries'

export const dynamic = 'force-dynamic'

/** 思维乐园：纯前端思维训练小游戏入口 */
const entries = [
  {
    href: '/thinking/memory',
    icon: LayoutGrid,
    title: '记忆翻牌',
    desc: '16 张卡片，凭记忆找出相同的图案',
    color: 'bg-purple-500/10 text-purple-600',
  },
  {
    href: '/thinking/pattern',
    icon: Puzzle,
    title: '找规律',
    desc: '看看图形的排列规律，猜下一个',
    color: 'bg-violet-500/10 text-violet-600',
  },
] as const

export default async function ThinkingHubPage() {
  const subjectId = await fetchSubjectIdByName('思维').catch((err: unknown) => {
    console.error('[ThinkingHub] 获取思维学科失败:', err)
    return null
  })

  return (
    <>
      <PageHeader
        title="思维乐园"
        subtitle="开动小脑筋，全部配对成功就能打卡"
        backHref={subjectId ? `/subject/${subjectId}` : undefined}
        backLabel="返回思维"
      />
      <div className="grid grid-cols-2 gap-3 px-5 pb-6">
        {entries.map((entry) => {
          const Icon = entry.icon
          return (
            <Link key={entry.title} href={entry.href} className="block">
              <div className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/50">
                <span className={`flex size-10 items-center justify-center rounded-xl ${entry.color}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold">{entry.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{entry.desc}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}
