/**
 * 统一的语音播报入口：文本交给服务端（腾讯云 TTS）合成 mp3，再用同一个 <audio> 元素播放音频流。
 * 之所以不用 window.speechSynthesis：iPad / Safari 上经常静音或直接不发声。
 *
 * 对外导出保持与原浏览器 TTS 版本一致，调用方无需改动。
 */
import { WORD_EXAMPLES } from '@/lib/literacy-words'

type Lang = 'zh' | 'en'

type SpeakRequest = {
  text: string
  lang: Lang
  rate: number
  /** 自然播完时触发（被打断/出错不触发） */
  onEnd?: () => void
}

/** 同一句话在这段时间内的重复请求忽略，避免连点重读；超过后允许重听 */
const SAME_TEXT_COOLDOWN = 600
/** 合成结果缓存条数：游戏里同一批数字/字词会反复朗读，缓存后几乎无延迟 */
const CACHE_LIMIT = 60
/** 多句连读时的统一语速 */
const LINE_RATE = 0.8

/**
 * 全局语音后端开关：
 * - true  优先走腾讯云 /api/tts，失败时退回 Edge TTS
 * - false 优先走 Edge TTS /api/tts-edge，失败时退回腾讯云
 * 两种后端都不可用时给出静默提示（不再使用 iPad 上兼容性差的 speechSynthesis）。
 */
export const USE_CLOUD_TTS = process.env.NEXT_PUBLIC_USE_CLOUD_TTS !== 'false'

const TENCENT_ENDPOINT = '/api/tts'
const EDGE_ENDPOINT = '/api/tts-edge'

function endpoints(): string[] {
  return USE_CLOUD_TTS ? [TENCENT_ENDPOINT, EDGE_ENDPOINT] : [EDGE_ENDPOINT, TENCENT_ENDPOINT]
}

let audioEl: HTMLAudioElement | null = null
/** Web Audio 主通道（iPad 上比 <audio> 元素稳定） */
let audioCtx: AudioContext | null = null
let currentUrl: string | null = null
/** 每次打断 / 开始新播报都会 +1，异步流程据此判断自己是否已经过期 */
let playToken = 0
let currentText = ''
let lastStartAt = 0
let playing = false
/** 音频元素是否已在用户手势内解锁（iOS Safari 必需） */
let unlocked = false
/** 解锁前被浏览器拦截的请求，交互后补播 */
let waitingRequest: SpeakRequest | null = null
let waitingLines: { lines: string[]; onEnd?: () => void } | null = null
let pendingTimer: number | null = null
let pendingRequest: SpeakRequest | null = null
/** 结束当前播放段落（让 await 中的链条提前收尾） */
let stopCurrent: (() => void) | null = null
let silentSrc: string | null = null
let warnedOnce = false

const blobCache = new Map<string, Blob>()
const playingListeners = new Set<(value: boolean) => void>()
/** 所有后端都失败时的订阅者，供 Hook 展示提示 */
const failureListeners = new Set<() => void>()

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function hasStickyActivation(): boolean {
  if (typeof navigator === 'undefined') return false
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation
  return activation?.hasBeenActive ?? false
}

function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    const el = new Audio()
    el.preload = 'auto'
    el.setAttribute('playsinline', 'true')
    audioEl = el
  }
  return audioEl
}

function setPlaying(value: boolean) {
  if (playing === value) return
  playing = value
  playingListeners.forEach((listener) => listener(value))
}

/** 订阅全局播放状态，用于 UI 上做喇叭闪烁动画 */
export function subscribeTtsPlaying(listener: (value: boolean) => void): () => void {
  playingListeners.add(listener)
  listener(playing)
  return () => {
    playingListeners.delete(listener)
  }
}

/** 订阅「所有语音后端都不可用」事件，用于 UI 提示 */
export function subscribeTtsFailure(listener: () => void): () => void {
  failureListeners.add(listener)
  return () => {
    failureListeners.delete(listener)
  }
}

/** 生成 0.1 秒静音 wav 的 dataURI，用于在用户手势内解锁音频元素 */
function getSilentSrc(): string {
  if (silentSrc) return silentSrc
  const sampleRate = 8000
  const samples = 800
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples * 2, true)

  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  silentSrc = `data:audio/wav;base64,${window.btoa(binary)}`
  return silentSrc
}

/** 懒创建 AudioContext：iOS 要求在用户手势内创建/resume */
function getAudioContext(): AudioContext | null {
  if (!hasWindow()) return null
  if (audioCtx) return audioCtx
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    audioCtx = new Ctor()
  } catch {
    return null
  }
  return audioCtx
}

