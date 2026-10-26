/** 学科游戏统一的语音播报：纯 ASCII 文本用英文发音，其余用中文；播报前打断旧语音 */
import { speakChinese, speakChineseAsync, speakEnglish, speakEnglishAsync, stopSpeak } from '@/lib/tts'

export function speakByContent(text: string) {
  if (!text.trim()) return
  stopSpeak()
  if (/^[\x00-\x7F\s]+$/.test(text)) speakEnglish(text)
  else speakChinese(text)
}

/** 与 speakByContent 同规则，但返回 Promise，播报完毕后才 resolve */
export function speakByContentAsync(text: string): Promise<void> {
  if (!text.trim()) return Promise.resolve()
  stopSpeak()
  return /^[\x00-\x7F\s]+$/.test(text) ? speakEnglishAsync(text) : speakChineseAsync(text)
}
