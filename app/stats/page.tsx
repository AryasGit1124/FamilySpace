import {
  fetchCheckinTaskRecords,
  fetchStarLedger,
  fetchSubjectCheckinCounts,
  fetchTasksWithSubjects,
} from '@/lib/supabase-queries'
import { StatsView } from './stats-view'

/** 统计页每次进入重新拉取数据 */
export const dynamic = 'force-dynamic'

export default async function StatsPage() {
  const [checkinRecords, subjectCounts, tasks, starLedger] = await Promise.all([
    // 拉满一年，支撑「本年」时间范围的统计
    fetchCheckinTaskRecords(365).catch((err: unknown) => {
      console.error('[StatsPage] 读取打卡记录失败:', err)
      return [] as { date: string; taskId: string | null }[]
    }),
    fetchSubjectCheckinCounts().catch((err: unknown) => {
      console.error('[StatsPage] 读取学科分布失败:', err)
      return []
    }),
    fetchTasksWithSubjects().catch((err: unknown) => {
      console.error('[StatsPage] 读取任务列表失败:', err)
      return []
    }),
    // 流水条数放大，保证「累计获得」按时间/课程过滤后的汇总足够准确
    fetchStarLedger(500).catch((err: unknown) => {
      console.error('[StatsPage] 读取星星流水失败:', err)
      return []
    }),
  ])

  // 基于 task_id 用 Map 严格去重，避免课程筛选下拉出现重复选项
  const taskMap = new Map<string, string>()
  for (const t of tasks ?? []) {
    const row = t as { id?: unknown; title?: unknown }
    const id = String(row.id ?? '').trim()
    if (!id || taskMap.has(id)) continue
    taskMap.set(id, String(row.title ?? '未命名任务'))
  }
  const taskOptions = Array.from(taskMap, ([id, name]) => ({ id, name }))

  return (
    <StatsView
      checkinRecords={checkinRecords}
      tasks={taskOptions}
      subjectCounts={subjectCounts}
      starLedger={starLedger.map((r) => ({
        id: r.id,
        amount: r.amount,
        reason: r.reason,
        taskName: r.task_name,
        createdAt: r.created_at,
      }))}
    />
  )
}
