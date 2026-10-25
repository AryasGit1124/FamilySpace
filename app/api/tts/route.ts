import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { tts } from 'tencentcloud-sdk-nodejs-tts'
import { splitTtsText } from '@/lib/tts-text'

/** 需要 Node 运行时：SDK 依赖 crypto，且密钥只在服务端读取 */
export const runtime = 'nodejs'

const TtsClient = tts.v20190823.Client

/** 整段文本上限，超过直接拒绝，避免一次请求合成过多内容 */
const MAX_TEXT = 1200

/** 中文儿童音色（智瑜） */
const VOICE_ZH = 101001
/** 英文音色（WeWinny），失败时回退中文音色 */
const VOICE_EN = 101051

type TtsBody = {
  text?: string
  lang?: 'zh' | 'en'
  /** 语速倍率（调用方沿用 0.8 / 0.85 之类的写法） */
  rate?: number
}

function createClient() {
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY
  if (!secretId || !secretKey) return null
  return new TtsClient({
    credential: { secretId, secretKey },
    region: 'ap-guangzhou',
    profile: {
      httpProfile: { endpoint: 'tts.tencentcloudapi.com', reqTimeout: 20 },
    },
  })
}

/** 语速倍率换算成腾讯云的整数档位（-2 慢 ~ 2 快） */
function toSpeed(rate?: number): number {
  if (!rate || !Number.isFinite(rate)) return 0
  return Math.max(-2, Math.min(2, Math.round((rate - 1) * 5)))
}

async function synthesize(
  client: InstanceType<typeof TtsClient>,
  text: string,
  voiceType: number,
  speed: number,
  primaryLanguage: number,
): Promise<Buffer> {
  const res = await client.TextToVoice({
    Text: text,
    SessionId: randomUUID(),
    VoiceType: voiceType,
    Codec: 'mp3',
    Speed: speed,
    Volume: 0,
    PrimaryLanguage: primaryLanguage,
  })
  if (!res.Audio) throw new Error('腾讯云返回的音频为空')
  return Buffer.from(res.Audio, 'base64')
}

export async function POST(request: Request) {
  const client = createClient()
  if (!client) {
    return NextResponse.json({ error: '未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY' }, { status: 500 })
  }

  let body: TtsBody
  try {
    body = (await request.json()) as TtsBody
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'text 不能为空' }, { status: 400 })
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: '文本过长' }, { status: 400 })
  }

  const lang = body.lang === 'en' ? 'en' : 'zh'
  const voiceType = lang === 'en' ? VOICE_EN : VOICE_ZH
  const primaryLanguage = lang === 'en' ? 2 : 1
  const speed = toSpeed(body.rate)
  const chunks = splitTtsText(text)

  try {
    const buffers: Buffer[] = []
    // 顺序合成，避免触发腾讯云的并发限频
    for (const chunk of chunks) {
      try {
        buffers.push(await synthesize(client, chunk, voiceType, speed, primaryLanguage))
      } catch (error) {
        // 英文音色不可用时退回中文音色，保证仍有声音
        if (voiceType !== VOICE_ZH) {
          buffers.push(await synthesize(client, chunk, VOICE_ZH, speed, 1))
        } else {
          throw error
        }
      }
    }

    const audio = Buffer.concat(buffers)
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
    return NextResponse.json({ error: `语音合成失败：${detail}` }, { status: 502 })
  }
}