/** iOS Safari 16.4+：声明为 playback 会话，避免被静音键/锁屏切成静音 */
function applyAudioSession() {
  if (typeof navigator === 'undefined') return
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = 'playback'
  } catch {
    // 老版本 Safari 不支持，忽略
  }
}

/**
 * 在用户手势内解锁音频：resume AudioContext（主通道）+ 播一段静音解锁 <audio>（备用通道）。
 * 必须在 pointerdown / touchstart / click 的同步调用栈里执行。
 */
export function unlockTtsAudio() {
  if (!hasWindow()) return
  applyAudioSession()

  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // 没有手势上下文时会被拒绝，等下一次交互
    })
  }

  if (unlocked) return
  const el = getAudio()
  el.src = getSilentSrc()
  const result = el.play()
  if (!result) {
    unlocked = true
    flushWaiting()
    return
  }
  result
    .then(() => {
      unlocked = true
      flushWaiting()
    })
    .catch(() => {
      // 元素解锁失败时，AudioContext 已 running 也算可用
      if (ctx && ctx.state === 'running') {
        unlocked = true
        flushWaiting()
      }
    })
}

function flushWaiting() {
  if (!unlocked) return
  const waiting = waitingLines
  const request = waitingRequest
  waitingLines = null
  waitingRequest = null
  if (waiting) playLinesNow(waiting.lines, waiting.onEnd)
  else if (request) playNow(request)
}

/** 请求合成结果：按开关顺序尝试各后端，命中缓存直接返回 */
async function loadAudio(text: string, lang: Lang, rate: number): Promise<Blob | null> {
  const key = `${lang}|${rate}|${text}`
  const cached = blobCache.get(key)
  if (cached) return cached

  for (const endpoint of endpoints()) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang, rate }),
      })
      if (!res.ok) {
        if (!warnedOnce) {
          warnedOnce = true
          console.warn(`[TTS] ${endpoint} 合成失败：HTTP ${res.status}`)
        }
        continue
      }
      const blob = await res.blob()
      if (blob.size === 0) continue
      if (blobCache.size >= CACHE_LIMIT) {
        const oldest = blobCache.keys().next().value
        if (oldest !== undefined) blobCache.delete(oldest)
      }
      blobCache.set(key, blob)
      return blob
    } catch {
      if (!warnedOnce) {
        warnedOnce = true
        console.warn(`[TTS] ${endpoint} 请求异常`)
      }
    }
  }
  return null
}

/** 备用通道：用 <audio> 元素播放（Web Audio 不可用时使用） */
function playViaElement(blob: Blob, token: number): Promise<boolean> {
  // 先把上一段还没结束的 promise 收尾，避免悬空
  stopCurrent?.()

  const el = getAudio()
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
  currentUrl = URL.createObjectURL(blob)
  el.src = currentUrl

  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (stopCurrent === stopSelf) stopCurrent = null
      el.onended = null
      el.onerror = null
      setPlaying(false)
      resolve(ok)
    }
    const stopSelf = () => finish(false)
    stopCurrent = stopSelf
    el.onended = () => finish(token === playToken)
    el.onerror = () => finish(false)

    setPlaying(true)
    const result = el.play()
    if (result) result.catch(() => finish(false))
  })
}

/**
 * 主通道：把 mp3 解码成 AudioBuffer 后用 Web Audio 播放。
 * iPad 上比 <audio> 元素更稳：不受 src 切换竞态影响，onended 也更可靠。
 * 返回 null 表示这条通道不可用（没有 AudioContext / 未解锁 / 解码失败），交给 <audio> 兜底。
 */
async function playViaWebAudio(blob: Blob, token: number): Promise<boolean | null> {
  const ctx = getAudioContext()
  if (!ctx || ctx.state !== 'running') return null

  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
  } catch {
    return null
  }
  if (token !== playToken) return false

  stopCurrent?.()
  // 走 Web Audio 时同步暂停可能还在响的 <audio> 通道
  if (audioEl) {
    audioEl.onended = null
    audioEl.onerror = null
    audioEl.pause()
  }

  return new Promise<boolean>((resolve) => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)

    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (stopCurrent === stopSelf) stopCurrent = null
      source.onended = null
      try {
        source.disconnect()
      } catch {
        // 已断开则忽略
      }
      setPlaying(false)
      resolve(ok)
    }
    const stopSelf = () => {
      try {
        source.stop()
      } catch {
        // 未开始或已停止则忽略
      }
      finish(false)
    }
    stopCurrent = stopSelf
    source.onended = () => finish(token === playToken)

    setPlaying(true)
    try {
      source.start()
    } catch {
      finish(false)
    }
  })
}

