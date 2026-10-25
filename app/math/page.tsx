import Link from 'next/link'
import { Hash } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { fetchSubjectIdByName } from '@/lib/supabase-queries'

export const dynamic = 'force-dynamic'

/** 数学乐园：唯一的每日闯关打卡入口 */
export default async function MathHubPage() {
  const subjectId = await fetchSubjectIdByName('数学').catch((err: unknown) => {
    console.error('[MathHub] 获取数学学科失败:', err)
    return null
  })

  return (
    <>
      <PageHeader
        title="数学乐园"
        subtitle="每天一次闯关，答对题目领星星"
        backHref={subjectId ? `/subject/${subjectId}` : undefined}
        backLabel="返回数学"
      />
      <div className="px-5 pb-6">
        <Link
          href="/math/daily"
          className="flex items-center gap-4 rounded-3xl border-2 border-primary/30 bg-primary/5 p-6 transition-all hover:bg-primary/10 hover:shadow-md"
        >
          <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Hash className="size-8" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-xl font-bold">🔢 每日数学闯关</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              点数 · 匹配 · 比大小 · 加减法，一轮完成今日打卡
            </span>
          </span>
        </Link>
      </div>
    </>
  )
}
