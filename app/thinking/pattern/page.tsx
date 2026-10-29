import {
  ensureModuleTaskIdBySubjectName,
  fetchKnowledgeMastery,
} from '@/lib/supabase-queries'
import { PatternGame } from './pattern-client'

export const dynamic = 'force-dynamic'

/** 找规律游戏：打卡写入「思维乐园」模块任务 */
export default async function ThinkingPatternPage() {
  const [taskId, knowledge] = await Promise.all([
    ensureModuleTaskIdBySubjectName({
      subjectName: '思维',
      title: '思维乐园',
      gameRoute: '/thinking',
    }).catch((err: unknown) => {
      console.error('[ThinkingPattern] 获取打卡任务失败:', err)
      return null
    }),
    // 知识点掌握度：决定本局难度与是否解锁下一档
    fetchKnowledgeMastery('思维').catch((err: unknown) => {
      console.error('[ThinkingPattern] 读取知识点掌握度失败:', err)
      return []
    }),
  ])

  return <PatternGame taskId={taskId} knowledge={knowledge} />
}
