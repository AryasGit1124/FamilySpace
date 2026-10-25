import { ensureModuleTaskIdBySubjectName, fetchSubjectIdByName } from '@/lib/supabase-queries'
import { PhonicsGame } from './phonics-client'

export const dynamic = 'force-dynamic'

/** 自然拼读：独立模块，打卡写入自己的任务 */
export default async function PhonicsPage() {
  const [taskId, subjectId] = await Promise.all([
    ensureModuleTaskIdBySubjectName({
      subjectName: '英语',
      title: '自然拼读',
      gameRoute: '/english/phonics',
    }).catch((err: unknown) => {
      console.error('[EnglishPhonics] 获取打卡任务失败:', err)
      return null
    }),
    fetchSubjectIdByName('英语').catch((err: unknown) => {
      console.error('[EnglishPhonics] 获取英语学科失败:', err)
      return null
    }),
  ])

  return (
    <PhonicsGame taskId={taskId} backHref={subjectId ? `/subject/${subjectId}` : undefined} />
  )
}
