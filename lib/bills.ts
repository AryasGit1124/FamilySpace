/**
 * 家庭账单 CSV 解析：微信支付 / 支付宝导出的流水文件。
 *
 * 两家的 CSV 结构差异很大，但都有一大段说明文字在前、真正的表头在后面，
 * 而且字段名（金额(元) / 金额、商品 / 商品说明）也不完全一样。
 * 这里统一解析成 ParsedBill，页面只管展示和入库。
 */
import Papa from 'papaparse'

export type BillSource = 'wechat' | 'alipay'
export type BillDirection = 'income' | 'expense'

export type ParsedBill = {
  /** ISO 时间串，带 +08:00，避免服务器在 UTC 时区把日期算错天 */
  occurredAt: string
  source: BillSource
  direction: BillDirection
  amount: number
  category: string
  description: string
}

export type ParseResult = {
  rows: ParsedBill[]
  /** 解析到但被过滤掉的行数（收/支 为空或不计收支） */
  skipped: number
  /** 表格数据总行数（不含表头与说明） */
  total: number
}

/** 两家导出文件的说明行数：解析时按表头关键字定位，找不到才用这个兜底 */
const FALLBACK_SKIP_LINES: Record<BillSource, number> = {
  wechat: 16,
  alipay: 24,
}

/** 字段名归一：去 BOM、去首尾空白与引号 */
function normalizeKey(key: string): string {
  return key.replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').trim()
}

/** 按候选名在行里找值：先精确匹配，再前缀匹配（兼容「金额(元)」「金额（元）」） */
function pick(row: Record<string, string>, candidates: string[]): string {
  const entries = Object.entries(row).map(([key, value]) => [normalizeKey(key), value ?? ''] as const)
  for (const candidate of candidates) {
    const hit = entries.find(([key]) => key === candidate)
    if (hit) return String(hit[1]).trim()
  }
  for (const candidate of candidates) {
    const hit = entries.find(([key]) => key.startsWith(candidate))
    if (hit) return String(hit[1]).trim()
  }
  return ''
}

/** 「¥1,234.00」→ 1234；无法解析返回 null */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[¥￥,，\s"']/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.abs(value)
}

/** 收/支 → income / expense；空与「不计收支」返回 null（这类多为转账、还款，不参与统计） */
export function parseDirection(raw: string): BillDirection | null {
  const text = raw.trim()
  if (!text) return null
  if (text.includes('不计')) return null
  if (text.includes('收')) return 'income'
  if (text.includes('支')) return 'expense'
  return null
}

/** 「2026-01-05 12:30:45」→ 「2026-01-05T12:30:45+08:00」 */
export function parseOccurredAt(raw: string): string | null {
  const text = raw.trim().replace(/"/g, '')
  if (!text) return null
  // 支付宝偶尔会带日期前缀单引号，如 '2026-01-05 12:30:45'
  const cleaned = text.replace(/^'/, '')
  const match = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!match) {
    const dateOnly = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
    if (!dateOnly) return null
    const [, y, m, d] = dateOnly
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00+08:00`
  }
  const [, y, m, d, hh, mm, ss] = match
  const pad = (v: string) => v.padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${mm}:${ss ?? '00'}+08:00`
}

/** 找出真正的表头行：同时包含「交易时间」和「金额」的那一行 */
function findHeaderIndex(lines: string[], source: BillSource): number {
  for (let i = 0; i < Math.min(lines.length, 60); i += 1) {
    const line = lines[i]
    if (line.includes('交易时间') && line.includes('金额')) return i
  }
  return Math.min(FALLBACK_SKIP_LINES[source], Math.max(0, lines.length - 1))
}

/** 解析一个账单 CSV 文本 */
export function parseBillCsv(text: string, source: BillSource): ParseResult {
  const cleanText = text.replace(/^\uFEFF/, '')
  const lines = cleanText.split(/\r?\n/)
  const headerIndex = findHeaderIndex(lines, source)
  const body = lines.slice(headerIndex).join('\n')

  const parsed = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeKey,
  })

  const timeKeys = ['交易时间']
  const amountKeys = source === 'wechat' ? ['金额(元)', '金额'] : ['金额']
  const categoryKeys = source === 'wechat' ? ['交易类型'] : ['交易分类']
  const descKeys = source === 'wechat' ? ['商品'] : ['商品说明', '商品']

  const rows: ParsedBill[] = []
  let skipped = 0
  let total = 0

  for (const row of parsed.data) {
    if (!row || typeof row !== 'object') continue
    const occurredAt = parseOccurredAt(pick(row, timeKeys))
    const amount = parseAmount(pick(row, amountKeys))
    const direction = parseDirection(pick(row, ['收/支', '收/支出']))
    // 表尾的统计行 / 空行：没有时间且没有金额时直接忽略，不计入总数
    if (!occurredAt && amount === null) continue
    total += 1
    if (!occurredAt || amount === null || amount === 0 || !direction) {
      skipped += 1
      continue
    }
    rows.push({
      occurredAt,
      source,
      direction,
      amount,
      category: pick(row, categoryKeys).slice(0, 50),
      description: pick(row, descKeys).slice(0, 200),
    })
  }

  return { rows, skipped, total }
}

/** 汇总用：判断某笔账单是否落在指定月份（YYYY-MM） */
export function inMonth(occurredAt: string, yearMonth: string): boolean {
  return occurredAt.slice(0, 7) === yearMonth
}

/** 汇总用的最小行结构：数据库行与解析结果都能直接传入 */
export type BillRecord = {
  occurred_at: string
  direction: BillDirection
  amount: number | string
  category: string | null
}

/** 分类名兜底：空分类统一归入「未分类」 */
export function categoryOf(row: Pick<BillRecord, 'category'>): string {
  return row.category?.trim() || '未分类'
}

/** 区间（prefix 为 YYYY-MM 或 YYYY）内的收入 / 支出合计 */
export function sumBills(rows: readonly BillRecord[], prefix: string) {
  let income = 0
  let expense = 0
  for (const row of rows) {
    if (row.occurred_at.slice(0, prefix.length) !== prefix) continue
    const amount = Number(row.amount) || 0
    if (row.direction === 'income') income += amount
    else if (row.direction === 'expense') expense += amount
  }
  return { income, expense }
}

/** 区间内支出按分类聚合，按金额降序；percent 为占该区间总支出的比例 */
export function expenseByCategory(rows: readonly BillRecord[], prefix: string) {
  const map = new Map<string, number>()
  let total = 0
  for (const row of rows) {
    if (row.occurred_at.slice(0, prefix.length) !== prefix) continue
    if (row.direction !== 'expense') continue
    const amount = Number(row.amount) || 0
    const key = categoryOf(row)
    map.set(key, (map.get(key) ?? 0) + amount)
    total += amount
  }
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount, percent: total > 0 ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
}
