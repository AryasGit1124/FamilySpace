'use client'

import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { ALPHABET } from '@/lib/english-data'
import { speakEnglish, speakEnglishAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { AlphabetBackLink, RoundComplete, RoundProgress, ENGLISH_ROUND_TOTAL } from '../../game-ui'
import { useEnglishRound } from '../../use-english-round'

type Question = {
  letter: string
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
    letter: target.upper,
    options: shuffle([target.upper, ...distractors.map((item) => item.upper)]),
  }
}

export function ListenGame({ taskId }: { taskId: string | null }) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongOption, setWrongOption] = useState<string | null>(null)
  const [hasTried, setHasTried] = useState(false)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useEnglishRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion())
  }, [])

  /** 页面加载与每道新题都自动播报字母发音；新题打断上一题语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakEnglish(question.letter)
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
    if (option === question.letter) {
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
      <PageHeader title="听音选字母" subtitle="听发音，选出正确的字母" action={<AlphabetBackLink />} />
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
              <Button
                size="lg"
                variant="outline"
                aria-label="播放字母发音"
                className="size-20 rounded-full"
                onClick={() => speakEnglish(question.letter)}
              >
                <Volume2 className="size-10" aria-hidden="true" />
              </Button>
              <p className="text-sm text-muted-foreground">点喇叭再听一遍，选出你听到的字母</p>
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
