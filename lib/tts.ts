/** 浏览器内置 TTS 的统一入口：处理语音加载、去重、防抖与首次交互解锁 */
import { WORD_EXAMPLES } from '@/lib/literacy-words'

type SpeakRequest = {
  text: string
  lang: string
  rate: number
  /** 自然播完时触发（被打断/出错不触发） */
  onEnd?: () => void
}

let cachedVoices: SpeechSynthesisVoice[] = []
let currentUtterance: SpeechSynthesisUtterance | null = null
let currentText = ''
let pendingTimer: number | null = null
let pendingRequest: SpeakRequest | null = null
let lastStartAt = 0
/** 同一句话在这段时间内的重复请求忽略，避免连点重读；超过后允许重听 */
const SAME_TEXT_COOLDOWN = 600
/** 首次用户交互前被浏览器拦截的播报，交互后补播 */
let waitingRequest: SpeakRequest | null = null
let waitingLines: string[] | null = null

function hasSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function hasStickyActivation(): boolean {
  if (typeof navigator === 'undefined') return false
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation
  return activation?.hasBeenActive ?? false
}

let interacted = hasStickyActivation()

/** 提前加载语音列表，减少首次播报等待 */
function primeVoices() {
  if (!hasSynthesis()) return
  const synth = window.speechSynthesis
  cachedVoices = synth.getVoices()
  if (cachedVoices.length > 0) return
  const refresh = () => {
    cachedVoices = synth.getVoices()
    if (cachedVoices.length > 0) synth.removeEventListener('voiceschanged', refresh)
  }
  synth.addEventListener('voiceschanged', refresh)
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const normalized = lang.toLowerCase()
  const voices = cachedVoices.length > 0 ? cachedVoices : window.speechSynthesis.getVoices()
  return (
    voices.find(
      (item) => item.lang.replace('_', '-').toLowerCase() === normalized && item.localService,
    ) ??
    voices.find((item) => item.lang.replace('_', '-').toLowerCase() === normalized) ??
    null
  )
}

function buildUtterance(request: SpeakRequest): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(request.text)
  utterance.lang = request.lang
  utterance.rate = request.rate
  const voice = pickVoice(request.lang)
  if (voice) utterance.voice = voice
  return utterance
}

function isSameTextActive(text: string): boolean {
  const synth = window.speechSynthesis
  return synth.speaking && currentText === text && Date.now() - lastStartAt < SAME_TEXT_COOLDOWN
}

function startUtterance(request: SpeakRequest) {
  if (!hasSynthesis() || !request.text.trim()) return
  const synth = window.speechSynthesis
  // 同一句正在播报且刚开始不久：忽略（连续点喇叭不会从头再读）
  if (isSameTextActive(request.text)) return
  if (synth.paused) synth.resume()
  // 只有正在播报或排队其他内容时才打断
  if (synth.speaking || synth.pending) synth.cancel()

  const utterance = buildUtterance(request)
  currentText = request.text
  currentUtterance = utterance
  lastStartAt = Date.now()
  const clear = () => {
    if (currentUtterance === utterance) {
      currentUtterance = null
      currentText = ''
    }
  }
  utterance.onend = () => {
    clear()
    request.onEnd?.()
  }
  utterance.onerror = clear
  synth.speak(utterance)
}

/** 单句播报：100ms 内的连续点击合并为最后一次，避免互相取消 */
function playSingle(request: SpeakRequest) {
  if (!hasSynthesis() || !request.text.trim()) return
  if (isSameTextActive(request.text)) return

  pendingRequest = request
  if (pendingTimer !== null) window.clearTimeout(pendingTimer)
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null
    const next = pendingRequest
    pendingRequest = null
    if (next) startUtterance(next)
  }, 100)
}

/** 多句连读：整段排队，不逐句打断 */
function playLines(lines: string[]) {
  if (!hasSynthesis()) return
  const synth = window.speechSynthesis
  const cleaned = lines.filter((line) => line.trim())
  if (cleaned.length === 0) return

  if (pendingTimer !== null) {
    window.clearTimeout(pendingTimer)
    pendingTimer = null
    pendingRequest = null
  }
  if (synth.paused) synth.resume()
  if (synth.speaking || synth.pending) synth.cancel()

  currentText = ''
  currentUtterance = null
  for (const line of cleaned) {
    synth.speak(buildUtterance({ text: line, lang: 'zh-CN', rate: 0.8 }))
  }
}

function removeUnlockListeners() {
  if (typeof window === 'undefined') return
  window.removeEventListener('pointerdown', markInteracted, true)
  window.removeEventListener('mousedown', markInteracted, true)
  window.removeEventListener('touchstart', markInteracted, true)
  window.removeEventListener('keydown', markInteracted, true)
  window.removeEventListener('click', markInteracted, true)
}

/** 首次用户交互后解锁语音，并补播进入页面时被拦截的内容 */
function markInteracted() {
  if (interacted) return
  interacted = true
  removeUnlockListeners()

  if (waitingLines) {
    const lines = waitingLines
    waitingLines = null
    playLines(lines)
  } else if (waitingRequest) {
    const request = waitingRequest
    waitingRequest = null
    playSingle(request)
  }
}

function requestSpeak(request: SpeakRequest) {
  if (!hasSynthesis() || !request.text.trim()) return
  if (!interacted) {
    waitingRequest = request
    waitingLines = null
    return
  }
  waitingRequest = null
  playSingle(request)
}

/** 用浏览器内置 TTS 朗读中文；不支持时静默返回。onEnd 在自然播完时触发 */
export function speakChinese(text: string, onEnd?: () => void) {
  requestSpeak({ text, lang: 'zh-CN', rate: 0.8, onEnd })
}

/** 立即停止当前及排队中的语音播报 */
export function stopSpeak() {
  if (!hasSynthesis()) return
  const synth = window.speechSynthesis
  if (pendingTimer !== null) {
    window.clearTimeout(pendingTimer)
    pendingTimer = null
    pendingRequest = null
  }
  waitingRequest = null
  waitingLines = null
  if (synth.speaking || synth.pending || synth.paused) synth.cancel()
}

/** 用浏览器内置 TTS 朗读英文，指定 en-US（美式发音） */
export function speakEnglish(text: string, rate = 0.85) {
  requestSpeak({ text, lang: 'en-US', rate })
}

/**
 * 依次朗读多段文本：语音队列会自动排队，用于古诗逐句跟读。
 * 注意不能逐句调用 speakChinese —— 它会打断上一句。
 */
export function speakLines(lines: string[]) {
  const cleaned = lines.filter((line) => line.trim())
  if (!hasSynthesis() || cleaned.length === 0) return
  if (!interacted) {
    waitingLines = cleaned
    waitingRequest = null
    return
  }
  waitingLines = null
  playLines(cleaned)
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

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  primeVoices()
  window.addEventListener('pointerdown', markInteracted, true)
  window.addEventListener('mousedown', markInteracted, true)
  window.addEventListener('touchstart', markInteracted, true)
  window.addEventListener('keydown', markInteracted, true)
  window.addEventListener('click', markInteracted, true)
}
