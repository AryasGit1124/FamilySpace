/**
 * 账单统计页的纯逻辑：筛选参数换算、分类范围推导、图表数据整形。
 *
 * 这里只放无副作用的函数，不依赖 Supabase / React，方便用 node:test 直接单测。
 */

/** 分类字段的最小子集（BillCategory 可直接传入） */
export type CategoryLike = {
  id: string
  parent_id: string | null
  name: string
  icon: string
}

/** 分类图标：库里没配图标时的兜底 */
export const categoryIcon = (category?: Pick<CategoryLike, 'icon'> | null) =>
  category?.icon || '💰'

/** 某分类及其所有子孙分类的 id（多级分类聚合） */
export function categorySubtreeIds(
  categories: { id: string; parent_id: string | null }[],
  rootId: string,
): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const category of categories) {
      if (category.parent_id && ids.has(category.parent_id) && !ids.has(category.id)) {
        ids.add(category.id)
        changed = true
      }
    }
  }
  return ids
}

/**
 * 时间区间：year + month → [start, end)
 * month 为 'all' / 空时取整年；12 月自动跨到下一年 1 月。
 * bill_dwd.trade_time 是无时区的北京时间字符串，这里不拼接时区。
 */
export function monthBounds(
  year: string,
  month?: string | null,
): { start: string; end: string } {
  const selected = month && month !== 'all' ? Number(month) : null
  if (selected === null) {
    return {
      start: `${year}-01-01T00:00:00`,
      end: `${Number(year) + 1}-01-01T00:00:00`,
    }
  }
  const endMonth = selected === 12 ? 1 : selected + 1
  const endYear = selected === 12 ? Number(year) + 1 : Number(year)
  return {
    start: `${year}-${String(selected).padStart(2, '0')}-01T00:00:00`,
    end: `${endYear}-${String(endMonth).padStart(2, '0')}-01T00:00:00`,
  }
}

/** PostgREST 的 OR 条件：category_id / subcategory_id 任一命中都算 */
export function categoryIdOr(ids: string[]): string {
  const list = ids.join(',')
  return `category_id.in.(${list}),subcategory_id.in.(${list})`
}

/**
 * 下钻用的 OR 条件：命中分类自身，并覆盖一级分类下的所有二级分类。
 *
 * category_id.eq.{id},subcategory_id.eq.{id},subcategory_id.in.({子分类})
 * —— 一级分类的账单通常只写了 subcategory_id，必须把子分类集合一并带上。
 */
export function categoryOrFilter(
  selectedId: string | null,
  ids?: string[] | null,
): string | null {
  if (!selectedId) return null
  const children = (ids ?? []).filter((id) => id !== selectedId)
  const parts = [`category_id.eq.${selectedId}`, `subcategory_id.eq.${selectedId}`]
  if (children.length > 0) parts.push(`subcategory_id.in.(${children.join(',')})`)
  return parts.join(',')
}

// ──────────────────────────────────────────────────────────────────────────────
// 金额筛选
// ──────────────────────────────────────────────────────────────────────────────

/** 金额筛选类型 */
export type AmountFilterType = 'all' | 'gte100' | 'gte500' | 'custom'

/** 金额筛选胶囊文案 */
export function amountLabel(type: AmountFilterType, min: string, max: string): string {
  if (type === 'gte100') return '金额 ≥ 100'
  if (type === 'gte500') return '金额 ≥ 500'
  if (type === 'custom') {
    const low = min.trim() === '' ? '0' : min.trim()
    const high = max.trim() === '' ? '不限' : max.trim()
    return `金额 ${low}-${high}`
  }
  return '金额'
}

/** 金额筛选 → RPC / 明细查询参数；非法输入按未填写处理 */
export function amountFilterParams(
  type: AmountFilterType,
  min: string,
  max: string,
): { minAmount: number | null; maxAmount: number | null; excludeZero: boolean } {
  const minValue = min.trim() === '' ? null : Number(min)
  const maxValue = max.trim() === '' ? null : Number(max)
  const validMin = minValue !== null && !Number.isNaN(minValue) ? minValue : null
  const validMax = maxValue !== null && !Number.isNaN(maxValue) ? maxValue : null

  if (type === 'gte100') return { minAmount: 100, maxAmount: null, excludeZero: false }
  if (type === 'gte500') return { minAmount: 500, maxAmount: null, excludeZero: false }
  if (type === 'custom') {
    return { minAmount: validMin, maxAmount: validMax, excludeZero: false }
  }
  return { minAmount: null, maxAmount: null, excludeZero: false }
}

// ──────────────────────────────────────────────────────────────────────────────
// 分类筛选范围
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 明细筛选范围：选一级分类 = 整棵子树（含所有二级分类）；选二级分类 = 仅该分类。
 * 未选 / 找不到分类时返回 null（不加分类条件）。
 */
