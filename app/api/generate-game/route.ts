import { NextResponse } from 'next/server'
import { insertGameTask } from '@/lib/supabase-queries'
import { parseDynamicGame } from '@/lib/dynamic-game'

/** 运行在 Node 运行时，保证能读取 process.env 中的 AI 配置 */
export const runtime = 'nodejs'

/** 生成的小游戏在前端的统一播放路由（支持多题型的动态播放器） */
const GAME_ROUTE = '/games/dynamic'

type GenerateGameBody = {
  subjectId?: string
  /** 当前学科名，如「数学」；兼容旧的 courseName 字段 */
  subjectName?: string
  courseName?: string
  age?: string | number
  difficulty?: string
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

/** 用户输入里出现这些词时，明确要的是故事而不是出题 */
const STORY_HINT = /故事|绘本|童话/
/** 用户输入里出现这些词时，视为「明确指定出题」 */
const QUESTION_HINT = /题|练习|测验|选择|填空|连线|排序|计算|拼音|识字|成语|单词|古诗/

/** 判断本次是否应生成 story（故事）类型 */
function wantsStory(subjectName: string, topic: string): boolean {
  if (STORY_HINT.test(topic)) return true
  // 语文学科且用户没有明确要求出题时，默认讲故事
  return subjectName.includes('语文') && !QUESTION_HINT.test(topic)
}

/** 各学科优先题型（写进 Prompt，交给模型自行选择） */
function preferredTypes(subjectName: string): string {
  if (subjectName.includes('数学') || subjectName.includes('思维')) {
    return '优先使用 sequence（排序）或 fill（填空）'
  }
  if (subjectName.includes('英语')) return '优先使用 matching（连线）或 choice（选择）'
  if (subjectName.includes('语文')) {
    return '优先使用 choice（选择）或 fill（填空）；若主题偏故事、阅读，则使用 story（故事）'
  }
  return '优先使用 choice（选择）'
}

function buildPrompt(params: {
  age: string
  subjectName: string
  topic: string
  difficulty: string
  story: boolean
}) {
  const { age, subjectName, topic, difficulty, story } = params

  const typeRule = story
    ? `本次必须返回 story（故事）类型：请基于用户输入的主题「${topic}」，用简单的词汇写一段 3-5 句话的温馨儿童故事。请将故事按句子拆分成数组，存入 data 中。`
    : `${preferredTypes(subjectName)}；如果用户输入包含「故事」「绘本」「童话」等字眼，改用 story（故事）类型。`

  return `你现在是一位针对 ${age} 岁儿童的 ${subjectName} 老师。请根据这个年龄段孩子的认知水平，围绕主题「${topic}」生成内容。
难度要求：${difficulty}。
题型要求：${typeRule}
必须只返回 JSON，不要 Markdown 标记、代码块或任何额外说明。

JSON 结构必须严格如下：
{
  "title": "游戏标题",
  "type": "choice" | "matching" | "sequence" | "fill" | "story",
  "difficulty": "根据年龄推荐的难度，如 4岁-初级",
  "data": []
}

各题型的 data 结构：
- choice（选择题，适合全学科）：[{ "question": "题目文字", "options": ["A","B","C"], "answer": "A" }]
- matching（连线题，适合英语、语文）：[{ "left": "Apple", "right": "苹果" }, { "left": "Dog", "right": "狗" }]
- sequence（排序题，适合数学、思维、古诗）：[{ "sequence": ["1","2","3","4"], "scrambled": ["3","1","4","2"] }]
- fill（填空题，适合数学、语文）：[{ "text": "2 + 3 = __", "answer": "5", "options": ["4","5","6"] }]
- story（故事，适合语文或故事类主题）：[{ "content": "第一句故事内容。" }, { "content": "第二句故事内容。" }]

要求：
1. 整份内容只选一种题型：出题时 data 为 3-5 条题目，story 时 data 为 3-5 句故事；
2. choice / fill 每题 3 个选项，answer 必须是 options 中的某一项原文；
3. matching 每条的 left 与 right 一一对应，共 3-5 对；
4. sequence 的 scrambled 必须是 sequence 的乱序排列，长度一致；
5. story 的 data 按句子拆分，每条只有 content 字段，句子顺序即故事顺序；
6. 只输出上述 JSON 对象本身。`
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

  const subjectId = body.subjectId?.toString().trim()
  const subjectName = (body.subjectName ?? body.courseName)?.toString().trim()
  const rawAge = body.age?.toString().trim()
  const difficulty = body.difficulty?.toString().trim() || '初级'
  // 知识点可选，未填时用学科名兜底，保证 Prompt 不为空
  const topic = body.topic?.toString().trim() || subjectName

  if (!subjectId || !subjectName || !rawAge) {
    return NextResponse.json(
      { error: '缺少必填参数：subjectId、subjectName、age' },
      { status: 400 },
    )
  }

  // 允许前端传 "4" 或 "4岁"，统一补上「岁」
  const age = /^\d+$/.test(rawAge) ? `${rawAge}岁` : rawAge
  const fallbackDifficulty = `${age}-${difficulty}`

  const finalTopic = topic || subjectName
  const story = wantsStory(subjectName, finalTopic)
  const prompt = buildPrompt({ age, subjectName, topic: finalTopic, difficulty, story })

  // 2. 拼装 OpenAI 兼容的 chat/completions 地址
  // AI_API_URL 既可以填基础地址（如 https://api.deepseek.com/v1），也可以填完整地址
  const endpoint = apiUrl.includes('/chat/completions')
    ? apiUrl
    : `${apiUrl.replace(/\/+$/, '')}/chat/completions`

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
          {
            role: 'system',
            content:
              '你是少儿教育专家，只输出纯 JSON，不要任何 Markdown 标记、代码块或解释文字。',
          },
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

  // 4. 解析 JSON 并校验通用协议
  const cleaned = stripCodeFence(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    console.error('[generate-game] JSON 解析失败:', err, '\n原始内容:', cleaned)
    return NextResponse.json({ error: 'AI 返回内容不是合法 JSON', raw: cleaned }, { status: 500 })
  }

  const parsedGame = parseDynamicGame(parsed, `${topic || subjectName}小游戏`)
  if (!parsedGame) {
    console.error('[generate-game] AI 返回结构不符合协议:', cleaned)
    return NextResponse.json(
      { error: 'AI 返回内容不符合游戏数据结构（type 或 data 不合法）', raw: cleaned },
      { status: 500 },
    )
  }
  // 模型没写难度时用「年龄-难度」兜底
  const game = { ...parsedGame, difficulty: parsedGame.difficulty ?? fallbackDifficulty }

  // 5. 作为一条 tasks 记录落库：type=online、format=self，game_content 存整份游戏 JSON
  try {
    const task = await insertGameTask({
      subject_id: subjectId,
      title: game.title,
      game_route: GAME_ROUTE,
      game_content: game,
    })
    return NextResponse.json({
      success: true,
      task_id: task.id,
      title: task.title,
      type: game.type,
    })
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
