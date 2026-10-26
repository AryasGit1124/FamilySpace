import { NextResponse } from 'next/server'
import { fetchMasteredChars } from '@/lib/supabase-queries'

/** 运行在 Node 运行时，保证能读取 process.env 中的 AI 配置 */
export const runtime = 'nodejs'

/** 默认主题：前端没传时兜底 */
const DEFAULT_TOPIC = '小动物的一天'

/** 去掉 AI 可能包裹的 ``` 代码块 */
function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:[a-z]+)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
}

type StoryQuiz = { question: string; options: string[]; answer: string }

/** 解析 AI 返回的 JSON：{ story, quiz? }，解析失败时把整段文本当故事兜底 */
function parseStoryJson(raw: string): { story: string; quiz: StoryQuiz | null } {
  const text = stripCodeFence(raw)
  const candidates = [text]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (!parsed || typeof parsed !== 'object') continue
      const obj = parsed as { story?: unknown; quiz?: unknown }
      if (typeof obj.story !== 'string' || !obj.story.trim()) continue
      return { story: obj.story.trim(), quiz: normalizeQuiz(obj.quiz) }
    } catch {
      // 换下一个候选
    }
  }
  return { story: text, quiz: null }
}

/** 校验题目结构：3 个选项、答案必须在选项内，否则丢弃题目 */
function normalizeQuiz(value: unknown): StoryQuiz | null {
  if (!value || typeof value !== 'object') return null
  const q = value as { question?: unknown; options?: unknown; answer?: unknown }
  if (typeof q.question !== 'string' || !q.question.trim()) return null
  if (!Array.isArray(q.options)) return null
  const options = q.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
  if (options.length < 2) return null
  if (typeof q.answer !== 'string' || !options.includes(q.answer)) return null
  return { question: q.question.trim(), options, answer: q.answer }
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
        {
          role: 'system',
          content:
            '你是一位资深幼儿绘本作家。故事必须符合生活常识与逻辑，量词准确（如"一只鸟""一辆车"），句子通顺连贯。你只输出一个合法的 JSON 对象，不要 Markdown 代码块、不要标题或额外解释。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      top_p: 0.9,
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
  // body 可选：{ topic?: string, extraChars?: string[] }
  // topic 为家长/孩子选定的故事主题；extraChars 为今天刚学的新字
  let topic = DEFAULT_TOPIC
  let extraChars: string[] = []
  try {
    const body: unknown = await req.json()
    if (body && typeof body === 'object') {
      const rawTopic = (body as { topic?: unknown }).topic
      if (typeof rawTopic === 'string' && rawTopic.trim()) {
        topic = rawTopic.trim().slice(0, 30)
      }
      const rawExtra = (body as { extraChars?: unknown }).extraChars
      if (Array.isArray(rawExtra)) {
        extraChars = rawExtra.filter(
          (c): c is string => typeof c === 'string' && /^[\u4e00-\u9fa5]$/.test(c),
        )
      }
    }
  } catch {
    // 无 body（如 /games/story 页面的调用）：用默认主题
  }

  // 取已认识的字，仅作为「尽量融入」的提示，不再限制只能用这些字
  let mastered: string[] = []
  try {
    mastered = await fetchMasteredChars()
  } catch (err) {
    console.error('[generate-story] 查询 child_mastery 失败:', err)
  }

  const knownChars = Array.from(new Set([...mastered, ...extraChars]))
  const knownHint =
    knownChars.length > 0
      ? `请优先使用以下孩子已经认识的字：${knownChars.join('')}。如果必须使用超纲字，只能用常见的名词或动词。`
      : '请尽量使用简单、常见的汉字（常见名词或动词）。'

  const prompt = `你是一个资深的 4 岁儿童绘本作家。
请针对主题【${topic}】写一个 60-80 字的故事。字数必须严格控制在 60-80 字之间（含标点），少于 60 字或超过 80 字都算不合格，请数着字写。

严格要求：
1. 必须符合生活常识和逻辑：句子要通顺，量词要准确（比如"一只鸟""一辆车"），绝不能出现"一辆鸟"这种荒谬搭配，也不能出现动物做不出来的行为。
2. 情节连贯：要有起因、经过、结果。主角遇到问题后必须有解决的过程，句子之间是因果推进，不是互不相关的短句。
3. 词汇自然：${knownHint}但如果为了故事的通顺和逻辑必须使用超纲字，请毫不犹豫地使用，不要为了凑字写出病句。
4. 结尾用一句简单的话总结寓意（如"好朋友要互相帮助"）。

只输出下面的 JSON（不要 Markdown 代码块、不要标题或额外解释）：
{"story":"故事正文","quiz":{"question":"问题","options":["选项1","选项2","选项3"],"answer":"选项1"}}
quiz 的 question 必须能由 story 回答；options 固定 3 个短选项；answer 必须与某个选项写法完全一致。`

  try {
    const raw = await requestStory(prompt)
    const { story, quiz } = parseStoryJson(raw)
    if (!story.trim()) throw new Error('AI 未返回可用的故事内容')
    return NextResponse.json({
      story,
      quiz,
      topic,
      masteredCount: mastered.length,
    })
  } catch (err) {
    console.error('[generate-story] 生成失败:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '生成故事失败，请稍后重试' },
      { status: 500 },
    )
  }
}
