import { fetchLiteracyTaskId, fetchSubjectIdByName } from '@/lib/supabase-queries'
import { DailyClient } from './daily-client'

export const dynamic = 'force-dynamic'

export default async function LiteracyDailyPage() {
  // 「确认打卡」写到「识字」这条线上任务上；subjectId 用于顶部「返回语文主页」
  const [taskId, subjectId] = await Promise.all([
    fetchLiteracyTaskId().catch((err: unknown) => {
      console.error('[LiteracyDaily] 查询识字任务失败:', err)
      return null
    }),
    fetchSubjectIdByName('语文').catch((err: unknown) => {
      console.error('[LiteracyDaily] 获取语文学科失败:', err)
      return null
    }),
  ])

  return <DailyClient taskId={taskId} backHref={subjectId ? `/subject/${subjectId}` : undefined} />
}
