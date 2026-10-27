import { NextResponse } from 'next/server'
import { requireSupabase } from '@/lib/supabase'

/** 需要 Node 运行时读取 process.env 中的 AI 配置 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 每次调用 AI 处理 10 个字 */
const BATCH_SIZE = 10
/** 单次接口最多处理多少字，避免函数超时（可多调几次直到 remaining 为 0） */
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 60

type PendingChar = {
  id: string
  char: string
  emoji: string | null
  word: string | null
  sentence: string | null
}

type AiCard = {
  char: string
  emoji: string
  word: string
  sentence: string
}

/** 去掉 AI 可能包裹的 ``` 代码块 */
function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:[a-z]+)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
}

/** 从 AI 返回文本里提取 JSON 数组（容忍前后多余说明） */
function extractJsonArray(text: string): unknown[] {
  const cleaned = stripCodeFence(text)
  try {
    const parsed: unknown = JSON.parse(cleaned)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // 落到下面的正则兜底
  }
  const match = cleaned.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed: unknown = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 只保留字段完整的条目，并按 char 去重 */
function normalizeCards(raw: unknown[]): AiCard[] {
  const out = new Map<string, AiCard>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const char = typeof row.char === 'string' ? row.char.trim() : ''
    const emoji = typeof row.emoji === 'string' ? row.emoji.trim() : ''
    const word = typeof row.word === 'string' ? row.word.trim() : ''
    const sentence = typeof row.sentence === 'string' ? row.sentence.trim() : ''
    if (!char || !emoji || !word || !sentence) continue
    out.set(char, { char, emoji, word, sentence })
  }
  return Array.from(out.values())
}

/** 调一次 DeepSeek，为一小批汉字生成 Emoji / 组词 / 语境句 */
async function requestAiCards(chars: string[]): Promise<AiCard[]> {
  const apiKey = process.env.AI_API_KEY
  const apiUrl = process.env.AI_API_URL
  if (!apiKey || !apiUrl) {
    throw new Error('服务端未配置 AI_API_KEY 或 AI_API_URL，请在 .env.local 中补充后重启 dev server')
  }

  const endpoint = apiUrl.includes('/chat/completions')
    ? apiUrl
    : `${apiUrl.replace(/\/+$/, '')}/chat/completions`

  const prompt = `你是儿童早教专家。请为以下汉字生成对应的 Emoji 图标、一个 4 岁孩子易懂的组词、以及带这个字的短句。
请严格返回 JSON 数组格式，例如：
[{"char": "四", "emoji": "🍀", "word": "四叶草", "sentence": "四季的四"}]
待处理的汉字：${chars.join('、')}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            '你是儿童早教专家，只输出 JSON 数组，不要任何解释、Markdown 标记或代码块包裹。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.6,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('[fill-chars] AI 接口返回异常:', response.status, detail)
    throw new Error(`AI 接口调用失败（HTTP ${response.status}）`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 接口未返回内容')
  }
  return normalizeCards(extractJsonArray(content))
}

/** 主流程：查缺字 → 每 10 个一批调 AI → 写回 literacy_chars */
async function fillChars(limit: number) {
  const supabase = await requireSupabase()

  // 1. 查还没配好 Emoji / 组词 / 语境句的字
  const { data, error } = await supabase
    .from('literacy_chars')
    .select('id, char, emoji, word, sentence')
    .or('emoji.is.null,emoji.eq.✨,word.is.null,sentence.is.null')
    .order('level', { ascending: true })
    .order('lesson', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[fill-chars] 查询待补字失败:', error.message)
    return NextResponse.json(
      { error: '查询待补字失败', detail: error.message },
      { status: 500 },
    )
  }

  const rows = (data ?? []) as PendingChar[]
  if (rows.length === 0) {
    return NextResponse.json({ pending: 0, updated: 0, failed: 0, remaining: 0, failures: [] })
  }

  let updated = 0
  const failures: { char: string; reason: string }[] = []

  // 2. 每 10 个字一批，循环调用 AI 并写库
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE)
    const charList = batch.map((r) => r.char)

    let cards: AiCard[] = []
    try {
      cards = await requestAiCards(charList)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[fill-chars] 批次生成失败:', charList.join(''), reason)
      failures.push({ char: charList.join(''), reason })
      continue
    }

    const cardMap = new Map(cards.map((c) => [c.char, c]))
    for (const row of batch) {
      const card = cardMap.get(row.char)
      if (!card) {
        failures.push({ char: row.char, reason: 'AI 未返回该字的完整数据' })
        continue
      }
      const { error: updateError } = await supabase
        .from('literacy_chars')
        .update({ emoji: card.emoji, word: card.word, sentence: card.sentence })
        .eq('id', row.id)
      if (updateError) {
        console.error('[fill-chars] 写入失败:', row.char, updateError.message)
        failures.push({ char: row.char, reason: updateError.message })
        continue
      }
      updated += 1
    }
  }

  // 3. 剩余的待补字数，方便前端/脚本连续调用直到 0
  const { count } = await supabase
    .from('literacy_chars')
    .select('id', { count: 'exact', head: true })
    .or('emoji.is.null,emoji.eq.✨,word.is.null,sentence.is.null')

  return NextResponse.json({
    pending: rows.length,
    updated,
    failed: failures.length,
    remaining: count ?? 0,
    failures,
  })
}

function parseLimit(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(BATCH_SIZE, Math.floor(n)))
}

/** GET /api/fill-chars?limit=30 —— 直接用默认/指定上限跑一轮 */
export async function GET(req: Request) {
  const limit = parseLimit(new URL(req.url).searchParams.get('limit'))
  try {
    return await fillChars(limit)
  } catch (err) {
    console.error('[fill-chars] 执行失败:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '填充失败' },
      { status: 500 },
    )
  }
}

/** POST /api/fill-chars  body: { limit?: number } */
export async function POST(req: Request) {
  let limit = DEFAULT_LIMIT
  try {
    const body: unknown = await req.json()
    if (body && typeof body === 'object' && 'limit' in body) {
      limit = parseLimit((body as { limit?: unknown }).limit)
    }
  } catch {
    // 无 body 时用默认上限
  }
  try {
    return await fillChars(limit)
  } catch (err) {
    console.error('[fill-chars] 执行失败:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '填充失败' },
      { status: 500 },
    )
  }
}
