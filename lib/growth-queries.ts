import { familyPatch, scoped } from '@/lib/supabase-queries'
import { resolveFamilyId } from '@/lib/family'
import { requireSupabase } from '@/lib/supabase'

export type GrowthMediaType = 'image' | 'video' | 'text'

export type GrowthRecord = {
  id: string
  family_id: string | null
  media_type: GrowthMediaType
  file_url: string | null
  cover_url: string | null
  title: string | null
  /** 纯文字记录或媒体配文；缺字段时统一兜底为 '' */
  content: string
  record_date: string
  created_at: string
}

const COLUMNS =
  'id, family_id, media_type, file_url, cover_url, title, content, record_date, created_at'
/** 未执行 content 列迁移时的兜底字段列表 */
const COLUMNS_WITHOUT_CONTENT =
  'id, family_id, media_type, file_url, cover_url, title, record_date, created_at'

/** Postgres 42703 = undefined_column，常见于还没执行 content 列迁移 */
function isMissingColumn(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '42703'
}

/** 兜底 content 等可能缺失的字段，避免旧数据/缺列导致渲染报错 */
function normalizeRecord(row: Partial<GrowthRecord> | null): GrowthRecord {
  return {
    id: row?.id ?? '',
    family_id: row?.family_id ?? null,
    media_type: row?.media_type ?? 'text',
    file_url: row?.file_url ?? null,
    cover_url: row?.cover_url ?? null,
    title: row?.title ?? null,
    content: row?.content ?? '',
    record_date: row?.record_date ?? '',
    created_at: row?.created_at ?? '',
  }
}

/** 全部成长档案，按记录日期倒序 */
export async function fetchGrowthRecords(): Promise<GrowthRecord[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()

  const run = (columns: string) =>
    scoped(supabase.from('growth_records').select(columns), familyId)
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false })

  let result = await run(COLUMNS)
  // content 列还没建时降级查询，保证列表照常展示
  if (result.error && isMissingColumn(result.error)) result = await run(COLUMNS_WITHOUT_CONTENT)
  if (result.error) throw result.error
  return ((result.data ?? []) as Partial<GrowthRecord>[]).map(normalizeRecord)
}

export async function fetchGrowthRecord(id: string): Promise<GrowthRecord | null> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()

  const run = (columns: string) =>
    scoped(supabase.from('growth_records').select(columns).eq('id', id), familyId).maybeSingle()

  let result = await run(COLUMNS)
  if (result.error && isMissingColumn(result.error)) result = await run(COLUMNS_WITHOUT_CONTENT)
  if (result.error) throw result.error
  return result.data ? normalizeRecord(result.data as Partial<GrowthRecord>) : null
}

export async function insertGrowthRecord(params: {
  mediaType: GrowthMediaType
  fileUrl: string | null
  coverUrl: string | null
  title: string | null
  content: string | null
  recordDate: string
}): Promise<GrowthRecord> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const payload = {
    media_type: params.mediaType,
    file_url: assertAbsoluteMediaUrl(params.fileUrl, 'file_url'),
    cover_url: assertAbsoluteMediaUrl(params.coverUrl, 'cover_url'),
    title: params.title,
    content: params.content ?? '',
    record_date: params.recordDate,
    ...familyPatch(familyId),
  }

  let result = await supabase
    .from('growth_records')
    .insert(payload as never)
    .select(COLUMNS)
    .single()
  // content 列还没建时降级写入（内容暂不保存，页面仍可正常发布）
  if (result.error && isMissingColumn(result.error)) {
    const { content: _content, ...legacy } = payload
    result = await supabase
      .from('growth_records')
      .insert(legacy as never)
      .select(COLUMNS_WITHOUT_CONTENT)
      .single()
  }
  if (result.error) {
    // 23514 = check 约束不通过：旧表的 media_type 还不允许 text
    if ((result.error as { code?: string }).code === '23514') {
      throw new Error('数据库还没执行迁移，请先运行 scripts/create-growth-records.sql')
    }
    throw result.error
  }
  return normalizeRecord(result.data as Partial<GrowthRecord>)
}

/** 入库前校验媒体地址：必须是完整的 R2 公网 URL，禁止 blob: 临时地址与相对路径 */
function assertAbsoluteMediaUrl(url: string | null, field: string): string | null {
  if (!url) return null
  if (/^blob:/i.test(url)) {
    throw new Error(`${field} 仍是本地临时地址，请重新上传`)
  }
  if (!/^https?:\/\//i.test(url)) {
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/+$/, '')
    if (base) return `${base}/${url.replace(/^\/+/, '')}`
    throw new Error(`${field} 不是完整的 R2 公网地址，请检查 NEXT_PUBLIC_R2_PUBLIC_URL`)
  }
  return url
}

export type GrowthRecordUpdate = {
  title: string | null
  content: string | null
  recordDate: string
  mediaType?: GrowthMediaType
  fileUrl?: string | null
  coverUrl?: string | null
}

/** 更新一条成长档案；未传的媒体字段保持原值 */
export async function updateGrowthRecord(
  id: string,
  params: GrowthRecordUpdate,
): Promise<GrowthRecord> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const payload: Record<string, unknown> = {
    title: params.title,
    content: params.content ?? '',
    record_date: params.recordDate,
  }
  if (params.mediaType !== undefined) payload.media_type = params.mediaType
  if (params.fileUrl !== undefined) {
    payload.file_url = assertAbsoluteMediaUrl(params.fileUrl, 'file_url')
  }
  if (params.coverUrl !== undefined) {
    payload.cover_url = assertAbsoluteMediaUrl(params.coverUrl, 'cover_url')
  }

  const run = (data: Record<string, unknown>, columns: string) =>
    scoped(
      supabase.from('growth_records').update(data as never).eq('id', id),
      familyId,
    )
      .select(columns)
      .single()

  let result = await run(payload, COLUMNS)
  // content 列还没建时降级更新
  if (result.error && isMissingColumn(result.error)) {
    const { content: _content, ...legacy } = payload
    result = await run(legacy, COLUMNS_WITHOUT_CONTENT)
  }
  if (result.error) {
    if ((result.error as { code?: string }).code === '23514') {
      throw new Error('数据库还没执行迁移，请先运行 scripts/create-growth-records.sql')
    }
    throw result.error
  }
  return normalizeRecord(result.data as Partial<GrowthRecord>)
}

export async function deleteGrowthRecord(id: string): Promise<void> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { error } = await scoped(
    supabase.from('growth_records').delete().eq('id', id),
    familyId,
  )
  if (error) throw error
}