/** 播放一段音频：优先 Web Audio，失败退回 <audio>；返回是否自然播完 */
async function playBlob(blob: Blob, token: number): Promise<boolean> {
  const viaWebAudio = await playViaWebAudio(blob, token)
  if (viaWebAudio !== null) return viaWebAudio
  return playViaElement(blob, token)
}

/** 所有语音后端都不可用时给一次轻提示，避免静默失败 */
let lastHintAt = 0
function notifyTtsUnavailable() {
  failureListeners.forEach((listener) => listener())
  if (!hasWindow() || Date.now() - lastHintAt < 8000) return
  lastHintAt = Date.now()
  const hint = document.createElement('div')
  hint.textContent = '语音暂时无法播放，请稍后再试'
  hint.setAttribute('role', 'status')
  hint.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:36px',
    'transform:translateX(-50%)',
    'z-index:9999',
    'padding:8px 16px',
    'border-radius:999px',
    'background:rgba(17,24,39,.82)',
    'color:#fff',
    'font-size:14px',
    'line-height:1.4',
    'pointer-events:none',
    'transition:opacity .3s',
  ].join(';')
  document.body.appendChild(hint)
  window.setTimeout(() => {
    hint.style.opacity = '0'
  }, 2400)
  window.setTimeout(() => hint.remove(), 2800)
}

async function runLine(text: string, lang: Lang, rate: number, token: number): Promise<boolean> {
  const blob = await loadAudio(text, lang, rate)
  if (token !== playToken) return false
  // 拿不到音频也当作已播完，保证「听完才能打卡」之类的流程不被卡死
  if (!blob) {
    notifyTtsUnavailable()
    return true
  }
  const ok = await playBlob(blob, token)
  if (!ok && token === playToken) {
    notifyTtsUnavailable()
    return true
  }
  return ok
}

function playNow(request: SpeakRequest) {
  const token = ++playToken
  currentText = request.text
  lastStartAt = Date.now()
  void runLine(request.text, request.lang, request.rate, token).then((ok) => {
    if (ok && token === playToken) request.onEnd?.()
  })
}

function playLinesNow(lines: string[], onEnd?: () => void) {
  const token = ++playToken
  currentText = ''
  lastStartAt = Date.now()
  void (async () => {
    for (const line of lines) {
      if (token !== playToken) return
      const ok = await runLine(line, 'zh', LINE_RATE, token)
      if (!ok) return
    }
    if (token === playToken) onEnd?.()
  })()
}

function isSameTextActive(text: string): boolean {
  return playing && currentText === text && Date.now() - lastStartAt < SAME_TEXT_COOLDOWN
}

/** 单句播报：120ms 内的连续点击合并为最后一次，避免互相取消 */
function requestSpeak(request: SpeakRequest) {
  if (!hasWindow() || !request.text.trim()) return
  applyAudioSession()
  if (!unlocked) {
    waitingRequest = request
    waitingLines = null
    unlockTtsAudio()
    return
  }
  if (isSameTextActive(request.text)) {
    // 重复点击同一句时立即回调，避免调用方的 await 永远悬着
    request.onEnd?.()
    return
  }
  pendingRequest = request
  if (pendingTimer !== null) window.clearTimeout(pendingTimer)
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null
    const next = pendingRequest
    pendingRequest = null
    if (next) playNow(next)
  }, 120)
}

/** 朗读中文；onEnd 在自然播完时触发 */
export function speakChinese(text: string, onEnd?: () => void) {
  requestSpeak({ text, lang: 'zh', rate: 0.8, onEnd })
}

// ── Promise 版播报：await 到语音真正播完，供「音落才切题」的流程使用 ──

let speechGen = 0
const pendingSpeakResolvers = new Map<number, () => void>()

/** 新语音开始时，让更早的 await 立即结束，避免旧流程卡在半路 */
function resolveSupersededSpeaks(gen: number) {
  for (const [key, resolve] of pendingSpeakResolvers) {
    if (key < gen) {
      pendingSpeakResolvers.delete(key)
      resolve()
    }
  }
}

/** 停播/卸载时释放所有等待中的 await，避免永久挂起 */
function resolveAllSpeakPromises() {
  for (const resolve of pendingSpeakResolvers.values()) resolve()
  pendingSpeakResolvers.clear()
}

/** 按字数粗估最长播放时长：语音异常无回调时兜底 resolve */
function estimateSpeakMs(text: string) {
  return Math.min(12000, Math.max(2500, text.length * 350 + 2000))
}

