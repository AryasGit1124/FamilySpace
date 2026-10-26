'use client'

import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { speakChinese, speakChineseAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { RoundComplete, RoundProgress, MathBackLink, MATH_ROUND_TOTAL } from '../game-ui'
import { useMathRound } from '../use-math-round'

/** 图库：每题随机取一种 Emoji */
const EMOJIS = ['🍎', '🐟', '⭐', '🍌', '🐰', '🌸', '🐱', '🚗', '🎈', '🍓']
const QUESTION_TEXT = '一共有几个？'

type Question = {
  emoji: string
  count: number
  options: number[]
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 正确项 + 两个附近范围的干扰项（都在 1~10 内） */
function buildOptions(answer: number): number[] {
  const values = new Set<number>([answer])
  const deltas = [1, -1, 2, -2]
  while (values.size < 3) {
    const candidate = answer + deltas[Math.floor(Math.random() * deltas.length)]
    if (candidate >= 1 && candidate <= 10) values.add(candidate)
  }
  return shuffle(Array.from(values))
}

function makeQuestion(): Question {
  const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)]
  const count = 1 + Math.floor(Math.random() * 10)
  return { emoji, count, options: buildOptions(count) }
}

export function CountGame({ taskId }: { taskId: string | null }) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongOption, setWrongOption] = useState<number | null>(null)
  const [hasTried, setHasTried] = useState(false)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useMathRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion())
  }, [])

  /** 题目出现时自动播报；新题会打断上一题的"答对了"语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakChinese(QUESTION_TEXT)
    }
  }, [question])

  useEffect(() => () => stopSpeak(), [])

  const nextQuestion = () => {
    setQuestion(makeQuestion())
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  /** 答对：等「答对了，一共有 X 个」读完再出新题，期间按钮保持禁用 */
  const choose = async (value: number) => {
    if (!question || locked) return
    if (value === question.count) {
      setLocked(true)
      addSolved(!hasTried)
      stopSpeak()
      await speakChineseAsync(`答对了，一共有 ${value} 个`)
      nextQuestion()
    } else {
      setWrongOption(value)
      setHasTried(true)
    }
  }

  const restart = () => {
    reset()
    setQuestion(makeQuestion())
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  return (
    <>
      <PageHeader title="点数游戏" subtitle="数一数，一共有几个" action={<MathBackLink />} />
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
            <section className="rounded-2xl border bg-card p-5">
              <div className="grid grid-cols-5 place-items-center gap-3">
                {Array.from({ length: question.count }, (_, i) => (
                  <span key={i} className="text-5xl leading-none select-none" aria-hidden="true">
                    {question.emoji}
                  </span>
                ))}
              </div>
            </section>

            <div className="flex items-center justify-center gap-2">
              <p className="text-xl font-semibold">{QUESTION_TEXT}</p>
              <Button
                size="icon"
                variant="outline"
                aria-label="播放题目语音"
                onClick={() => speakChinese(QUESTION_TEXT)}
              >
                <Volume2 aria-hidden="true" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {question.options.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => choose(value)}
                  onAnimationEnd={() =>
                    setWrongOption((cur) => (cur === value ? null : cur))
                  }
                  disabled={locked}
                  className={cn(
                    'flex h-20 items-center justify-center rounded-2xl border bg-background text-3xl font-bold transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongOption === value && 'math-shake border-destructive bg-destructive/10 text-destructive',
                  )}
                >
                  {value}
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
