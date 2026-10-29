import {
  ensureModuleTaskIdBySubjectName,
  fetchKnowledgeMastery,
} from '@/lib/supabase-queries'
import { HideGame } from './hide-client'

export const dynamic = 'force-dynamic'

/** 大小写捉迷藏：打卡写入「字母乐园」模块任务 */
export default async function HidePage() {
  const [taskId, knowledge] = await Promise.all([
    ensureModuleTaskIdBySubjectName({
      subjectName: '英语',
      title: '字母乐园',
      gameRoute: '/english/alphabet',
    }).catch((err: unknown) => {
      console.error('[EnglishHide] 获取打卡任务失败:', err)
      return null
    }),
    fetchKnowledgeMastery('英语').catch((err: unknown) => {
      console.error('[EnglishHide] 读取知识点掌握度失败:', err)
      return []
    }),
  ])

  return <HideGame taskId={taskId} knowledge={knowledge} />
}
