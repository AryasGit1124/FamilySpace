import {
  ensureModuleTaskIdBySubjectName,
  fetchKnowledgeMastery,
} from '@/lib/supabase-queries'
import { MemoryGame } from './memory-client'

export const dynamic = 'force-dynamic'

/** 记忆翻牌：打卡写入「思维乐园」模块任务 */
export default async function MemoryPage() {
  const [taskId, knowledge] = await Promise.all([
    ensureModuleTaskIdBySubjectName({
      subjectName: '思维',
      title: '思维乐园',
      gameRoute: '/thinking',
    }).catch((err: unknown) => {
      console.error('[Memory] 获取打卡任务失败:', err)
      return null
    }),
    // 知识点掌握度：决定本局难度，表还没建好时从最简单难度开始
    fetchKnowledgeMastery('思维').catch((err: unknown) => {
      console.error('[Memory] 读取知识点掌握度失败:', err)
      return []
    }),
  ])

  return <MemoryGame taskId={taskId} knowledge={knowledge} />
}
