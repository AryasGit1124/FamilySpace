import {
  ensureModuleTaskIdBySubjectName,
  fetchLiteracyTaskId,
  fetchSubjectIdByName,
} from '@/lib/supabase-queries'
import { DailyClient } from './daily-client'

export const dynamic = 'force-dynamic'

/** 识字模块在学科页登记的固定标题与路由（ensureModuleTask 的幂等键） */
const MODULE_TITLE = '识字乐园'
const MODULE_ROUTE = '/chinese/literacy/daily'

export default async function LiteracyDailyPage() {
  // 打卡必须落在一个真实的 tasks.id 上：
  // 1. 先找历史遗留的「识字」任务
  // 2. 找不到就按学科页的标题「识字乐园」幂等补建一条（并发安全，重复条目会被自动清理）
  // 否则 checkins.task_id 为空，故事读完也无法打卡
  const [taskId, subjectId] = await Promise.all([
    (async () => {
      try {
        const legacy = await fetchLiteracyTaskId()
        if (legacy) return legacy
        return await ensureModuleTaskIdBySubjectName({
          subjectName: '语文',
          title: MODULE_TITLE,
          gameRoute: MODULE_ROUTE,
        })
      } catch (err) {
        console.error('[LiteracyDaily] 查询/补建识字任务失败:', err)
        return null
      }
    })(),
    fetchSubjectIdByName('语文').catch((err: unknown) => {
      console.error('[LiteracyDaily] 获取语文学科失败:', err)
      return null
    }),
  ])

  return <DailyClient taskId={taskId} backHref={subjectId ? `/subject/${subjectId}` : undefined} />
}
