import { NextResponse } from 'next/server'
import { insertGameTask } from '@/lib/supabase-queries'

/** 运行在 Node 运行时，保证能读取 process.env 中的 AI 配置 */
export const runtime = 'nodejs'

/** 生成的小游戏在前端的统一播放路由 */
const GAME_ROUTE = '/games/ai-play'

type GenerateGameBody = {
  subjectId?: string
  courseName?: string
  age?: string
  topic?: string
}

/** 把 AI 返回里可能出现的 ```json 代码块包裹去掉，再交给 JSON.parse */
function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
}

export async function POST(request: Request) {
  const apiKey = process.env.AI_API_KEY
  const apiUrl = process.env.AI_API_URL

  if (!apiKey || !apiUrl) {
    return NextResponse.json(
      { error: '服务端未配置 AI_API_KEY 或 AI_API_URL，请在 .env.local 中补充后重启 dev server' },
      { status: 500 },
    )
  }

  // 1. 解析入参
  let body: GenerateGameBody
  try {
    body = (await request.json()) as GenerateGameBody
  } catch {
    return NextResponse.json({ error: '请求体不是合法的 JSON' }, { status: 400 })
  }

  const subjectId = body.subjectId?.trim()
  const courseName = body.courseName?.trim()
  const age = body.age?.trim()
  const topic = body.topic?.trim()

  if (!subjectId || !courseName || !age || !topic) {
    return NextResponse.json(
      { error: '缺少必填参数：subjectId、courseName、age、topic' },
      { status: 400 },
    )
  }

  // 2. 拼装 OpenAI 兼容的 chat/completions 地址
  // AI_API_URL 既可以填基础地址（如 https://api.deepseek.com/v1），也可以填完整地址
  const endpoint = apiUrl.includes('/chat/completions')
    ? apiUrl
    : `${apiUrl.replace(/\/+$/, '')}/chat/completions`

  const prompt = `你是一个少儿教育专家，请为${age}孩子生成一个关于“${topic}”的互动选择题游戏（课程：${courseName}），共 5 道题。
请严格输出以下 JSON 格式，不要输出任何 Markdown 标记、代码块或额外说明：
{
  "title": "游戏名称",
  "questions": [
    { "id": 1, "text": "题目文字", "options": ["选项A", "选项B", "选项C"], "answer": "正确选项" }
  ]
}
要求：questions 必须正好 5 道；每题 3 个选项；answer 必须是该题 options 中的某一项原文。`

  // 3. 调用 AI 接口
  let content: string
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是少儿教育专家，只输出纯 JSON，不要任何 Markdown 标记。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('[generate-game] AI 接口返回异常:', response.status, detail)
      return NextResponse.json(
        { error: `AI 接口调用失败（HTTP ${response.status}）`, detail },
        { status: 500 },
      )
    }

    const payload = await response.json()
    const message = payload?.choices?.[0]?.message?.content
    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'AI 接口未返回内容' }, { status: 500 })
    }
    content = message
  } catch (err) {
    console.error('[generate-game] 请求 AI 接口出错:', err)
    return NextResponse.json({ error: 'AI 接口请求异常，请检查 AI_API_URL 是否可访问' }, { status: 500 })
  }

  // 4. 解析 JSON，失败直接返回 500
  const cleaned = stripCodeFence(content)
  let game: Record<string, unknown>
  try {
    game = JSON.parse(cleaned) as Record<string, unknown>
  } catch (err) {
    console.error('[generate-game] JSON 解析失败:', err, '\n原始内容:', cleaned)
    return NextResponse.json(
      { error: 'AI 返回内容不是合法 JSON', raw: cleaned },
      { status: 500 },
    )
  }

  // 5. 作为一条 tasks 记录落库：type=online、format=self，game_content 存整份游戏 JSON
  const aiTitle = typeof game.title === 'string' ? game.title.trim() : ''
  const title = aiTitle || `${topic}小游戏`

  try {
    const task = await insertGameTask({
      subject_id: subjectId,
      title,
      game_route: GAME_ROUTE,
      game_content: game,
    })
    return NextResponse.json({ success: true, task_id: task.id, title: task.title })
  } catch (err) {
    console.error('[generate-game] 写入 tasks 表失败:', err)
    return NextResponse.json(
      {
        error: '写入 tasks 表失败',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
