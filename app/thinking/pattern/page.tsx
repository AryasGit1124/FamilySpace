import { ensureModuleTaskIdBySubjectName } from '@/lib/supabase-queries'
import { PatternGame } from './pattern-client'

export const dynamic = 'force-dynamic'

/** 找规律游戏：打卡写入「思维乐园」模块任务 */
export default async function ThinkingPatternPage() {
  const taskId = await ensureModuleTaskIdBySubjectName({
    subjectName: '思维',
    title: '思维乐园',
    gameRoute: '/thinking',
  }).catch((err: unknown) => {
    console.error('[ThinkingPattern] 获取打卡任务失败:', err)
    return null
  })

  return <PatternGame taskId={taskId} />
}
