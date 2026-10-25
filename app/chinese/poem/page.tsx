import { fetchMasteredChars, fetchPoems, fetchSubjectIdByName } from '@/lib/supabase-queries'
import { todayDateKey } from '@/lib/supabase-adapter'
import { PoemClient } from './poem-client'

export const dynamic = 'force-dynamic'

/** 古诗诵读：按年龄 + 已认识汉字每日推荐，支持朗读 / 排序 / 填空 */
export default async function PoemPage() {
  const [poems, knownChars, subjectId] = await Promise.all([
    fetchPoems().catch((err: unknown) => {
      console.error('[Poem] 加载古诗失败:', err)
      return []
    }),
    fetchMasteredChars().catch((err: unknown) => {
      console.error('[Poem] 加载已认识汉字失败:', err)
      return []
    }),
    fetchSubjectIdByName('语文').catch((err: unknown) => {
      console.error('[Poem] 获取语文学科失败:', err)
      return null
    }),
  ])

  return (
    <PoemClient
      poems={poems}
      knownChars={knownChars}
      todayKey={todayDateKey()}
      backHref={subjectId ? `/subject/${subjectId}` : undefined}
    />
  )
}
