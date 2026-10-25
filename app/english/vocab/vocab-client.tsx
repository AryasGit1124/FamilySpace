'use client'

import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { VOCAB, type VocabWord } from '@/lib/english-data'
import { speakEnglish, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { RoundComplete, RoundProgress, ENGLISH_ROUND_TOTAL } from '../game-ui'
import { useEnglishRound } from '../use-english-round'

type Question = {
  word: VocabWord
  options: VocabWord[]
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
  const word = VOCAB[Math.floor(Math.random() * VOCAB.length)]
  const distractors = shuffle(VOCAB.filter((item) => item.en !== word.en)).slice(0, 3)
  return { word, options: shuffle([word, ...distractors]) }
}

export function VocabGame({
  taskId,
  backHref,
}: {
  taskId: string | null
  backHref?: string
}) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongOption, setWrongOption] = useState<string | null>(null)
  const [hasTried, setHasTried] = useState(false)
  const timerRef = useRef<number | null>(null)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useEnglishRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion())
  }, [])

  /** 新题自动播放英文单词；新题打断上一题语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakEnglish(question.word.en)
    }
  }, [question])

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      stopSpeak()
    },
    [],
  )

  const nextQuestion = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setQuestion(makeQuestion())
      setLocked(false)
      setWrongOption(null)
      setHasTried(false)
      timerRef.current = null
    }, 800)
  }

  const choose = (option: VocabWord) => {
    if (!question || locked) return
    if (option.en === question.word.en) {
      setLocked(true)
      speakEnglish(`Yes! ${option.en}`)
      addSolved(!hasTried)
      nextQuestion()
    } else {
      setWrongOption(option.emoji)
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
      <PageHeader
        title="词汇视听"
        subtitle="听单词，选出对应的图片"
        backHref={backHref}
        backLabel="返回英语"
      />
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
            <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-6">
              <Button
                size="lg"
                aria-label="播放单词发音"
                className="size-20 rounded-full"
                onClick={() => speakEnglish(question.word.en)}
              >
                <Volume2 className="size-10" aria-hidden="true" />
              </Button>
              <p className="text-sm text-muted-foreground">点喇叭再听一遍，选出正确的图片</p>
            </section>

            <div className="grid grid-cols-2 gap-3">
              {question.options.map((option) => (
                <button
                  key={option.en}
                  type="button"
                  onClick={() => choose(option)}
                  onAnimationEnd={() =>
                    setWrongOption((cur) => (cur === option.emoji ? null : cur))
                  }
                  disabled={locked}
                  aria-label={option.zh}
                  className={cn(
                    'flex h-32 items-center justify-center rounded-2xl border bg-background text-6xl transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongOption === option.emoji &&
                      'math-shake border-destructive bg-destructive/10',
                  )}
                >
                  <span aria-hidden="true">{option.emoji}</span>
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
