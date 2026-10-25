'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CheckCircle2, PartyPopper, RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import { ChoiceGame } from '@/components/games/choice-game'
import { FillGame } from '@/components/games/fill-game'
import { MatchingGame } from '@/components/games/matching-game'
import { SequenceGame } from '@/components/games/sequence-game'
import { StoryGame } from '@/components/games/story-game'
import { handleGameCheckin } from '@/lib/rewards'
import type { DynamicGame, DynamicGameType } from '@/lib/dynamic-game'
import { stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

const TYPE_LABEL: Record<DynamicGameType, string> = {
  choice: '选择题',
  matching: '连线题',
  sequence: '排序题',
  fill: '填空题',
  story: '故事',
}

type Props = {
  taskId: string
  subjectId?: string | null
  title: string
  game: DynamicGame
}

/**
 * 万能游戏渲染引擎（父层）：
 * 1. 按 game.type 渲染对应的子组件（choice / matching / sequence / fill）；
 * 2. 子组件统一通过 onComplete(totalQuestions, firstTryCorrectCount) 上报结果；
 * 3. 父层统一调用 handleGameCheckin 结算星星，并展示打卡成功动画。
 */
export function DynamicGamePlayer({ taskId, subjectId, title, game }: Props) {
  const { role } = useAuth()
  const isParent = role === 'parent'

  const [finished, setFinished] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [totalQuestions, setTotalQuestions] = useState(game.data.length)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [earnedStars, setEarnedStars] = useState(0)
  const [error, setError] = useState('')

  /** 所有子组件的统一完成回调：参数为总题数与首答正确数 */
  const handleComplete = (total: number, firstTry: number) => {
    stopSpeak()
    setTotalQuestions(total)
    setFirstTryCorrect(firstTry)
    setFinished(true)
    void settleStars(total, firstTry)
  }

  /** 统一结算星星（家长端为 dryRun 测试模式） */
  const settleStars = async (total: number, firstTry: number) => {
    if (checked || saving) return
    setSaving(true)
    setError('')
    try {
      // 故事没有对错，固定奖励 1 颗星；其余题型按首答正确率结算
      const starRule = game.type === 'story' ? () => 1 : undefined
      const stars = await handleGameCheckin(taskId, total, firstTry, isParent, starRule)
      setEarnedStars(stars)
      setChecked(true)
    } catch (err) {
      console.error('[DynamicGamePlayer] 打卡失败:', err)
      setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  /** 再玩一次：重置完成态并强制重挂子组件，清空其内部进度 */
  const restart = () => {
    stopSpeak()
    setFinished(false)
    setError('')
    setAttempt((v) => v + 1)
  }

  if (finished) {
    return (
      <div className="flex flex-col gap-5 px-5 pt-8 pb-6">
        <header className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">AI 互动小游戏 · {TYPE_LABEL[game.type]}</p>
          <h1 className="text-2xl font-bold">{title}</h1>
        </header>

        <section className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-6 text-center">
          <div className="relative">
            <PartyPopper className="size-12 animate-bounce text-primary" aria-hidden="true" />
            <span className="absolute -top-1 -right-2 animate-ping text-lg">✨</span>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xl font-bold">
              {game.type === 'story' ? '故事听完啦，太棒了！' : '全部完成，太棒了！'}
            </p>
            <p className="text-sm text-muted-foreground">
              {game.type === 'story'
                ? `故事共 ${totalQuestions} 句`
                : `本次共 ${totalQuestions} 题（首答正确 ${firstTryCorrect} 题）`}
            </p>
            {isParent && <p className="text-xs text-muted-foreground">家长测试模式，不计入星星</p>}
          </div>

          {saving && <p className="text-sm text-muted-foreground">正在结算星星…</p>}

          {checked && (
            <div className="flex animate-pulse flex-col items-center gap-1 rounded-xl bg-amber-50 px-4 py-3">
              <CheckCircle2 className="size-6 text-amber-500" aria-hidden="true" />
              <p className="text-base font-semibold text-amber-600">
                打卡成功！获得 {earnedStars} 颗星星 ⭐
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {subjectId && (
            <Link href={`/subject/${subjectId}`} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
              返回学科
            </Link>
          )}

          <Button variant="ghost" onClick={restart}>
            <RotateCcw className="size-4" aria-hidden="true" />
            再玩一次
          </Button>
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 px-5 pt-8 pb-6">
      <header
        className={cn('flex flex-col gap-1', game.type === 'story' && 'items-center text-center')}
      >
        <p className="text-sm text-muted-foreground">AI 互动小游戏 · {TYPE_LABEL[game.type]}</p>
        <h1 className={cn('text-2xl font-bold', game.type === 'story' && 'text-3xl')}>{title}</h1>
      </header>

      {game.type === 'choice' && (
        <ChoiceGame key={attempt} data={game.data} onComplete={handleComplete} />
      )}
      {game.type === 'matching' && (
        <MatchingGame key={attempt} data={game.data} onComplete={handleComplete} />
      )}
      {game.type === 'sequence' && (
        <SequenceGame key={attempt} data={game.data} onComplete={handleComplete} />
      )}
      {game.type === 'fill' && <FillGame key={attempt} data={game.data} onComplete={handleComplete} />}
      {game.type === 'story' && <StoryGame key={attempt} data={game.data} onComplete={handleComplete} />}
    </div>
  )
}
