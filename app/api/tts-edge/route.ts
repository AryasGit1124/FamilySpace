import { NextResponse } from 'next/server'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { splitTtsText } from '@/lib/tts-text'

/**
 * Edge TTS 合成接口：无需 API Key，直接返回 mp3 音频流。
 * 作为腾讯云 /api/tts 的备用实现，通过前端开关切换到它。
 */
export const runtime = 'nodejs'

/** 整段文本上限，避免一次请求合成过多内容 */
const MAX_TEXT = 1200

/** 中文女声（晓晓），英文女声（Aria） */
const VOICE_ZH = 'zh-CN-XiaoxiaoNeural'
const VOICE_EN = 'en-US-AriaNeural'

type TtsBody = {
  text?: string
  lang?: 'zh' | 'en'
  /** 语速倍率（调用方沿用 0.8 / 0.85 之类的写法） */
  rate?: number
}

/** 语速倍率换算成 Edge 的百分比写法，如 0.8 -> -20% */
function toRatePercent(rate?: number): string {
  if (!rate || !Number.isFinite(rate)) return '+0%'
  const percent = Math.round((rate - 1) * 100)
  return `${percent >= 0 ? '+' : ''}${percent}%`
}

/** 合成单段文本，收集完整 mp3 数据 */
function synthesize(client: MsEdgeTTS, text: string, rate: string): Promise<Buffer> {
  const { audioStream } = client.toStream(text, { rate })
  const chunks: Buffer[] = []
  return new Promise<Buffer>((resolve, reject) => {
    audioStream.on('data', (data: Buffer) => chunks.push(data))
    audioStream.once('end', () => resolve(Buffer.concat(chunks)))
    audioStream.once('error', reject)
  })
}

export async function POST(request: Request) {
  let body: TtsBody
  try {
    body = (await request.json()) as TtsBody
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'text 不能为空' }, { status: 400 })
  if (text.length > MAX_TEXT) return NextResponse.json({ error: '文本过长' }, { status: 400 })

  const voice = body.lang === 'en' ? VOICE_EN : VOICE_ZH
  const rate = toRatePercent(body.rate)
  const parts = splitTtsText(text)

  const client = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 20000 })
  try {
    await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const buffers: Buffer[] = []
    // 顺序合成，复用同一条 websocket 连接
    for (const part of parts) {
      buffers.push(await synthesize(client, part, rate))
    }

    const audio = Buffer.concat(buffers)
    if (audio.length === 0) throw new Error('返回的音频为空')

    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `Edge 语音合成失败：${detail}` }, { status: 502 })
  } finally {
    client.close()
  }
}
