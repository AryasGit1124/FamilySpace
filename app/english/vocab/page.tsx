import {
  ensureModuleTaskIdBySubjectName,
  fetchKnowledgeMastery,
  fetchSubjectIdByName,
} from '@/lib/supabase-queries'
import { VocabGame } from './vocab-client'

export const dynamic = 'force-dynamic'

/** 词汇视听：独立模块，打卡写入自己的任务 */
export default async function VocabPage() {
  const [taskId, subjectId, knowledge] = await Promise.all([
    ensureModuleTaskIdBySubjectName({
      subjectName: '英语',
      title: '词汇视听',
      gameRoute: '/english/vocab',
    }).catch((err: unknown) => {
      console.error('[EnglishVocab] 获取打卡任务失败:', err)
      return null
    }),
    fetchSubjectIdByName('英语').catch((err: unknown) => {
      console.error('[EnglishVocab] 获取英语学科失败:', err)
      return null
    }),
    fetchKnowledgeMastery('英语').catch((err: unknown) => {
      console.error('[EnglishVocab] 读取知识点掌握度失败:', err)
      return []
    }),
  ])

  return (
    <VocabGame
      taskId={taskId}
      knowledge={knowledge}
      backHref={subjectId ? `/subject/${subjectId}` : undefined}
    />
  )
}