/** 异步播报：resolve 时机 = 音频自然播完 / 被新语音取代 / 兜底超时 */
function speakAsync(request: SpeakRequest): Promise<void> {
  if (!hasWindow() || !request.text.trim()) return Promise.resolve()
  const gen = ++speechGen
  resolveSupersededSpeaks(gen)
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      pendingSpeakResolvers.delete(gen)
      if (hasWindow()) window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, estimateSpeakMs(request.text))
    pendingSpeakResolvers.set(gen, finish)
    requestSpeak({ ...request, onEnd: finish })
  })
}

/** 朗读中文并等待播完 */
export function speakChineseAsync(text: string, rate = 0.8): Promise<void> {
  return speakAsync({ text, lang: 'zh', rate })
}

/** 朗读英文并等待播完 */
export function speakEnglishAsync(text: string, rate = 0.85): Promise<void> {
  return speakAsync({ text, lang: 'en', rate })
}

/** 逐句朗读并等待全部播完 */
export function speakLinesAsync(lines: string[]): Promise<void> {
  if (!hasWindow()) return Promise.resolve()
  const cleaned = lines.filter((line) => line.trim())
  if (cleaned.length === 0) return Promise.resolve()
  const gen = ++speechGen
  resolveSupersededSpeaks(gen)
  return new Promise<void>((resolve) => {
    let done = false
    const total = cleaned.join('')
    const finish = () => {
      if (done) return
      done = true
      pendingSpeakResolvers.delete(gen)
      if (hasWindow()) window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, estimateSpeakMs(total))
    pendingSpeakResolvers.set(gen, finish)
    speakLines(cleaned, finish)
  })
}

/** 朗读英文，使用腾讯云的英文音色；onEnd 在自然播完时触发 */
export function speakEnglish(text: string, rate = 0.85, onEnd?: () => void) {
  requestSpeak({ text, lang: 'en', rate, onEnd })
}

/**
 * 依次朗读多段文本，用于古诗逐句跟读。
 * 注意不能逐句调用 speakChinese —— 它会打断上一句。
 */
export function speakLines(lines: string[], onEnd?: () => void) {
  if (!hasWindow()) return
  const cleaned = lines.filter((line) => line.trim())
  if (cleaned.length === 0) {
    onEnd?.()
    return
  }
  applyAudioSession()
  if (!unlocked) {
    waitingLines = { lines: cleaned, onEnd }
    waitingRequest = null
    unlockTtsAudio()
    return
  }
  waitingLines = null
  playLinesNow(cleaned, onEnd)
}

/** 立即停止当前及排队中的语音播报 */
export function stopSpeak() {
  playToken += 1
  resolveAllSpeakPromises()
  waitingRequest = null
  waitingLines = null
  pendingRequest = null
  currentText = ''
  if (pendingTimer !== null && hasWindow()) {
    window.clearTimeout(pendingTimer)
    pendingTimer = null
  }

  const stopper = stopCurrent
  stopCurrent = null
  stopper?.()

  if (audioEl) {
    audioEl.onended = null
    audioEl.onerror = null
    audioEl.pause()
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
  setPlaying(false)
}

/**
 * 朗读单个汉字：有组词表时读「我，我们的我」；没有则读「字，拼音」。
 * 词表见 lib/literacy-words.ts
 */
export function speakChar(char: string, pinyin?: string | null) {
  const word = WORD_EXAMPLES[char]
  if (word) {
    speakChinese(`${char}，${word}的${char}`)
  } else if (pinyin) {
    speakChinese(`${char}，${pinyin}`)
  } else {
    speakChinese(char)
  }
}

/** 首次用户交互后解锁音频，并补播进入页面时被拦截的内容 */
function markInteracted() {
  applyAudioSession()
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  if (unlocked) return
  unlockTtsAudio()
}

/** 从后台切回前台时，iOS 可能把 AudioContext 挂起，这里主动恢复 */
function handleResume() {
  applyAudioSession()
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
}

if (typeof window !== 'undefined') {
  // 页面此前已经发生过交互时，直接尝试解锁（部分浏览器允许）
  if (hasStickyActivation()) unlockTtsAudio()
  window.addEventListener('pointerdown', markInteracted, true)
  window.addEventListener('mousedown', markInteracted, true)
  window.addEventListener('touchstart', markInteracted, true)
  window.addEventListener('keydown', markInteracted, true)
  window.addEventListener('click', markInteracted, true)
  window.addEventListener('pageshow', handleResume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handleResume()
  })
}
