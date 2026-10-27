/**
 * 任务展示名解析。
 * 有些模块使用未入库的硬编码 task_id，无法通过 tasks 表 join 拿到标题，
 * 这里统一用一张字典兜底，供统计筛选、星星流水等场景共用。
 */

/** 未入库的硬编码 task_id → 展示名 */
export const LEGACY_TASK_NAMES: Record<string, string> = {
  poem: '古诗诵读',
  literacy_daily: '每日识字',
}

/** 任务展示名：tasks.title 优先，其次硬编码字典，最后用 task_id 兜底 */
export function resolveTaskName(taskId: string | null | undefined, title?: string | null): string {
  const name = title?.trim()
  if (name) return name
  const id = taskId?.trim()
  if (!id) return '打卡任务'
  return LEGACY_TASK_NAMES[id] ?? id
}
