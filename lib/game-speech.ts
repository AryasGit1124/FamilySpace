/** 学科游戏统一的语音播报：纯 ASCII 文本用英文发音，其余用中文；播报前打断旧语音 */
import { speakChinese, speakEnglish, stopSpeak } from '@/lib/tts'

export function speakByContent(text: string) {
  if (!text.trim()) return
  stopSpeak()
  if (/^[\x00-\x7F\s]+$/.test(text)) speakEnglish(text)
  else speakChinese(text)
}
