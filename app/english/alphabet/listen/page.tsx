import {
  ensureModuleTaskIdBySubjectName,
  fetchKnowledgeMastery,
} from '@/lib/supabase-queries'
import { ListenGame } from './listen-client'

export const dynamic = 'force-dynamic'

/** 听音选字母：打卡写入「字母乐园」模块任务 */
export default async function ListenPage() {
  const [taskId, knowledge] = await Promise.all([
    ensureModuleTaskIdBySubjectName({
      subjectName: '英语',
      title: '字母乐园',
      gameRoute: '/english/alphabet',
    }).catch((err: unknown) => {
      console.error('[EnglishListen] 获取打卡任务失败:', err)
      return null
    }),
    // 知识点掌握度：表还没建好时按「没有到期知识点」处理，不阻塞游戏
    fetchKnowledgeMastery('英语').catch((err: unknown) => {
      console.error('[EnglishListen] 读取知识点掌握度失败:', err)
      return []
    }),
  ])

  return <ListenGame taskId={taskId} knowledge={knowledge} />
}
