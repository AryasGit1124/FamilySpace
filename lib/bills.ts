/**
 * 家庭账单解析：微信支付 / 支付宝导出的账单文件（.csv / .xls / .xlsx）。
 *
 * 两家导出都在前面放一大段说明文字，真正的表头在后面；字段名也不一样
 * （金额(元) / 金额、商品 / 商品说明、交易单号 / 交易订单号）。
 * 这里统一转成二维数组，再按表头把一行映射成 bill_ods 的物理列，原始行另存 raw_data。
 */
import Papa from 'papaparse'
import { categorySubtreeIds } from './bill-stats'

export type BillSource = 'wechat' | 'alipay'

/** 两家导出文件的说明行数：解析时按表头关键字定位，找不到才用这个兜底 */
const FALLBACK_SKIP_LINES: Record<BillSource, number> = {
  wechat: 16,
  alipay: 24,
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 单元格 → 文本；xlsx 的日期单元格（cellDates）用本地时间还原成原表格里的写法 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    // Excel 序列号精度有限，08:59:59.999 这类误差四舍五入到整秒
    const d = new Date(Math.round(value.getTime() / 1000) * 1000)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
      d.getHours(),
    )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  }
  return String(value)
}

/** Excel 日期序列号（如 46027.5）→「2026-01-05 12:00:00」；序列号本身不含时区，用 UTC 读回原样 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
function excelSerialText(serial: number): string {
  const d = new Date(EXCEL_EPOCH_MS + Math.round(serial * 86400 * 1000))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

/** 按候选列名找列下标：先精确匹配，再前缀匹配（兼容「金额(元)」「金额（元）」） */
function columnIndex(header: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = header.findIndex((key) => key === candidate)
    if (index >= 0) return index
  }
  for (const candidate of candidates) {
    const index = header.findIndex((key) => key.startsWith(candidate))
    if (index >= 0) return index
  }
  return -1
}

/** 占位符统一视为空：微信/支付宝大量用「/」「-」表示无内容 */
function cleanPlaceholder(value: string): string {
  const text = value.trim()
  return text === '/' || text === '-' || text === '—' ? '' : text
}

/** 按候选列名取单元格文本 */
function pickCell(header: string[], row: unknown[], candidates: string[]): string {
  const index = columnIndex(header, candidates)
  return index >= 0 ? cleanPlaceholder(cellText(row[index])) : ''
}

/** 交易时间列：可能是字符串、Date，也可能是 Excel 序列号 */
function pickTime(header: string[], row: unknown[]): string {
  const index = columnIndex(header, ['交易时间'])
  if (index < 0) return ''
  const raw = row[index]
  if (typeof raw === 'number') return excelSerialText(raw)
  return cellText(raw).trim()
}

/** 「¥1,234.00」→ 1234；无法解析返回 null */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[¥￥,，\s"']/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.abs(value)
}

