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
  /** 录音失败的真实原因（err.name / err.message），供 UI 红字展示 */
  const [error, setError] = useState<{ name: string; message: string; tip: string } | null>(null)
  /** 是否 HTTPS / localhost 安全上下文（非安全上下文浏览器不提供麦克风） */
  const [isSecure, setIsSecure] = useState(true)
  /** 当前回听地址（ref 版，revoke 时不受闭包影响） */
  const audioUrlRef = useRef<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordStartRef = useRef(0)
  const startingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // 挂载时确认安全上下文：http 局域网访问时 Safari/Chrome 会直接屏蔽麦克风
  useEffect(() => {
    const secure = typeof window !== 'undefined' && window.isSecureContext
    console.log(
      '[AudioRecorder] 当前是否 HTTPS 安全环境:',
      window.isSecureContext,
      '| origin =',
      window.location.origin,
    )
    console.log(
      '[AudioRecorder] mediaDevices =',
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
      '| MediaRecorder =',
      typeof MediaRecorder !== 'undefined',
    )
    setIsSecure(secure)
  }, [])

  /** 把 getUserMedia 的失败原因翻译成孩子/家长能看懂的提示 */
  const describeError = (err: unknown): { name: string; message: string; tip: string } => {
    const e = err as { name?: string; message?: string } | null
    const name = e?.name ?? 'UnknownError'
    const message = e?.message ?? String(err)
    switch (name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return { name, message, tip: '麦克风权限被拒绝了，请在浏览器地址栏或系统设置里允许本站使用麦克风' }
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return { name, message, tip: '没有找到麦克风设备，请检查耳机或设备是否插好' }
      case 'NotReadableError':
      case 'TrackStartError':
        return { name, message, tip: '麦克风被其它应用占用了（比如正在通话/会议），关掉后再试' }
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return { name, message, tip: '当前麦克风不支持所需参数，正在用默认参数重试' }
      case 'SecurityError':
      case 'TypeError':
        return { name, message, tip: '当前环境不允许录音，请用 https 或 localhost 访问' }
      case 'AbortError':
        return { name, message, tip: '录音启动被中断了，请再点一次' }
      default:
        return { name, message, tip: '录音启动失败，请刷新页面后重试' }
    }
  }

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
    setError(null)
  }, [releaseMic])

  /**
   * 开始录音。返回是否真正开始录音。
   *
   * Safari 对「用户手势」要求极严：getUserMedia 必须在点击事件的同步调用栈里发起，
   * 之前若有 await 会被判定为非用户触发而直接拒绝。所以这里把 getUserMedia
   * 提到函数最前面、在掐断 TTS 之前就同步调用。
   */
  const start = useCallback(async (): Promise<boolean> => {
    if (startingRef.current || recorderRef.current) return false
    setHint('')
    setError(null)

    // ① 先同步发起权限请求（保留用户手势），此时不能有任何 await
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!mediaDevices?.getUserMedia) {
      const info = {
        name: 'UnsupportedError',
        message: 'navigator.mediaDevices.getUserMedia 不可用',
        tip: window.isSecureContext
          ? '当前浏览器不支持录音，请换用 Safari 或 Chrome 哦'
          : '当前不是 https/localhost，浏览器禁止使用麦克风',
      }
      console.error('[AudioRecorder] 无法调用 getUserMedia:', info.name, info.message, '| isSecureContext =', window.isSecureContext)
      setError(info)
      alert(info.tip)
      return false
    }
    if (typeof MediaRecorder === 'undefined') {
      const info = { name: 'UnsupportedError', message: 'MediaRecorder 不存在', tip: '当前浏览器不支持录音，请换用 Safari 或 Chrome 哦' }
      console.error('[AudioRecorder] 无法创建 MediaRecorder:', info.message)
      setError(info)
      alert(info.tip)
      return false
    }

    let request: Promise<MediaStream>
    try {
      request = mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch (syncErr) {
      const info = describeError(syncErr)
      console.error('[AudioRecorder] getUserMedia 同步抛错 | name =', info.name, '| message =', info.message)
      setError(info)
      alert(`${info.tip}\n\n(${info.name}: ${info.message})`)
      return false
    }

    // ② 权限请求已发出，再掐断 TTS，避免把机器音录进去
    stopSpeak()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    startingRef.current = true
    try {
      let stream: MediaStream
      try {
        stream = await request
      } catch (err) {
        const info = describeError(err)
        console.error(
          '[AudioRecorder] getUserMedia 失败 | name =',
          info.name,
          '| message =',
          info.message,
          '| isSecureContext =',
          typeof window !== 'undefined' && window.isSecureContext,
          '| raw =',
          err,
        )
        setError(info)
        // 参数过于严格时回退到默认参数重试一次（部分老旧设备不支持回声消除）
        if (info.name === 'OverconstrainedError' || info.name === 'ConstraintNotSatisfiedError') {
          console.warn('[AudioRecorder] 回退为默认参数 { audio: true } 重试')
          stream = await mediaDevices.getUserMedia({ audio: true })
        } else {
          alert(`${info.tip}\n\n(${info.name}: ${info.message})`)
          return false
        }
      }

      streamRef.current = stream
      chunksRef.current = []

      let rec: MediaRecorder
      try {
        rec = new MediaRecorder(stream)
      } catch (err) {
        const info = describeError(err)
        console.error('[AudioRecorder] 创建 MediaRecorder 失败 | name =', info.name, '| message =', info.message)
        releaseMic()
        setError({ ...info, tip: '当前浏览器无法创建录音器，请换用 Safari 或 Chrome 试试' })
        alert('当前浏览器无法创建录音器，请换用 Safari 或 Chrome 试试')
        return false
      }

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
      rec.onerror = (event) => {
        console.error('[AudioRecorder] MediaRecorder error:', event)
      }
      recorderRef.current = rec
      recordStartRef.current = Date.now()
      rec.start()
      setIsRecording(true)
      console.log('[AudioRecorder] 开始录音，mimeType =', rec.mimeType)
      return true
    } catch (err) {
      const info = describeError(err)
      console.error('[AudioRecorder] 录音启动异常 | name =', info.name, '| message =', info.message, '| raw =', err)
      releaseMic()
      recorderRef.current = null
      setIsRecording(false)
      setError(info)
      alert(`${info.tip}\n\n(${info.name}: ${info.message})`)
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

  return { isRecording, audioUrl, hint, error, isSecure, start, stop, toggle, reset, play }
}
