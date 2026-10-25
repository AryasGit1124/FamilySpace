import { fetchLiteracyTaskId } from '@/lib/supabase-queries'
import { StoryClient } from './story-client'

export const dynamic = 'force-dynamic'

export default async function StoryPage() {
  // 「完成打卡」写到「识字」这条线上任务上
  const taskId = await fetchLiteracyTaskId().catch((err: unknown) => {
    console.error('[StoryPage] 查询识字任务失败:', err)
    return null
  })

  return <StoryClient taskId={taskId} />
}
