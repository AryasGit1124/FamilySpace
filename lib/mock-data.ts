export type SubjectId = string

export type Subject = {
  id: SubjectId
  name: string
  description: string
  showInTab: boolean
  /** Supabase subjects.color (可选，mock 数据没有) */
  color?: string
  /** Supabase subjects.sort_order (可选) */
  sortOrder?: number
}

export type TaskMode = 'online' | 'offline'
export type TaskStatus = 'todo' | 'done'

export type CheckInTask = {
  id: string
  subjectId: SubjectId
  title: string
  detail: string
  mode: TaskMode
  /** 任务形式：teacher=老师上传资料类（点击跳资料库），self=自己完成打卡 */
  format?: 'teacher' | 'self'
  /** 任务对应的模块路由（如识字乐园 /chinese/literacy），孩子端点击直达 */
  gameRoute?: string
  status: TaskStatus
  inWeeklyPlan: boolean
  /** 打卡奖励星星数（临时添加的任务可自定义，缺省按 1 颗） */
  stars?: number
}

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type ScheduleEntry = {
  id: string
  subjectId: SubjectId
  /** 对应 tasks 的 id —— 用于从今日页跳转上传页时预选课程 */
  taskId?: string
  title: string
  location: string
  weekday: Weekday
  startTime: string
  endTime: string
}

export const weekdays: { value: Weekday; label: string; short: string }[] = [
  { value: 1, label: '周一', short: '一' },
  { value: 2, label: '周二', short: '二' },
  { value: 3, label: '周三', short: '三' },
  { value: 4, label: '周四', short: '四' },
  { value: 5, label: '周五', short: '五' },
  { value: 6, label: '周六', short: '六' },
  { value: 7, label: '周日', short: '日' },
]

export function getTodayWeekday(date = new Date()): Weekday {
  const day = date.getDay()
  return (day === 0 ? 7 : day) as Weekday
}

export function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, eh * 60 + em - (sh * 60 + sm))
}

export const mockSubjects: Subject[] = [
  { id: 'chinese', name: '语文', description: '阅读、古诗、写字', showInTab: true },
  { id: 'math', name: '数学', description: '口算、应用题', showInTab: true },
  { id: 'english', name: '英语', description: '听读、单词、绘本', showInTab: true },
  { id: 'thinking', name: '思维', description: '逻辑、数独、积木', showInTab: true },
  { id: 'pe', name: '体育', description: '跳绳、跑步、游泳', showInTab: true },
]

export const mockSchedule: ScheduleEntry[] = [
  { id: 's1', subjectId: 'english', title: '英语绘本精读课', location: '阳光少儿英语 · 3 号教室', weekday: 1, startTime: '16:30', endTime: '17:30' },
  { id: 's2', subjectId: 'pe', title: '游泳进阶训练', location: '市体育中心 · 室内泳池', weekday: 2, startTime: '18:30', endTime: '19:30' },
  { id: 's3', subjectId: 'math', title: '思维数学小班课', location: '启明学堂 · 201 教室', weekday: 3, startTime: '17:00', endTime: '18:00' },
  { id: 's4', subjectId: 'chinese', title: '书法硬笔课', location: '墨香书院 · 一楼', weekday: 4, startTime: '16:30', endTime: '17:30' },
  { id: 's5', subjectId: 'english', title: '英语口语外教课', location: '阳光少儿英语 · 5 号教室', weekday: 5, startTime: '18:00', endTime: '19:00' },
  { id: 's6', subjectId: 'thinking', title: '乐高机器人', location: '创客空间 · B 区', weekday: 6, startTime: '09:30', endTime: '11:00' },
  { id: 's7', subjectId: 'pe', title: '篮球兴趣班', location: '社区体育馆', weekday: 6, startTime: '15:00', endTime: '16:30' },
  { id: 's8', subjectId: 'pe', title: '游泳进阶训练', location: '市体育中心 · 室内泳池', weekday: 7, startTime: '10:00', endTime: '11:00' },
]

