import { ensureModuleTaskIdBySubjectName } from '@/lib/supabase-queries'
import { HideGame } from './hide-client'

export const dynamic = 'force-dynamic'

/** 大小写捉迷藏：打卡写入「字母乐园」模块任务 */
export default async function HidePage() {
  const taskId = await ensureModuleTaskIdBySubjectName({
    subjectName: '英语',
    title: '字母乐园',
    gameRoute: '/english/alphabet',
  }).catch((err: unknown) => {
    console.error('[EnglishHide] 获取打卡任务失败:', err)
    return null
  })

  return <HideGame taskId={taskId} />
}
