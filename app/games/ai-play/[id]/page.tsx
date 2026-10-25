import Link from 'next/link'
import { AiGamePlayer, type AiGameQuestion } from '@/components/ai-game-player'
import { fetchGameTaskById } from '@/lib/supabase-queries'

/** 每次进入都按 id 重新读 tasks，避免缓存住旧游戏内容 */
export const dynamic = 'force-dynamic'

type GameContent = {
  title?: string
  questions?: AiGameQuestion[]
}

/** game_content 可能是 jsonb 对象，也可能被存成字符串 */
function parseGameContent(raw: unknown): GameContent | null {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null

  const content = value as GameContent
  const questions = Array.isArray(content.questions) ? content.questions : []
  const validQuestions = questions.filter(
    (q): q is AiGameQuestion =>
      !!q &&
      typeof q.text === 'string' &&
      Array.isArray(q.options) &&
      q.options.length >= 2 &&
      typeof q.answer === 'string',
  )

  if (validQuestions.length === 0) return null
  return {
    title: typeof content.title === 'string' ? content.title : undefined,
    questions: validQuestions,
  }
}

function Fallback({ message, subjectId }: { message: string; subjectId?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-20 text-center">
      <p className="font-medium">{message}</p>
      <Link
        href={subjectId ? `/subject/${subjectId}` : '/'}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        返回
      </Link>
    </div>
  )
}

export default async function AiPlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const task = await fetchGameTaskById(id).catch((err: unknown) => {
    console.error('[AiPlayPage] tasks 查询失败:', err)
    return null
  })

  if (!task) return <Fallback message="找不到这个游戏" />

  const content = parseGameContent(task.game_content)
  if (!content?.questions) {
    return <Fallback message="这个任务还没有可玩的游戏内容" subjectId={task.subject_id} />
  }

  return (
    <AiGamePlayer
      taskId={task.id}
      subjectId={task.subject_id}
      title={content.title ?? task.title}
      questions={content.questions}
    />
  )
}
