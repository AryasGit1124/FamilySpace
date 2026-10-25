import { ensureModuleTaskIdBySubjectName } from '@/lib/supabase-queries'
import { ListenGame } from './listen-client'

export const dynamic = 'force-dynamic'

/** 听音选字母：打卡写入「字母乐园」模块任务 */
export default async function ListenPage() {
  const taskId = await ensureModuleTaskIdBySubjectName({
    subjectName: '英语',
    title: '字母乐园',
    gameRoute: '/english/alphabet',
  }).catch((err: unknown) => {
    console.error('[EnglishListen] 获取打卡任务失败:', err)
    return null
  })

  return <ListenGame taskId={taskId} />
}
