import { ensureModuleTaskIdBySubjectName } from '@/lib/supabase-queries'
import { MemoryGame } from './memory-client'

export const dynamic = 'force-dynamic'

/** 记忆翻牌：打卡写入「思维乐园」模块任务 */
export default async function MemoryPage() {
  const taskId = await ensureModuleTaskIdBySubjectName({
    subjectName: '思维',
    title: '思维乐园',
    gameRoute: '/thinking',
  }).catch((err: unknown) => {
    console.error('[Memory] 获取打卡任务失败:', err)
    return null
  })

  return <MemoryGame taskId={taskId} />
}