export const mockTasks: CheckInTask[] = [
  { id: 't1', subjectId: 'chinese', title: '朗读课文《秋天》', detail: '录音上传 · 约 10 分钟', mode: 'online', status: 'done', inWeeklyPlan: true },
  { id: 't2', subjectId: 'chinese', title: '背诵古诗《静夜思》', detail: '家长听背 · 约 5 分钟', mode: 'offline', status: 'todo', inWeeklyPlan: true },
  { id: 't9', subjectId: 'chinese', title: '练字一页', detail: '田字格本 · 约 15 分钟', mode: 'offline', status: 'todo', inWeeklyPlan: false },
  { id: 't3', subjectId: 'math', title: '口算练习 20 题', detail: '在线答题 · 约 10 分钟', mode: 'online', status: 'todo', inWeeklyPlan: true },
  { id: 't10', subjectId: 'math', title: '应用题 3 道', detail: '练习册 · 约 15 分钟', mode: 'offline', status: 'todo', inWeeklyPlan: false },
  { id: 't4', subjectId: 'english', title: '单词跟读 Unit 3', detail: 'App 跟读 · 约 8 分钟', mode: 'online', status: 'todo', inWeeklyPlan: true },
  { id: 't5', subjectId: 'english', title: '英语绘本精读课', detail: '16:30 线下签到', mode: 'offline', status: 'todo', inWeeklyPlan: true },
  { id: 't11', subjectId: 'english', title: '英文儿歌听唱', detail: '音频播放 · 约 10 分钟', mode: 'online', status: 'todo', inWeeklyPlan: false },
  { id: 't6', subjectId: 'thinking', title: '数独挑战 4×4', detail: '纸质练习册 · 约 15 分钟', mode: 'offline', status: 'done', inWeeklyPlan: true },
  { id: 't12', subjectId: 'thinking', title: '七巧板拼图', detail: '实物拼搭 · 约 10 分钟', mode: 'offline', status: 'todo', inWeeklyPlan: false },
  { id: 't7', subjectId: 'pe', title: '跳绳 300 个', detail: '视频打卡 · 约 10 分钟', mode: 'online', status: 'todo', inWeeklyPlan: true },
  { id: 't8', subjectId: 'pe', title: '游泳进阶训练', detail: '18:30 线下签到', mode: 'offline', status: 'todo', inWeeklyPlan: true },
]

export type SubjectContent = {
  id: string
  subjectId: SubjectId
  name: string
}

export type ScheduleGrid = Record<SubjectId, Partial<Record<Weekday, string>>>
export type WeeklyTemplate = Record<Weekday, string[]>

export const mockCourseOptions: SubjectContent[] = [
  { id: 'c-chinese-1', subjectId: 'chinese', name: '书法硬笔课' },
  { id: 'c-chinese-2', subjectId: 'chinese', name: '阅读写作课' },
  { id: 'c-chinese-3', subjectId: 'chinese', name: '国学经典课' },
  { id: 'c-math-1', subjectId: 'math', name: '思维数学小班课' },
  { id: 'c-math-2', subjectId: 'math', name: '珠心算' },
  { id: 'c-english-1', subjectId: 'english', name: '英语绘本精读课' },
  { id: 'c-english-2', subjectId: 'english', name: '英语口语外教课' },
  { id: 'c-english-3', subjectId: 'english', name: '自然拼读课' },
  { id: 'c-thinking-1', subjectId: 'thinking', name: '乐高机器人' },
  { id: 'c-thinking-2', subjectId: 'thinking', name: '围棋启蒙课' },
  { id: 'c-pe-1', subjectId: 'pe', name: '游泳进阶训练' },
  { id: 'c-pe-2', subjectId: 'pe', name: '篮球兴趣班' },
  { id: 'c-pe-3', subjectId: 'pe', name: '跆拳道' },
]

export const mockTaskContents: SubjectContent[] = [
  { id: 'k-chinese-1', subjectId: 'chinese', name: '朗读课文' },
  { id: 'k-chinese-2', subjectId: 'chinese', name: '背诵古诗' },
  { id: 'k-chinese-3', subjectId: 'chinese', name: '练字一页' },
  { id: 'k-chinese-4', subjectId: 'chinese', name: '课外阅读 20 分钟' },
  { id: 'k-math-1', subjectId: 'math', name: '口算练习 20 题' },
  { id: 'k-math-2', subjectId: 'math', name: '应用题 3 道' },
  { id: 'k-math-3', subjectId: 'math', name: '错题订正' },
  { id: 'k-english-1', subjectId: 'english', name: '单词跟读' },
  { id: 'k-english-2', subjectId: 'english', name: '英文儿歌听唱' },
  { id: 'k-english-3', subjectId: 'english', name: '绘本亲子共读' },
  { id: 'k-english-4', subjectId: 'english', name: '听力磨耳朵 15 分钟' },
  { id: 'k-english-5', subjectId: 'english', name: '单词默写' },
  { id: 'k-thinking-1', subjectId: 'thinking', name: '数独挑战' },
  { id: 'k-thinking-2', subjectId: 'thinking', name: '七巧板拼图' },
  { id: 'k-thinking-3', subjectId: 'thinking', name: '逻辑狗练习' },
  { id: 'k-pe-1', subjectId: 'pe', name: '跳绳 300 个' },
  { id: 'k-pe-2', subjectId: 'pe', name: '慢跑 1 公里' },
  { id: 'k-pe-3', subjectId: 'pe', name: '仰卧起坐 30 个' },
  { id: 'k-pe-4', subjectId: 'pe', name: '拉伸放松' },
]

export const mockScheduleGrid: ScheduleGrid = {}

export const mockWeeklyTemplate: WeeklyTemplate = {
  1: ['k-chinese-1', 'k-math-1'],
  2: ['k-english-1'],
  3: ['k-math-2', 'k-pe-1'],
  4: ['k-chinese-2'],
  5: ['k-english-3', 'k-thinking-1'],
  6: ['k-pe-2'],
  7: ['k-chinese-4', 'k-thinking-2'],
}
