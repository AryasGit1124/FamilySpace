import Link from 'next/link'
import { DynamicGamePlayer } from '@/components/dynamic-game-player'
import { parseDynamicGame } from '@/lib/dynamic-game'
import { fetchGameTaskById } from '@/lib/supabase-queries'

/** 每次进入都按 id 重新读 tasks，避免缓存住旧游戏内容 */
export const dynamic = 'force-dynamic'

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

export default async function DynamicGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const task = await fetchGameTaskById(id).catch((err: unknown) => {
    console.error('[DynamicGamePage] tasks 查询失败:', err)
    return null
  })

  if (!task) return <Fallback message="找不到这个游戏" />

  const game = parseDynamicGame(task.game_content, task.title)
  if (!game) {
    return <Fallback message="这个任务还没有可玩的游戏内容" subjectId={task.subject_id} />
  }

  return (
    <DynamicGamePlayer
      taskId={task.id}
      subjectId={task.subject_id}
      title={game.title || task.title}
      game={game}
    />
  )
}
