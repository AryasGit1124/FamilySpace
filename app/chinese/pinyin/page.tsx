'use client'

import { useEffect, useState } from 'react'
import { Dices, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { fetchSubjectIdByName } from '@/lib/supabase-queries'
import { speakChinese } from '@/lib/tts'
import { cn } from '@/lib/utils'

/** 声母：字母 → 教学发音（TTS 读对应汉字更接近课堂发音） */
const INITIALS: { letter: string; sound: string }[] = [
  { letter: 'b', sound: '播' }, { letter: 'p', sound: '坡' }, { letter: 'm', sound: '摸' }, { letter: 'f', sound: '佛' },
  { letter: 'd', sound: '得' }, { letter: 't', sound: '特' }, { letter: 'n', sound: '讷' }, { letter: 'l', sound: '勒' },
  { letter: 'g', sound: '哥' }, { letter: 'k', sound: '科' }, { letter: 'h', sound: '喝' },
  { letter: 'j', sound: '基' }, { letter: 'q', sound: '七' }, { letter: 'x', sound: '西' },
  { letter: 'zh', sound: '知' }, { letter: 'ch', sound: '吃' }, { letter: 'sh', sound: '诗' }, { letter: 'r', sound: '日' },
  { letter: 'z', sound: '资' }, { letter: 'c', sound: '次' }, { letter: 's', sound: '思' },
  { letter: 'y', sound: '衣' }, { letter: 'w', sound: '屋' },
]

/** 韵母 */
const FINALS: { letter: string; sound: string }[] = [
  { letter: 'a', sound: '啊' }, { letter: 'o', sound: '喔' }, { letter: 'e', sound: '鹅' },
  { letter: 'i', sound: '衣' }, { letter: 'u', sound: '乌' }, { letter: 'ü', sound: '鱼' },
  { letter: 'ai', sound: '哀' }, { letter: 'ei', sound: '诶' }, { letter: 'ui', sound: '威' },
  { letter: 'ao', sound: '凹' }, { letter: 'ou', sound: '欧' }, { letter: 'iu', sound: '优' },
  { letter: 'ie', sound: '耶' }, { letter: 'üe', sound: '约' }, { letter: 'er', sound: '儿' },
  { letter: 'an', sound: '安' }, { letter: 'en', sound: '恩' }, { letter: 'in', sound: '因' },
  { letter: 'un', sound: '温' }, { letter: 'ün', sound: '晕' },
  { letter: 'ang', sound: '昂' }, { letter: 'eng', sound: '鞥' }, { letter: 'ing', sound: '英' }, { letter: 'ong', sound: '轰' },
]

/** 拼读练习：声母 + 韵母 → 音节，TTS 读示例字 */
const SYLLABLES: { initial: string; final: string; syllable: string; example: string }[] = [
  { initial: 'b', final: 'a', syllable: 'ba', example: '八' }, { initial: 'b', final: 'o', syllable: 'bo', example: '波' },
  { initial: 'b', final: 'i', syllable: 'bi', example: '笔' }, { initial: 'b', final: 'u', syllable: 'bu', example: '不' },
  { initial: 'p', final: 'a', syllable: 'pa', example: '爬' }, { initial: 'p', final: 'o', syllable: 'po', example: '坡' },
  { initial: 'p', final: 'i', syllable: 'pi', example: '皮' }, { initial: 'p', final: 'u', syllable: 'pu', example: '普' },
  { initial: 'm', final: 'a', syllable: 'ma', example: '妈' }, { initial: 'm', final: 'o', syllable: 'mo', example: '摸' },
  { initial: 'm', final: 'i', syllable: 'mi', example: '米' }, { initial: 'm', final: 'u', syllable: 'mu', example: '木' },
  { initial: 'f', final: 'a', syllable: 'fa', example: '发' }, { initial: 'f', final: 'u', syllable: 'fu', example: '父' },
  { initial: 'd', final: 'a', syllable: 'da', example: '大' }, { initial: 'd', final: 'e', syllable: 'de', example: '得' },
  { initial: 'd', final: 'i', syllable: 'di', example: '弟' }, { initial: 'd', final: 'u', syllable: 'du', example: '读' },
  { initial: 't', final: 'a', syllable: 'ta', example: '他' }, { initial: 't', final: 'e', syllable: 'te', example: '特' },
  { initial: 't', final: 'i', syllable: 'ti', example: '题' }, { initial: 't', final: 'u', syllable: 'tu', example: '图' },
  { initial: 'n', final: 'a', syllable: 'na', example: '拿' }, { initial: 'n', final: 'i', syllable: 'ni', example: '你' },
  { initial: 'n', final: 'u', syllable: 'nu', example: '努' }, { initial: 'l', final: 'a', syllable: 'la', example: '拉' },
  { initial: 'l', final: 'e', syllable: 'le', example: '乐' }, { initial: 'l', final: 'i', syllable: 'li', example: '里' },
  { initial: 'l', final: 'u', syllable: 'lu', example: '路' }, { initial: 'g', final: 'a', syllable: 'ga', example: '嘎' },
  { initial: 'g', final: 'e', syllable: 'ge', example: '哥' }, { initial: 'g', final: 'u', syllable: 'gu', example: '古' },
  { initial: 'k', final: 'a', syllable: 'ka', example: '卡' }, { initial: 'k', final: 'e', syllable: 'ke', example: '可' },
  { initial: 'k', final: 'u', syllable: 'ku', example: '苦' }, { initial: 'h', final: 'a', syllable: 'ha', example: '哈' },
  { initial: 'h', final: 'e', syllable: 'he', example: '河' }, { initial: 'h', final: 'u', syllable: 'hu', example: '虎' },
  { initial: 'j', final: 'i', syllable: 'ji', example: '鸡' }, { initial: 'j', final: 'u', syllable: 'ju', example: '居' },
  { initial: 'q', final: 'i', syllable: 'qi', example: '七' }, { initial: 'q', final: 'u', syllable: 'qu', example: '去' },
  { initial: 'x', final: 'i', syllable: 'xi', example: '西' }, { initial: 'x', final: 'u', syllable: 'xu', example: '许' },
  { initial: 'z', final: 'a', syllable: 'za', example: '杂' }, { initial: 'z', final: 'u', syllable: 'zu', example: '足' },
  { initial: 'c', final: 'a', syllable: 'ca', example: '擦' }, { initial: 'c', final: 'u', syllable: 'cu', example: '粗' },
  { initial: 's', final: 'a', syllable: 'sa', example: '洒' }, { initial: 's', final: 'u', syllable: 'su', example: '苏' },
  { initial: 'zh', final: 'a', syllable: 'zha', example: '扎' }, { initial: 'zh', final: 'e', syllable: 'zhe', example: '这' },
  { initial: 'zh', final: 'u', syllable: 'zhu', example: '猪' }, { initial: 'ch', final: 'a', syllable: 'cha', example: '茶' },
  { initial: 'ch', final: 'u', syllable: 'chu', example: '出' }, { initial: 'sh', final: 'a', syllable: 'sha', example: '沙' },
  { initial: 'sh', final: 'u', syllable: 'shu', example: '书' }, { initial: 'r', final: 'e', syllable: 're', example: '热' },
  { initial: 'r', final: 'u', syllable: 'ru', example: '入' }, { initial: 'y', final: 'a', syllable: 'ya', example: '鸭' },
  { initial: 'y', final: 'i', syllable: 'yi', example: '一' }, { initial: 'y', final: 'u', syllable: 'yu', example: '鱼' },
  { initial: 'w', final: 'a', syllable: 'wa', example: '蛙' }, { initial: 'w', final: 'u', syllable: 'wu', example: '五' },
]

const TABS = [
  { key: 'initial', label: '声母', data: INITIALS },
  { key: 'final', label: '韵母', data: FINALS },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function PinyinPage() {
  const [tab, setTab] = useState<TabKey>('initial')
  // 首屏用固定项保证 SSR 与客户端一致，挂载后再随机
  const [pair, setPair] = useState(() => SYLLABLES[0])
  const [backHref, setBackHref] = useState<string | undefined>(undefined)

  useEffect(() => {
    setPair(SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)])

    /** 取得语文学科 id，用于返回学科主页 */
    fetchSubjectIdByName('语文')
      .then((id) => setBackHref(id ? `/subject/${id}` : undefined))
      .catch((err: unknown) => {
        console.error('[Pinyin] 获取语文学科失败:', err)
      })
  }, [])

  const current = TABS.find((t) => t.key === tab)!

  const shufflePair = () => {
    setPair((prev) => {
      let next = prev
      // 避免连续两次相同
      while (next === prev && SYLLABLES.length > 1) {
        next = SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)]
      }
      return next
    })
  }

  /** 拼读带读：音节 → 声母 → 韵母 → 音节（如 fa → 「发，佛，啊，发」） */
  const speakSyllable = () => {
    const initialSound = INITIALS.find((i) => i.letter === pair.initial)?.sound ?? pair.initial
    const finalSound = FINALS.find((f) => f.letter === pair.final)?.sound ?? pair.final
    speakChinese(`${pair.example}，${initialSound}，${finalSound}，${pair.example}`)
  }

  return (
    <>
      <PageHeader
        title="拼音乐园"
        subtitle="点一点字母，听一听发音"
        backHref={backHref}
        backLabel="返回语文"
      />
      <div className="flex flex-col gap-5 px-5 pb-6">
        {/* 声母 / 韵母 Tab */}
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cn(
                'h-10 flex-1 rounded-xl text-sm font-semibold transition-colors',
                tab === t.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              )}
            >
              {t.label}（{t.data.length}）
            </button>
          ))}
        </div>

        {/* 字母点读网格 */}
        <ul className="grid grid-cols-4 gap-2">
          {current.data.map((p) => (
            <li key={p.letter}>
              <button
                type="button"
                onClick={() => speakChinese(p.sound)}
                aria-label={`拼音 ${p.letter}，读音 ${p.sound}`}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl border bg-card transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="text-2xl font-bold">{p.letter}</span>
                <span className="text-xs text-muted-foreground">{p.sound}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* 拼读小练习 */}
        <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <h2 className="text-base font-bold">拼读小练习</h2>
          <div className="flex items-center justify-center gap-3 text-4xl font-bold">
            <button
              type="button"
              onClick={() => speakChinese(INITIALS.find((i) => i.letter === pair.initial)?.sound ?? pair.initial)}
              className="flex size-16 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 transition-colors hover:bg-sky-500/20"
              aria-label={`声母 ${pair.initial}`}
            >
              {pair.initial}
            </button>
            <span className="text-muted-foreground">+</span>
            <button
              type="button"
              onClick={() => speakChinese(FINALS.find((f) => f.letter === pair.final)?.sound ?? pair.final)}
              className="flex size-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 transition-colors hover:bg-amber-500/20"
              aria-label={`韵母 ${pair.final}`}
            >
              {pair.final}
            </button>
            <span className="text-muted-foreground">=</span>
            <button
              type="button"
              onClick={speakSyllable}
              className="flex h-16 min-w-16 items-center justify-center rounded-2xl bg-emerald-500/10 px-3 text-emerald-700 transition-colors hover:bg-emerald-500/20"
              aria-label={`拼读 ${pair.syllable}`}
            >
              {pair.syllable}
            </button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            点声母、韵母分别听发音，点 {pair.syllable} 听带读（{pair.example} → {pair.initial} → {pair.final} → {pair.example}）
          </p>
          <div className="flex gap-3">
            <Button className="flex-1" onClick={speakSyllable}>
              <Volume2 className="size-4" aria-hidden="true" />
              播放拼读
            </Button>
            <Button variant="outline" onClick={shufflePair}>
              <Dices className="size-4" aria-hidden="true" />
              换一组
            </Button>
          </div>
        </section>
      </div>
    </>
  )
}
