'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { stopSpeak } from '@/lib/tts'

/**
 * 原生 MediaRecorder 录音 Hook（识字向导 Step 2 / Step 4 共用）。
 *
 * - `start()` 请求麦克风并在开始前掐断 TTS，避免把机器音录进去。
 * - 停止后生成本地 Blob URL；录音时长不足 `minDurationMs` 时丢弃并给出提示。
 * - `onRecorded` 拿到有效录音地址（古诗逐句录音靠它写回对应句）。
 * - 卸载时自动停录、停麦克风轨道、释放 Blob URL，避免资源泄漏。
 */
export function useAudioRecorder(options?: {
  /** 有效录音的最短时长，默认 1000ms */
  minDurationMs?: number
  /** 生成有效录音后的回调 */
  onRecorded?: (url: string) => void
}) {
  const minDurationMs = options?.minDurationMs ?? 1000
  /** 回调放 ref：调用方每次渲染都会传新函数，避免触发内部重建 */
  const onRecordedRef = useRef(options?.onRecorded)
  onRecordedRef.current = options?.onRecorded

  const [isRecording, setIsRecording] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [hint, setHint] = useState('')
  /** 当前回听地址（ref 版，revoke 时不受闭包影响） */
  const audioUrlRef = useRef<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordStartRef = useRef(0)
  const startingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  /** 停掉麦克风轨道：否则浏览器会一直显示录音中 */
  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  /** 清空当前录音并复位 UI 状态（换字 / 换题 / 重录时调用） */
  const reset = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null
      rec.ondataavailable = null
      rec.stop()
    }
    recorderRef.current = null
    releaseMic()
    chunksRef.current = []
    startingRef.current = false
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    setIsRecording(false)
    setAudioUrl(null)
    setHint('')
  }, [releaseMic])

  /** 开始录音：先掐断 TTS，再要麦克风权限；返回是否真正开始录音 */
  const start = useCallback(async (): Promise<boolean> => {
    if (startingRef.current || recorderRef.current) return false
    setHint('')
    // 防止录进正在播报的机器音
    stopSpeak()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    // 非安全上下文（局域网 http）或旧浏览器可能没有 mediaDevices
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      alert('当前环境不支持录音，请用 Safari 或 Chrome 打开，并确保是 https 访问')
      return false
    }
    if (typeof MediaRecorder === 'undefined') {
      alert('当前浏览器不支持录音，请换用 Safari 或 Chrome 哦')
      return false
    }
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const duration = Date.now() - recordStartRef.current
        releaseMic()
        setIsRecording(false)
        // 时长不足：丢弃，不视为完成
        if (duration < minDurationMs) {
          chunksRef.current = []
          setHint('录音太短啦，读完整再点停止～')
          return
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        chunksRef.current = []
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
        const url = URL.createObjectURL(blob)
        audioUrlRef.current = url
        setAudioUrl(url)
        setHint('')
        onRecordedRef.current?.(url)
      }
      recorderRef.current = rec
      recordStartRef.current = Date.now()
      rec.start()
      setIsRecording(true)
      return true
    } catch (err) {
      console.error('[AudioRecorder] 录音启动失败:', err)
      releaseMic()
      recorderRef.current = null
      setIsRecording(false)
      alert('请允许使用麦克风，才能继续哦')
      return false
    } finally {
      startingRef.current = false
    }
  }, [minDurationMs, releaseMic])

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state === 'recording') rec.stop()
  }, [])

  const toggle = useCallback(() => {
    if (isRecording) stop()
    else void start()
  }, [isRecording, start, stop])

  /** 回听录音（点击手势内播放，iPad 不会被自动播放策略拦截） */
  const play = useCallback((url?: string | null) => {
    const target = url ?? audioUrlRef.current
    if (!target) return
    audioRef.current?.pause()
    const audio = new Audio(target)
    audioRef.current = audio
    void audio.play().catch(() => setHint('播放失败，请重新录音试试'))
  }, [])

  // 卸载兜底：停录、停麦克风、暂停回听、释放 Blob URL
  useEffect(() => {
    return () => {
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null
        rec.ondataavailable = null
        rec.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      audioRef.current?.pause()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }, [])

  return { isRecording, audioUrl, hint, start, stop, toggle, reset, play }
}
