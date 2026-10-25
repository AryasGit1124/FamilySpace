/**
 * 语音合成前的文本切分。
 * 腾讯云单次请求约 150 字上限，Edge TTS 也适合按句合成（首包更快、超时风险更低）。
 */

/** 单个合成片段的最大长度 */
export const MAX_CHUNK = 140

/** 单句过长时按逗号／空格断开，找不到合适的断点就硬切 */
function hardSplit(text: string, max: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(
      window.lastIndexOf('，'),
      window.lastIndexOf('、'),
      window.lastIndexOf(','),
      window.lastIndexOf(' '),
    )
    const index = cut > max * 0.4 ? cut + 1 : max
    out.push(rest.slice(0, index))
    rest = rest.slice(index)
  }
  if (rest) out.push(rest)
  return out
}

/** 按标点把长文本切成不超过 max 字的短句数组 */
export function splitTtsText(text: string, max = MAX_CHUNK): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  if (normalized.length <= max) return [normalized]

  const sentences = normalized
    .split(/(?<=[。！？；!?;\n])/)
    .map((item) => item.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (buffer) {
        chunks.push(buffer)
        buffer = ''
      }
      chunks.push(...hardSplit(sentence, max))
      continue
    }
    if ((buffer + sentence).length > max) {
      if (buffer) chunks.push(buffer)
      buffer = sentence
      continue
    }
    buffer += sentence
  }
  if (buffer) chunks.push(buffer)
  return chunks
}
