/**
 * 家庭账单解析：微信支付 / 支付宝导出的 .csv / .xls / .xlsx 流水文件。
 *
 * 两家导出的文件结构差异很大，但都有一大段说明文字在前、真正的表头在后面，
 * 字段名（金额(元) / 金额、商品 / 商品说明）也不完全一样；微信新版导出的是 .xls。
 * 这里统一先转成二维数组再按表头取列，页面只管展示和入库。
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

/** 收/支 → income / expense；空与「不计收支」返回 null（这类多为转账、还款，不参与统计） */
export function parseDirection(raw: string): BillDirection | null {
  const text = raw.trim()
  if (!text) return null
  if (text.includes('不计')) return null
  if (text.includes('收')) return 'income'
  if (text.includes('支')) return 'expense'
  return null
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

/** 在二维数组里找表头行：含「交易时间」优先，其次「交易类型 / 交易分类」 */
function findHeaderRow(sheet: unknown[][], source: BillSource): number {
  const limit = Math.min(sheet.length, 60)
  for (let i = 0; i < limit; i += 1) {
    const cells = (sheet[i] ?? []).map(cellText)
    if (cells.some((cell) => cell.includes('交易时间'))) return i
  }
  for (let i = 0; i < limit; i += 1) {
    const cells = (sheet[i] ?? []).map(cellText)
    if (cells.some((cell) => cell.includes('交易类型') || cell.includes('交易分类'))) return i
  }
  return Math.min(FALLBACK_SKIP_LINES[source], Math.max(0, sheet.length - 1))
}

/** 二维表格 → 标准账单行（表头之后的每一行都是数据） */
export function parseBillSheet(sheet: unknown[][], source: BillSource): ParseResult {
  const headerRowIndex = findHeaderRow(sheet, source)
  const header = (sheet[headerRowIndex] ?? []).map((cell) => normalizeKey(cellText(cell)))

  const amountKeys = source === 'wechat' ? ['金额(元)', '金额'] : ['金额']
  const categoryKeys = source === 'wechat' ? ['交易类型'] : ['交易分类']
  const descKeys = source === 'wechat' ? ['商品'] : ['商品说明', '商品']

  const rows: ParsedBill[] = []
  let skipped = 0
  let total = 0

  for (const row of sheet.slice(headerRowIndex + 1)) {
    if (!Array.isArray(row) || row.length === 0) continue
    const occurredAt = parseOccurredAt(pickTime(header, row))
    const amount = parseAmount(pickCell(header, row, amountKeys))
    const direction = parseDirection(pickCell(header, row, ['收/支', '收/支出']))
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
      category: pickCell(header, row, categoryKeys).slice(0, 50),
      description: pickCell(header, row, descKeys).slice(0, 200),
    })
  }

  return { rows, skipped, total }
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

/** 文件字节 → 文本：优先 UTF-8，出现替换符再按 GBK（微信早期导出）解一次 */
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
 * 按后缀把文件读成二维数组（不判断表头、不清洗，交给调用方）。
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

/** ODS 原始行：rowIndex 为文件中的行号（从 1 开始），data 为「表头 → 单元格」 */
export type RawRow = { rowIndex: number; data: Record<string, string> }

/** 找表头行：第一列文本包含「交易时间」 */
export function findRawHeaderRow(sheet: unknown[][]): number {
  const limit = Math.min(sheet.length, 60)
  for (let i = 0; i < limit; i += 1) {
    const first = cellText((sheet[i] ?? [])[0]).replace(/^\uFEFF/, '').trim()
    if (first.includes('交易时间')) return i
  }
  throw new Error('没找到表头行：文件第一列没有「交易时间」，请确认是微信 / 支付宝官方导出的账单')
}

/** 表头 + 数据行 → 原始 JSON 行；字段名保持文件原样，单元格一律转文本 */
export function buildRawRows(sheet: unknown[][], headerIndex: number): RawRow[] {
  const header = (sheet[headerIndex] ?? []).map((cell) => cellText(cell).replace(/^\uFEFF/, '').trim())
  const rows: RawRow[] = []

  for (let i = headerIndex + 1; i < sheet.length; i += 1) {
    const row = sheet[i]
    if (!Array.isArray(row)) continue
    const values = row.map((cell) => cellText(cell).trim())
    if (values.every((value) => !value)) continue

    const data: Record<string, string> = {}
    header.forEach((key, index) => {
      const value = values[index] ?? ''
      // 空表头且空值（支付宝行尾多余的逗号）直接忽略
      if (!key && !value) return
      data[key || `列${index + 1}`] = value
    })
    rows.push({ rowIndex: i + 1, data })
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

/** 解析 CSV 文本（微信 / 支付宝都有导出 .csv 的情况） */
export function parseBillCsv(text: string, source: BillSource): ParseResult {
  return parseBillSheet(readCsvSheet(text, source), source)
}

/** 解析 .xls / .xlsx */
export async function parseBillWorkbook(
  buffer: ArrayBuffer,
  source: BillSource,
): Promise<ParseResult> {
  return parseBillSheet(await readWorkbookSheet(buffer), source)
}

/** 统一入口：先读成二维数组，再按表头清洗（清洗逻辑留给后续 ETL 使用） */
export async function parseBillFile(
  file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> },
  source: BillSource,
): Promise<ParseResult> {
  return parseBillSheet(await readBillSheet(file, source), source)
}

/** 汇总用的最小行结构：数据库行与解析结果都能直接传入 */
export type BillRecord = {
  occurred_at: string
  direction: BillDirection
  amount: number | string
  category: string | null
}

/**
 * ISO 时间 → 北京时间日期 key（YYYY-MM-DD）。
 * 数据库 timestamptz 返回的是 UTC（如 2026-01-05T04:30:45+00:00），
 * 直接切字符串会把凌晨的账单算到前一天 / 上一月，这里统一换算到 +08:00。
 */
export function bjDayKey(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso.slice(0, 10)
  const d = new Date(time + 8 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** ISO 时间 → 北京时间「YYYY-MM-DD HH:mm」 */
export function bjDateTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso.slice(0, 16).replace('T', ' ')
  const d = new Date(time + 8 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}`
}

/** 分类名兜底：空分类统一归入「未分类」 */
export function categoryOf(row: Pick<BillRecord, 'category'>): string {
  return row.category?.trim() || '未分类'
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

/** 区间（prefix 为 YYYY-MM 或 YYYY）内的收入 / 支出合计 */
export function sumBills(rows: readonly BillRecord[], prefix: string) {
  let income = 0
  let expense = 0
  for (const row of rows) {
    if (!bjDayKey(row.occurred_at).startsWith(prefix)) continue
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
    if (!bjDayKey(row.occurred_at).startsWith(prefix)) continue
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
