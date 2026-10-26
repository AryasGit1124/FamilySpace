'use client'

import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { ALPHABET, type AlphabetLetter } from '@/lib/english-data'
import { speakEnglish, speakEnglishAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { AlphabetBackLink, RoundComplete, RoundProgress, ENGLISH_ROUND_TOTAL } from '../../game-ui'
import { useEnglishRound } from '../../use-english-round'

type Question = {
  target: AlphabetLetter
  /** 4 个小写字母选项 */
  options: string[]
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function makeQuestion(): Question {
  const target = ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  const distractors = shuffle(ALPHABET.filter((item) => item.upper !== target.upper)).slice(0, 3)
  return {
    target,
    options: shuffle([target.lower, ...distractors.map((item) => item.lower)]),
  }
}

function promptOf(question: Question): string {
  return `Find the lowercase ${question.target.upper}`
}

export function HideGame({ taskId }: { taskId: string | null }) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongOption, setWrongOption] = useState<string | null>(null)
  const [hasTried, setHasTried] = useState(false)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useEnglishRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion())
  }, [])

  /** 新题出现时用美式发音播报题目；新题打断上一题语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakEnglish(promptOf(question))
    }
  }, [question])

  useEffect(() => () => stopSpeak(), [])

  const nextQuestion = () => {
    setQuestion(makeQuestion())
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  /** 答对：等「Yes! Well done.」读完再出新题，期间按钮保持禁用 */
  const choose = async (option: string) => {
    if (!question || locked) return
    if (option === question.target.lower) {
      setLocked(true)
      addSolved(!hasTried)
      stopSpeak()
      await speakEnglishAsync('Yes! Well done.')
      nextQuestion()
    } else {
      setWrongOption(option)
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
      <PageHeader title="大小写捉迷藏" subtitle="看大写，找出对应的小写" action={<AlphabetBackLink />} />
      <div className="flex flex-col gap-5 px-5 pb-6">
        <RoundProgress done={solved} />

        {finished ? (
          <RoundComplete
            total={ENGLISH_ROUND_TOTAL}
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
            <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8">
              <p className="text-8xl font-bold tracking-wider" aria-label={`大写字母 ${question.target.upper}`}>
                {question.target.upper}
              </p>
              <Button size="sm" variant="outline" onClick={() => speakEnglish(promptOf(question))}>
                <Volume2 aria-hidden="true" />
                再听一遍
              </Button>
            </section>

            <div className="grid grid-cols-2 gap-3">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => choose(option)}
                  onAnimationEnd={() =>
                    setWrongOption((cur) => (cur === option ? null : cur))
                  }
                  disabled={locked}
                  className={cn(
                    'flex h-24 items-center justify-center rounded-2xl border bg-background text-5xl font-bold transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongOption === option &&
                      'math-shake border-destructive bg-destructive/10 text-destructive',
                  )}
                >
                  {option}
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
