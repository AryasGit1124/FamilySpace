import { NextResponse } from 'next/server'
import { fetchMasteredChars } from '@/lib/supabase-queries'

/** 运行在 Node 运行时，保证能读取 process.env 中的 AI 配置 */
export const runtime = 'nodejs'

/** 少于这个字数就不生成故事 */
const MIN_CHARS = 20

/** 去掉 AI 可能包裹的 ``` 代码块 */
function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:[a-z]+)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
}

/** 找出故事里不在已认识字表中的汉字（标点、数字不算） */
function findOutOfBounds(story: string, allowed: Set<string>) {
  const cjk = story.match(/[\u4e00-\u9fa5]/g) ?? []
  const bad = new Set<string>()
  for (const char of cjk) {
    if (!allowed.has(char)) bad.add(char)
  }
  return Array.from(bad)
}

/** 调一次 AI，返回故事正文 */
async function requestStory(prompt: string) {
  const apiKey = process.env.AI_API_KEY
  const apiUrl = process.env.AI_API_URL
  if (!apiKey || !apiUrl) {
    throw new Error('服务端未配置 AI_API_KEY 或 AI_API_URL，请在 .env.local 中补充后重启 dev server')
  }

  const endpoint = apiUrl.includes('/chat/completions')
    ? apiUrl
    : `${apiUrl.replace(/\/+$/, '')}/chat/completions`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是儿童作家，只输出故事正文，不要任何解释或 Markdown 标记。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('[generate-story] AI 接口返回异常:', response.status, detail)
    throw new Error(`AI 接口调用失败（HTTP ${response.status}）`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 接口未返回内容')
  }
  return stripCodeFence(content)
}

export async function POST(req: Request) {
  // 可选 body：{ extraChars: string[] } —— 今天刚学的新字也允许出现在故事里
  let extraChars: string[] = []
  try {
    const body: unknown = await req.json()
    if (body && typeof body === 'object' && Array.isArray((body as { extraChars?: unknown }).extraChars)) {
      extraChars = ((body as { extraChars: unknown[] }).extraChars)
        .filter((c): c is string => typeof c === 'string' && /^[\u4e00-\u9fa5]$/.test(c))
    }
  } catch {
    // 无 body（如 /games/story 页面的调用）：仅用已认识的字
  }

  // 1. 取已认识的字
  let mastered: string[]
  try {
    mastered = await fetchMasteredChars()
  } catch (err) {
    console.error('[generate-story] 查询 child_mastery 失败:', err)
    return NextResponse.json(
      { error: '查询已认识的字失败', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }

  // 允许用字 = 已认识 + 今天新学
  const charList = Array.from(new Set([...mastered, ...extraChars]))

  if (charList.length < MIN_CHARS) {
    return NextResponse.json(
      {
        error: `可用的字不足 ${MIN_CHARS} 个（当前 ${charList.length} 个），先去识字测试积累一些吧`,
        masteredCount: charList.length,
      },
      { status: 400 },
    )
  }

  const allowed = new Set(charList)
  const prompt = `你是儿童作家，请用以下汉字写一个3-5句话的温暖小故事，**只能使用以下汉字：${charList.join('')}**，不允许出现其他字。只输出故事正文。`

  // 2. 生成 + 超纲字检查（最多重试一次）
  try {
    let story = await requestStory(prompt)
    let outOfBounds = findOutOfBounds(story, allowed)

    if (outOfBounds.length > 0) {
      console.warn('[generate-story] 首次生成出现超纲字，重试一次:', outOfBounds.join(''))
      story = await requestStory(`${prompt}\n注意：上次出现了这些超纲字（${outOfBounds.join('')}），这次绝对不要使用。`)
      outOfBounds = findOutOfBounds(story, allowed)
    }

    return NextResponse.json({
      story: story.trim(),
      masteredCount: mastered.length,
      outOfBounds,
    })
  } catch (err) {
    console.error('[generate-story] 生成失败:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '生成故事失败，请稍后重试' },
      { status: 500 },
    )
  }
}
