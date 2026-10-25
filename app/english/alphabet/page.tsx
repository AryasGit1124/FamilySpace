import Link from 'next/link'
import { Ear, Search } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { fetchSubjectIdByName } from '@/lib/supabase-queries'

export const dynamic = 'force-dynamic'

/** 字母乐园：两个字母小游戏入口 */
const entries = [
  {
    href: '/english/alphabet/hide',
    icon: Search,
    title: '大小写捉迷藏',
    desc: '看大写字母，找出对应的小写',
    color: 'bg-teal-500/10 text-teal-600',
  },
  {
    href: '/english/alphabet/listen',
    icon: Ear,
    title: '听音选字母',
    desc: '听发音，选出正确的字母',
    color: 'bg-sky-500/10 text-sky-600',
  },
] as const

export default async function AlphabetHubPage() {
  const subjectId = await fetchSubjectIdByName('英语').catch((err: unknown) => {
    console.error('[AlphabetHub] 获取英语学科失败:', err)
    return null
  })

  return (
    <>
      <PageHeader
        title="字母乐园"
        subtitle="听一听，认一认字母"
        backHref={subjectId ? `/subject/${subjectId}` : undefined}
        backLabel="返回英语"
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
