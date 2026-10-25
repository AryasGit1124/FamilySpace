'use client'

import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { OnComplete, StoryItem } from '@/lib/dynamic-game'
import { speakChinese, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

type Props = {
  data: StoryItem[]
  onComplete: OnComplete
}

/**
 * 故事题型：大字逐句展示，点「听故事」逐句朗读并高亮当前句；
 * 全部句子朗读结束（TTS onend）后才允许「完成故事打卡」。
 */
export function StoryGame({ data, onComplete }: Props) {
  const [current, setCurrent] = useState(-1)
  const [listening, setListening] = useState(false)
  const [played, setPlayed] = useState(false)
  /** 朗读流程是否仍然有效（重播/卸载时置 false，避免回调继续推进） */
  const activeRef = useRef(false)

  useEffect(() => {
    return () => {
      activeRef.current = false
      stopSpeak()
    }
  }, [])

  const play = () => {
    stopSpeak()
    activeRef.current = true
    setListening(true)
    setCurrent(-1)

    const speakAt = (index: number) => {
      if (!activeRef.current) return
      if (index >= data.length) {
        activeRef.current = false
        setListening(false)
        setCurrent(-1)
        setPlayed(true)
        return
      }
      setCurrent(index)
      // 逐句朗读：上一句 onend 后再读下一句
      speakChinese(data[index].content, () => speakAt(index + 1))
    }

    speakAt(0)
  }

  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        {data.map((item, i) => (
          <p
            key={`sentence-${i}`}
            className={cn(
              'text-xl leading-loose transition-colors',
              current === i && 'rounded-xl bg-amber-50 px-2 py-1 font-medium text-amber-800',
            )}
          >
            {item.content}
          </p>
        ))}
      </section>

      <Button size="lg" variant={listening ? 'secondary' : 'default'} className="w-full" onClick={play}>
        <Volume2 className="size-5" aria-hidden="true" />
        {listening ? '正在讲故事…' : played ? '再听一次' : '🔊 听故事'}
      </Button>

      <Button
        size="lg"
        className="w-full"
        disabled={!played}
        onClick={() => onComplete(data.length, data.length)}
      >
        {played ? '完成故事打卡' : '听完故事才能打卡哦'}
      </Button>
    </>
  )
}