/** 「2026-01-05 12:30:45」→「2026-01-05T12:30:45+08:00」 */
export function parseOccurredAt(raw: string): string | null {
  const text = raw.trim().replace(/"/g, '')
  if (!text) return null
  // 支付宝偶尔会带日期前缀单引号，如 '2026-01-05 12:30:45'
  const cleaned = text.replace(/^'/, '')

  // 微信新版 .xlsx 的时间是带时区的 ISO（如 2026-11-15T02:58:18.000Z），
  // 直接按北京时间解析会整体差 8 小时，这里交给 Date 处理时区
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i.test(cleaned)) {
    const time = Date.parse(cleaned)
    if (!Number.isNaN(time)) return new Date(time).toISOString()
    return null
  }

  const match = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!match) {
    const dateOnly = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
    if (!dateOnly) return null
    const [, y, m, d] = dateOnly
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00+08:00`
  }
  const [, y, m, d, hh, mm, ss] = match
  return `${y}-${pad2(Number(m))}-${pad2(Number(d))}T${pad2(Number(hh))}:${mm}:${ss ?? '00'}+08:00`
}

/** 在说明文字里找真正表头所在行（按整行文本判断，避免引号内容打乱 CSV 解析） */
function findHeaderLine(lines: string[], source: BillSource): number {
  const limit = Math.min(lines.length, 60)
  for (let i = 0; i < limit; i += 1) {
    if (lines[i].includes('交易时间') && lines[i].includes('金额')) return i
  }
  for (let i = 0; i < limit; i += 1) {
    if (
      lines[i].includes('交易时间') ||
      lines[i].includes('交易类型') ||
      lines[i].includes('交易分类')
    ) {
      return i
    }
  }
  return Math.min(FALLBACK_SKIP_LINES[source], Math.max(0, lines.length - 1))
}

/** 文件字节 → 文本：优先 UTF-8，出现替换符再按 GBK（支付宝导出）解一次 */
export function decodeBillText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  // UTF-16LE BOM（部分 Windows 导出）
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer)
  }
  const text = new TextDecoder('utf-8').decode(buffer)
  if (!text.includes('\uFFFD')) return text
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch {
    return text
  }
}

/** CSV 文本 → 二维数组（先按整行文本定位表头，避免说明里的引号打乱解析） */
function readCsvSheet(text: string, source: BillSource): unknown[][] {
  const cleanText = text.replace(/^\uFEFF/, '')
  const lines = cleanText.split(/\r?\n/)
  const body = lines.slice(findHeaderLine(lines, source)).join('\n')
  return Papa.parse<string[]>(body, { skipEmptyLines: 'greedy' }).data as unknown as unknown[][]
}

/** .xls / .xlsx → 二维数组：动态引入 xlsx（体积较大），只取第一张表 */
async function readWorkbookSheet(buffer: ArrayBuffer): Promise<unknown[][]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []
  const worksheet = workbook.Sheets[firstSheetName]
  return XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown as unknown[][]
}

/**
 * 按后缀把文件读成二维数组（不判断表头）。
 * 微信新版导出是 .xlsx；也有把 CSV 内容直接命名为 .xls 的文件，
 * 所以 xlsx 解析失败时回退成文本 CSV 再试一次。
 */
export async function readBillSheet(
  file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> },
  source: BillSource,
): Promise<unknown[][]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const buffer = await file.arrayBuffer()

  if (ext === 'csv' || ext === 'txt') return readCsvSheet(decodeBillText(buffer), source)

  if (ext === 'xls' || ext === 'xlsx') {
    try {
      return await readWorkbookSheet(buffer)
    } catch (err) {
      console.warn('[Bills] xlsx 解析失败，回退按文本 CSV 解析:', err)
      return readCsvSheet(decodeBillText(buffer), source)
    }
  }

  throw new Error('只支持 .csv / .xls / .xlsx 格式的账单文件')
}

/** 找表头行：第一列文本包含「交易时间」 */
export function findRawHeaderRow(sheet: unknown[][]): number {
  const limit = Math.min(sheet.length, 60)
  for (let i = 0; i < limit; i += 1) {
    const first = cellText((sheet[i] ?? [])[0]).replace(/^\uFEFF/, '').trim()
    if (first.includes('交易时间')) return i
  }
  throw new Error('没找到表头行：文件第一列没有「交易时间」，请确认是微信 / 支付宝官方导出的账单')
}

/** 一行对应 bill_ods 的物理列；rawData 保留该行完整原始 JSON */
export type OdsBill = {
  tradeTime: string | null
  tradeType: string | null
  counterparty: string | null
  account: string | null
  commodity: string | null
  direction: string | null
  amount: number | null
  payMethod: string | null
  status: string | null
  tradeNo: string | null
  merchantNo: string | null
  remark: string | null
  rawData: Record<string, string>
  /** 导入时按规则命中的分类（可空） */
  categoryId?: string | null
}

/** 该行所有单元格 →「表头 → 文本」，键名保持文件原样 */
function rowToRaw(header: string[], row: unknown[]): Record<string, string> {
  const data: Record<string, string> = {}
  header.forEach((key, index) => {
    const value = cellText(row[index]).trim()
    // 空表头且空值（支付宝行尾多余的逗号）直接忽略
    if (!key && !value) return
    data[key || `列${index + 1}`] = value
  })
  return data
}

/** 表头 + 数据行 → bill_ods 记录（不清洗、不丢行，金额只去掉 ¥ 与千分位） */
export function buildOdsRows(
  sheet: unknown[][],
  headerIndex: number,
  source: BillSource,
): OdsBill[] {
  const header = (sheet[headerIndex] ?? []).map((cell) =>
    cellText(cell).replace(/^\uFEFF/, '').trim(),
  )
  const amountKeys = source === 'wechat' ? ['金额(元)', '金额'] : ['金额']

  const rows: OdsBill[] = []
  for (let i = headerIndex + 1; i < sheet.length; i += 1) {
    const row = sheet[i]
    if (!Array.isArray(row)) continue
    if (row.every((cell) => !cellText(cell).trim())) continue
    const text = (candidates: string[]) => pickCell(header, row, candidates) || null

    rows.push({
      tradeTime: parseOccurredAt(pickTime(header, row)),
      tradeType: text(['交易类型', '交易分类']),
      counterparty: text(['交易对方']),
      account: text(['对方账号']),
      commodity: text(['商品说明', '商品']),
      direction: text(['收/支', '收/支出']),
      amount: parseAmount(pickCell(header, row, amountKeys)),
      payMethod: text(['支付方式', '收/付款方式']),
      status: text(['当前状态', '交易状态']),
      tradeNo: text(['交易单号', '交易订单号']),
      merchantNo: text(['商户单号', '商家订单号']),
      remark: text(['备注']),
      rawData: rowToRaw(header, row),
    })
  }
  return rows
}

/** 批次号：时间戳 + 4 位随机，便于按批次撤回 */
export function newBatchId(): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(
    d.getHours(),
  )}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

/** 规则匹配字段：交易对方 / 商品说明 / 交易类型或分类 / 全部 */
export type BillRuleLike = {
  keyword: string
  match_field: 'counterparty' | 'commodity' | 'trade_type' | 'all'
}

/** 账单里参与关键词匹配的字段 */
export type BillTextLike = {
  counterparty?: string | null
  commodity?: string | null
  trade_type?: string | null
}

/** 单条规则是否命中（不区分大小写的包含匹配） */
export function ruleMatches(bill: BillTextLike, rule: BillRuleLike): boolean {
  const keyword = rule.keyword.trim().toLowerCase()
  if (!keyword) return false
  const hit = (value: string | null | undefined) => (value ?? '').toLowerCase().includes(keyword)
  if (rule.match_field === 'counterparty') return hit(bill.counterparty)
  if (rule.match_field === 'commodity') return hit(bill.commodity)
  if (rule.match_field === 'trade_type') return hit(bill.trade_type)
  return hit(bill.counterparty) || hit(bill.commodity) || hit(bill.trade_type)
}

/**
 * 按优先级从高到低找第一条命中的规则，返回分类 id；全不命中返回 null。
 * depthOf 用于「二级分类优先于一级」：同优先级时层级深的先命中。
 */
export function pickBillCategory(
  bill: BillTextLike,
  rules: (BillRuleLike & { category_id: string; priority: number })[],
  depthOf?: (categoryId: string) => number,
): string | null {
  const ordered = [...rules].sort(
    (a, b) =>
      b.priority - a.priority ||
      (depthOf ? depthOf(b.category_id) - depthOf(a.category_id) : 0),
  )
  for (const rule of ordered) {
    if (ruleMatches(bill, rule)) return rule.category_id
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────────
// 统计聚合（纯函数，页面只负责渲染）
// ──────────────────────────────────────────────────────────────────────────────

/** 时间维度：按日 / 按月 / 按年 */
export type Granularity = 'day' | 'month' | 'year'

/** 统计用的账单最小字段集 */
export type StatBill = {
  id: string
  trade_time: string | null
  commodity: string | null
  /** 净额（原金额 - 退款） */
  net_amount: number | null
  /** 数据库清洗出的收支性质，优先使用 */
  transaction_nature: 'income' | 'expense' | null
  direction: string | null
  category_id: string | null
  subcategory_id: string | null
  creator_name: string | null
  source: string | null
}

/** 统计用的分类最小字段集 */
export type StatCategory = {
  id: string
  name: string
  emoji: string
  parent_id: string | null
}

/** 收/支文案 → income / expense；「不计收支」等返回 null（兼容中英文） */
export function billDirectionOf(
  direction: string | null | undefined,
): 'income' | 'expense' | null {
  const value = (direction ?? '').trim()
  if (!value) return null
  const lower = value.toLowerCase()
  if (value.includes('不计收支') || value.includes('不计入收支')) return null
  if (value.includes('收') || ['income', 'in', 'credit', 'refund'].includes(lower)) return 'income'
  if (value.includes('支') || ['expense', 'out', 'debit', 'payment'].includes(lower)) return 'expense'
  return null
}

/** 是否是「不带时区」的时间串（Postgres timestamp without time zone，已是北京时间） */
function isNaiveTimestamp(value: string): boolean {
  const text = value.trim()
  return (
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/.test(text)
  )
}

/** 北京时间（+08:00）的日期键，不依赖浏览器时区 */
function bjDateParts(iso: string): { year: string; month: string; day: string } | null {
  if (isNaiveTimestamp(iso)) {
    const matched = iso.trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!matched) return null
    return { year: matched[1], month: matched[2], day: matched[3] }
  }
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  const d = new Date(time + 8 * 60 * 60 * 1000)
  return {
    year: String(d.getUTCFullYear()),
    month: pad2(d.getUTCMonth() + 1),
    day: pad2(d.getUTCDate()),
  }
}

/** 账单 → 时间桶键：日 YYYY-MM-DD / 月 YYYY-MM / 年 YYYY */
export function bucketKeyOf(
  tradeTime: string | null,
  granularity: Granularity,
): string | null {
  if (!tradeTime) return null
  const parts = bjDateParts(tradeTime)
  if (!parts) return null
  if (granularity === 'day') return `${parts.year}-${parts.month}-${parts.day}`
  if (granularity === 'month') return `${parts.year}-${parts.month}`
  return parts.year
}

/** 某分类及其所有子孙分类的 id（多级分类聚合），实现在 lib/bill-stats.ts */
export { categorySubtreeIds }

/** 按分类筛选：选一级分类时自动包含其所有二级分类 */
export function filterBillsByCategory<T extends { category_id: string | null }>(
  bills: T[],
  categories: StatCategory[],
  categoryId: string,
): T[] {
  if (!categoryId) return bills
  const ids = categorySubtreeIds(categories, categoryId)
  return bills.filter((bill) => !!bill.category_id && ids.has(bill.category_id))
}

const round2 = (value: number) => Math.round(value * 100) / 100

export type TimeBucket = { key: string; income: number; expense: number; net: number }

/** 按时间维度汇总收入 / 支出 / 结余，按时间升序 */
export function aggregateTimeBuckets(
  bills: StatBill[],
  granularity: Granularity,
): TimeBucket[] {
  const map = new Map<string, TimeBucket>()
  for (const bill of bills) {
    const key = bucketKeyOf(bill.trade_time, granularity)
    if (!key) continue
    const direction = billDirectionOf(bill.direction)
    if (!direction) continue
    const amount = Number(bill.net_amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) continue

    const bucket = map.get(key) ?? { key, income: 0, expense: 0, net: 0 }
    if (direction === 'income') bucket.income += amount
    else bucket.expense += amount
    map.set(key, bucket)
  }
  return [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => ({
      key: bucket.key,
      income: round2(bucket.income),
      expense: round2(bucket.expense),
      net: round2(bucket.income - bucket.expense),
    }))
}

export type CategoryShare = { name: string; emoji: string; value: number }

/**
 * 支出按「二级分类」占比；直接挂在一级分类上的账单记为「一级（未细分）」。
 * scopeId 为当前选中的分类，用于给「直接挂在该分类上」的账单加标记。
 */
export function aggregateCategoryShare(
  bills: StatBill[],
  categories: StatCategory[],
  scopeId?: string,
): CategoryShare[] {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const map = new Map<string, CategoryShare>()

  for (const bill of bills) {
    if (billDirectionOf(bill.direction) !== 'expense') continue
    const amount = Number(bill.net_amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) continue

    const category = bill.category_id ? byId.get(bill.category_id) : undefined
    let name = '未分类'
    let emoji = '❓'
    if (category) {
      const parent = category.parent_id ? byId.get(category.parent_id) : undefined
      if (parent) {
        name = category.name
        emoji = category.emoji
      } else {
        name = scopeId && category.id === scopeId ? `${category.name}（未细分）` : category.name
        emoji = category.emoji
      }
    }

    const entry = map.get(name) ?? { name, emoji, value: 0 }
    entry.value += amount
    map.set(name, entry)
  }

  return [...map.values()]
    .map((entry) => ({ ...entry, value: round2(entry.value) }))
    .sort((a, b) => b.value - a.value)
}

/** 登记人标签配色：爸爸系青、妈妈系粉、其他琥珀 */
export function creatorTagClass(name: string | null | undefined): string {
  const value = name ?? ''
  if (/爸|爷|外公|父/.test(value)) return 'bg-cyan-50 text-cyan-700'
  if (/妈|奶|外婆|母/.test(value)) return 'bg-pink-50 text-pink-600'
  return 'bg-amber-50 text-amber-700'
}

/** 来源标签：微信绿 / 支付宝蓝 / 手工橙 */
export function sourceTag(
  source: string | null | undefined,
): { label: string; className: string } | null {
  if (source === 'wechat') return { label: '微信', className: 'bg-green-50 text-green-600' }
  if (source === 'alipay') return { label: '支付宝', className: 'bg-blue-50 text-blue-600' }
  if (source === 'manual') return { label: '手工', className: 'bg-orange-50 text-orange-600' }
  return null
}

/** ISO 时间 → 北京时间「YYYY-MM-DD HH:mm」；无时区的时间串（来自 bill_dwd）原样展示 */
export function bjDateTime(iso: string): string {
  if (isNaiveTimestamp(iso)) return iso.trim().slice(0, 16).replace('T', ' ')
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso.slice(0, 16).replace('T', ' ')
  const d = new Date(time + 8 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}`
}

/**
 * 把 Supabase / PostgREST 的错误转成可读文本。
 * 这类错误在 Next 控制台里会打印成 `{}`，必须自己取 message / details / hint / code。
 */
export function describeBillError(err: unknown): string {
  if (err === null || err === undefined) return '未知错误'
  if (typeof err === 'string') return err

  const obj = err as Record<string, unknown>
  const field = (key: string) => {
    const value = obj[key]
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  }
  const message = err instanceof Error ? err.message : field('message')
  const code = field('code')
  const parts = [message, field('details'), field('hint')].filter(Boolean)
  const text = parts.join(' | ') || `未知错误（${String(err)}）`
  return code && !text.includes(code) ? `${text}（${code}）` : text
}

/** 账单表还没建 / PostgREST 还没刷新 schema：提示用户去执行建表 SQL */
export function isMissingBillTable(err: unknown): boolean {
  const text = describeBillError(err).toLowerCase()
  return (
    text.includes('schema cache') ||
    text.includes('does not exist') ||
    text.includes('42p01') ||
    text.includes('pgrst205')
  )
}
