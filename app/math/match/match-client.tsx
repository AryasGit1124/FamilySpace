'use client'

import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { speakChinese, speakChineseAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { RoundComplete, RoundProgress, MathBackLink, MATH_ROUND_TOTAL } from '../game-ui'
import { useMathRound } from '../use-math-round'

/** 图库：三个框各用一种 Emoji */
const EMOJIS = ['🍎', '🐟', '⭐', '🍌', '🐰', '🌸', '🐱', '🚗', '🎈', '🍓']

type Box = {
  emoji: string
  count: number
}

type Question = {
  target: number
  boxes: Box[]
  correctIndex: number
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 生成 3 个互不相同的数量，其中有且只有 1 个等于 target */
function buildCounts(target: number): number[] {
  const values = new Set<number>([target])
  const deltas = [1, -1, 2, -2, 3, -3]
  let guard = 0
  while (values.size < 3 && guard < 100) {
    guard += 1
    const candidate = target + deltas[Math.floor(Math.random() * deltas.length)]
    if (candidate >= 1 && candidate <= 10) values.add(candidate)
  }
  while (values.size < 3) {
    const candidate = 1 + Math.floor(Math.random() * 10)
    if (!values.has(candidate)) values.add(candidate)
  }
  return shuffle(Array.from(values))
}

function makeQuestion(): Question {
  const target = 1 + Math.floor(Math.random() * 10)
  const counts = buildCounts(target)
  const emojis = shuffle(EMOJIS).slice(0, counts.length)
  const boxes = counts.map((count, index) => ({ count, emoji: emojis[index] }))
  return { target, boxes, correctIndex: boxes.findIndex((box) => box.count === target) }
}

export function MatchGame({ taskId }: { taskId: string | null }) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongBox, setWrongBox] = useState<number | null>(null)
  const [hasTried, setHasTried] = useState(false)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useMathRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion())
  }, [])

  /** 新题出现时自动播报题目；新题会打断上一题的"答对了"语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakChinese(`请找出数量是 ${question.target} 的图片`)
    }
  }, [question])

  useEffect(() => () => stopSpeak(), [])

  /** 答对：等「答对了 + 数量」读完再出新题，期间按钮保持禁用 */
  const choose = async (index: number) => {
    if (!question || locked) return
    if (index === question.correctIndex) {
      setLocked(true)
      addSolved(!hasTried)
      stopSpeak()
      await speakChineseAsync(`答对了，这里正好 ${question.target} 个`)
      setQuestion(makeQuestion())
      setLocked(false)
      setWrongBox(null)
      setHasTried(false)
    } else {
      setWrongBox(index)
      setHasTried(true)
    }
  }

  const restart = () => {
    reset()
    setQuestion(makeQuestion())
    setLocked(false)
    setWrongBox(null)
    setHasTried(false)
  }

  return (
    <>
      <PageHeader title="数量匹配" subtitle="找出数量正好是目标数字的图框" action={<MathBackLink />} />
      <div className="flex flex-col gap-5 px-5 pb-6">
        <RoundProgress done={solved} />

        {finished ? (
          <RoundComplete
            total={MATH_ROUND_TOTAL}
            firstTryCorrect={firstTryCorrect}
            earnedStars={earnedStars}
            checked={checked}
            checkingIn={checkingIn}
            error={error}
            testMode={isParent}
            onRestart={restart}
          />
        ) : question ? (
          <>
            <div className="flex flex-col items-center gap-1">
              <p className="text-6xl font-bold" aria-label={`目标数量 ${question.target}`}>
                {question.target}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  请找出数量是 {question.target} 的图片
                </p>
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label="播放题目语音"
                  onClick={() => speakChinese(`请找出数量是 ${question.target} 的图片`)}
                >
                  <Volume2 aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {question.boxes.map((box, index) => (
                <button
                  key={`${box.emoji}-${box.count}`}
                  type="button"
                  onClick={() => choose(index)}
                  onAnimationEnd={() =>
                    setWrongBox((cur) => (cur === index ? null : cur))
                  }
                  disabled={locked}
                  aria-label={`这一框有 ${box.count} 个图片`}
                  className={cn(
                    'flex min-h-32 items-center justify-center rounded-2xl border bg-card p-2 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongBox === index && 'math-shake border-destructive bg-destructive/10',
                  )}
                >
                  <span
                    className="grid grid-cols-3 place-items-center gap-0.5 text-2xl leading-none select-none"
                    aria-hidden="true"
                  >
                    {Array.from({ length: box.count }, (_, i) => (
                      <span key={i}>{box.emoji}</span>
                    ))}
                  </span>
                </button>
              ))}
            </div>

            <p className="text-center text-xs text-muted-foreground">答对 5 题即完成今日打卡</p>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">题目准备中…</p>
        )}
      </div>
    </>
  )
}