export function categoryFilterIds(
  categories: CategoryLike[],
  selectedId: string,
): string[] | null {
  if (!selectedId) return null
  const selected = categories.find((item) => item.id === selectedId)
  // 分类列表可能未加载 / 已过期，至少按传入 id 过滤，避免条件被静默丢弃
  if (!selected) return [selectedId]
  if (selected.parent_id) return [selected.id]
  return [...categorySubtreeIds(categories, selected.id)]
}

/**
 * 饼图 / 分类列表的范围：选一级分类看整棵子树；选二级分类看同一父级下的兄弟分类。
 */
export function shareScopeIds(
  categories: CategoryLike[],
  selectedId: string,
): string[] | null {
  if (!selectedId) return null
  const selected = categories.find((item) => item.id === selectedId)
  if (!selected) return null
  return [...categorySubtreeIds(categories, selected.parent_id ?? selected.id)]
}

// ──────────────────────────────────────────────────────────────────────────────
// 图表数据整形
// ──────────────────────────────────────────────────────────────────────────────

/** get_bill_category_summary 返回的一行 */
export type CategorySummaryRow = {
  category_id: string | null
  /** 分类表被删 / 无分类时的兜底名称 */
  category_name?: string | null
  total_expense: number
}

/** 分类支出：饼图与分类列表共用 */
export type CategoryShare = {
  id: string | null
  name: string
  emoji: string
  value: number
}

/**
 * 把 RPC 的分类聚合结果映射成带名称 / 图标的数据，按金额降序，过滤掉 0 元分类。
 * selectedId 用于判断「一级分类自身未细分」的展示后缀。
 */
export function buildCategoryShares(
  rows: CategorySummaryRow[],
  categories: CategoryLike[],
  selectedId = '',
): CategoryShare[] {
  const byId = new Map(categories.map((item) => [item.id, item]))
  const selected = selectedId ? byId.get(selectedId) : undefined
  const scopeRootId = selected ? (selected.parent_id ?? selected.id) : undefined

  return rows
    .map((row) => {
      const category = row.category_id ? byId.get(row.category_id) : undefined
      let name = '未分类'
      let emoji = '❓'
      if (category) {
        const parent = category.parent_id ? byId.get(category.parent_id) : undefined
        if (parent) {
          name = category.name
        } else {
          name =
            scopeRootId && category.id === scopeRootId
              ? `${category.name}（未细分）`
              : category.name
        }
        emoji = categoryIcon(category)
      } else if (row.category_name) {
        name = row.category_name
        emoji = '💰'
      }
      return { id: row.category_id, name, emoji, value: Number(row.total_expense) }
    })
    .filter((share) => share.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** 饼图配色 */
export const PIE_COLORS = [
  '#f97316',
  '#0ea5e9',
  '#22c55e',
  '#a855f7',
  '#ef4444',
  '#eab308',
  '#14b8a6',
  '#6366f1',
  '#ec4899',
  '#84cc16',
]

export type PieShare = CategoryShare & { fill: string }

/** 饼图只保留前 limit 个分类，其余合并为「其他」 */
export function buildPieData(shares: CategoryShare[], limit = 5): PieShare[] {
  const sorted = [...shares].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, limit)
  const rest = sorted.slice(limit).reduce((sum, share) => sum + share.value, 0)
  const merged =
    rest > 0
      ? [...top, { id: null, name: '其他', emoji: '📦', value: Math.round(rest * 100) / 100 }]
      : top
  return merged.map((share, index) => ({
    ...share,
    fill: PIE_COLORS[index % PIE_COLORS.length],
  }))
}

/** get_bill_stats 返回的时间桶 */
export type BucketRow = {
  bucket: string
  total_expense: number
  total_income: number
}

/** 柱状图数据点（label 为月份） */
export type StatBucket = {
  key: string
  label: string
  income: number
  expense: number
  net: number
}

export function buildBuckets(rows: BucketRow[]): StatBucket[] {
  return rows.map((row) => ({
    key: row.bucket,
    label: row.bucket,
    income: Number(row.total_income),
    expense: Number(row.total_expense),
    net: Number(row.total_income) - Number(row.total_expense),
  }))
}

/** 当前筛选下的收入 / 支出 / 结余合计 */
export function bucketTotals(buckets: StatBucket[]): {
  income: number
  expense: number
  net: number
} {
  const { income, expense } = buckets.reduce(
    (acc, bucket) => ({ income: acc.income + bucket.income, expense: acc.expense + bucket.expense }),
    { income: 0, expense: 0 },
  )
  return { income, expense, net: income - expense }
}

/** 占比（0-100），total 为 0 时返回 0 */
export function percentOf(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}
