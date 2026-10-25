import {
  AudioLines,
  BookOpen,
  BookOpenText,
  Brain,
  Calculator,
  Languages,
  Map,
  Puzzle,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'

/**
 * 学科内置子模块注册表。
 * 进入对应学科页时会自动补建同名线上任务（幂等），
 * 从而让子模块出现在学科页列表和设置页任务列表里，无需手动插库。
 */
export type SubjectModule = {
  /** 按 subjects.name 匹配学科 */
  subjectName: string
  /** 任务标题（幂等键：同学科同标题只建一次） */
  title: string
  /** 模块入口路由（整模块路径，不接任务 id） */
  gameRoute: string
  /** 学科页入口卡片的副标题 */
  desc: string
  icon: LucideIcon
  tint: string
}

export const SUBJECT_MODULES: SubjectModule[] = [
  {
    subjectName: '语文',
    title: '识字乐园',
    gameRoute: '/chinese/literacy/daily',
    desc: '摸底测试 · 学新字 · 听音选字 · 读故事打卡',
    icon: BookOpenText,
    tint: 'bg-rose-100 text-rose-700',
  },
  {
    subjectName: '语文',
    title: '拼音乐园',
    gameRoute: '/chinese/pinyin',
    desc: '声母韵母点读 · 拼读小练习',
    icon: AudioLines,
    tint: 'bg-sky-100 text-sky-700',
  },
  {
    subjectName: '语文',
    title: '古诗诵读',
    gameRoute: '/chinese/poem',
    desc: '听古诗 · 跟读 · 排序/填空小游戏',
    icon: ScrollText,
    tint: 'bg-amber-100 text-amber-700',
  },
  {
    subjectName: '数学',
    title: '数学乐园',
    gameRoute: '/math/daily',
    desc: '每日闯关：点数 · 匹配 · 比大小 · 加减法',
    icon: Calculator,
    tint: 'bg-orange-100 text-orange-700',
  },
  {
    subjectName: '英语',
    title: '字母乐园',
    gameRoute: '/english/alphabet',
    desc: '大小写捉迷藏 · 听音选字母',
    icon: Languages,
    tint: 'bg-teal-100 text-teal-700',
  },
  {
    subjectName: '英语',
    title: '词汇视听',
    gameRoute: '/english/vocab',
    desc: '听单词，选出对应的图片',
    icon: BookOpen,
    tint: 'bg-amber-100 text-amber-700',
  },
  {
    subjectName: '英语',
    title: '自然拼读',
    gameRoute: '/english/phonics',
    desc: '看图片，选出单词的首字母',
    icon: Puzzle,
    tint: 'bg-violet-100 text-violet-700',
  },
  {
    subjectName: '思维',
    title: '思维乐园',
    gameRoute: '/thinking',
    desc: '记忆翻牌，找出相同的图案',
    icon: Brain,
    tint: 'bg-purple-100 text-purple-700',
  },
  {
    subjectName: '冒险岛',
    title: '冒险岛',
    gameRoute: '/adventure',
    desc: '闯关地图，通关逐关解锁',
    icon: Map,
    tint: 'bg-cyan-100 text-cyan-700',
  },
]
