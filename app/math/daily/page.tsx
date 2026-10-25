import { ensureModuleTaskIdBySubjectName, fetchSubjectIdByName } from '@/lib/supabase-queries'
import { MathDailyClient } from './daily-client'

export const dynamic = 'force-dynamic'

/** 每日数学闯关：点数 → 匹配 → 比大小 → 加减法，4 步走完统一打卡 */
export default async function MathDailyPage() {
  const [taskId, subjectId] = await Promise.all([
    ensureModuleTaskIdBySubjectName({
      subjectName: '数学',
      title: '数学乐园',
      gameRoute: '/math/daily',
    }).catch((err: unknown) => {
      console.error('[MathDaily] 获取打卡任务失败:', err)
      return null
    }),
    fetchSubjectIdByName('数学').catch((err: unknown) => {
      console.error('[MathDaily] 获取数学学科失败:', err)
      return null
    }),
  ])

  return <MathDailyClient taskId={taskId} backHref={subjectId ? `/subject/${subjectId}` : undefined} />
}
