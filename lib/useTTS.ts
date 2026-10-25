'use client'

/**
 * iPad 友好的语音播报 Hook。
 *
 * 播放引擎全部在 lib/tts.ts：云端合成 mp3 → Web Audio 主通道 / <audio> 兜底播放。
 * 这里只负责把「一次性播报」包装成可 await 的 Promise，并暴露解锁、错误、播放状态给 UI。
 *
 * iPad / Safari 的三条硬性规则，均由 lib/tts.ts 保证：
 * 1. 必须在用户手势内创建/恢复 AudioContext 并播放一次静音音频，否则后续异步音频会被拦；
 * 2. `navigator.audioSession.type = 'playback'`，避免静音键把网页音频一起静音；
 * 3. 从后台切回前台时主动 resume AudioContext。
 *
 * 因此建议在页面首个明确点击（如「开始」「播放」按钮）里调用一次 `unlock()`；
 * 即使不调用，lib/tts.ts 也会在全局 pointerdown / touchstart / keydown 时自动解锁。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  speakChinese,
  speakEnglish,
  speakLines,
  stopSpeak,
  subscribeTtsFailure,
  subscribeTtsPlaying,
  unlockTtsAudio,
  USE_CLOUD_TTS,
} from '@/lib/tts'

export { USE_CLOUD_TTS }

export type TtsProvider = 'tencent' | 'edge'

type SpeakOptions = {
  /** 不传时按内容自动判断：纯 ASCII 走英文音色，其余走中文 */
  lang?: 'zh' | 'en'
  /** 英文语速倍率，默认 0.85 */
  rate?: number
  /** 自然播完时触发（被打断不会触发） */
  onEnd?: () => void
}

const FAILURE_MESSAGE = '语音暂时无法播放，请稍后再试'

export function useTTS() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 当前这次播报的 Promise resolver，打断时用它收尾，避免 await 永远悬着 */
  const pendingRef = useRef<((ok: boolean) => void) | null>(null)
  /** 本次播报是否发生了「所有后端都失败」，用于把 Promise 结果标成 false */
  const failedRef = useRef(false)

  useEffect(() => subscribeTtsPlaying(setIsPlaying), [])

  useEffect(
    () =>
      subscribeTtsFailure(() => {
        failedRef.current = true
        setError(FAILURE_MESSAGE)
      }),
    [],
  )

  /** 立刻结束上一次未完成的播报 Promise */
  const settle = useCallback((ok: boolean) => {
    const resolve = pendingRef.current
    pendingRef.current = null
    resolve?.(ok)
  }, [])

  const unlock = useCallback(() => {
    unlockTtsAudio()
  }, [])

  const stop = useCallback(() => {
    settle(false)
    stopSpeak()
  }, [settle])

  const speak = useCallback(
    (text: string, options: SpeakOptions = {}): Promise<boolean> => {
      const content = text.trim()
      if (!content) return Promise.resolve(false)

      settle(false)
      stopSpeak()
      failedRef.current = false
      setError(null)

      return new Promise<boolean>((resolve) => {
        pendingRef.current = resolve

        const done = () => {
          if (pendingRef.current !== resolve) return
          pendingRef.current = null
          options.onEnd?.()
          resolve(!failedRef.current)
        }

        const lang = options.lang ?? (/^[\x00-\x7F\s]+$/.test(content) ? 'en' : 'zh')
        if (lang === 'en') speakEnglish(content, options.rate ?? 0.85, done)
        else speakChinese(content, done)
      })
    },
    [settle],
  )

  const speakAll = useCallback(
    (lines: string[]): Promise<boolean> => {
      const cleaned = lines.filter((line) => line.trim())
      if (cleaned.length === 0) return Promise.resolve(false)

      settle(false)
      stopSpeak()
      failedRef.current = false
      setError(null)

      return new Promise<boolean>((resolve) => {
        pendingRef.current = resolve
        speakLines(cleaned, () => {
          if (pendingRef.current !== resolve) return
          pendingRef.current = null
          resolve(!failedRef.current)
        })
      })
    },
    [settle],
  )

  // 卸载时把未完成的 Promise 收尾并停止播放，避免内存泄漏与残留声音
  useEffect(
    () => () => {
      settle(false)
      stopSpeak()
    },
    [settle],
  )

  return {
    speak,
    speakAll,
    stop,
    unlock,
    isPlaying,
    error,
    provider: USE_CLOUD_TTS ? ('tencent' as const) : ('edge' as const),
  }
}
