'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { describeBillError, isMissingBillTable, sourceTag } from '@/lib/bills'
import {
  categoryIcon,
  deleteBillCategory,
  deleteBillRule,
  fetchBillCategories,
  fetchBillRules,
  insertBillCategory,
  insertBillRule,
  updateBillCategory,
  updateBillRule,
  type BillCategory,
  type BillRule,
  type BillRuleInput,
} from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

/** 规则匹配方式：全部条件满足 / 任一条件满足 */
type BillRuleMatchType = 'all' | 'any'

/** 分类图标候选：都是账单里常见的场景 */
const ICONS = ['🥬', '🍚', '🛒', '☕', '🍜', '🚗', '🚌', '💊', '🎓', '🏠', '👕', '🎁', '💡', '🐱', '✈️', '📱', '🧾', '💰']

/** 收/支类型文案（取值以库里已有数据为准） */
const CATEGORY_TYPE_LABELS: Record<string, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
}
const categoryTypeLabel = (value: string) => CATEGORY_TYPE_LABELS[value] ?? (value || '未设置')

/** 规则来源：空表示不限 */
const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '不限来源' },
  { value: 'wechat', label: '微信' },
  { value: 'alipay', label: '支付宝' },
  { value: 'manual', label: '手工记账' },
]

/** 规则收支方向：空表示不限 */
const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '不限收支' },
  { value: '支出', label: '仅支出' },
  { value: '收入', label: '仅收入' },
]

/** 规则里的方向值兼容中英文 */
const directionLabel = (value: string | null) => {
  if (!value) return ''
  const text = value.toLowerCase()
  if (text.includes('支') || ['expense', 'out', 'debit'].includes(text)) return '支出'
  if (text.includes('收') || ['income', 'in', 'credit'].includes(text)) return '收入'
  return value
}

const MATCH_TYPE_LABELS: Record<string, string> = {
  all: '全部满足',
  any: '任一满足',
}

type CategoryDraft = {
  id?: string
  name: string
  icon: string
  categoryType: string
  parentId?: string | null
}

type RuleDraft = {
  ruleName: string
  priority: string
  source: string
  direction: string
  tradeTypePattern: string
  counterpartyPattern: string
  commodityPattern: string
  matchType: BillRuleMatchType
  amountMin: string
  amountMax: string
  /** 所属分类：编辑时允许把规则移到另一个分类 */
  categoryId: string
}

/** 通用弹窗外壳：手机从底部弹出，iPad 居中 */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl sm:rounded-2xl sm:pb-4"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto rounded-full px-2 py-0.5 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-primary'

const fieldLabelClass = 'flex flex-col gap-1 text-xs font-medium text-muted-foreground'

/** 数字输入 → number | null */
const parseAmount = (value: string): number | null => {
  const text = value.trim()
  if (!text) return null
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

/** 规则条件摘要（列表展示用） */
function ruleConditionSummary(rule: BillRule): string {
  const parts: string[] = []
  const add = (label: string, pattern: string | null) => {
    const value = (pattern ?? '').trim()
    if (value) parts.push(`${label}包含「${value}」`)
  }
  add('交易类型', rule.trade_type_pattern)
  add('交易对方', rule.counterparty_pattern)
  add('商品说明', rule.commodity_pattern)
  if (rule.amount_min != null || rule.amount_max != null) {
    parts.push(`金额 ${rule.amount_min ?? 0}~${rule.amount_max ?? '不限'}`)
  }
  if (rule.source) parts.push(`来源 ${sourceTag(rule.source)?.label ?? rule.source}`)
  if (rule.direction) parts.push(`方向 ${directionLabel(rule.direction)}`)
  if (parts.length === 0) return '无附加条件'
  return parts.join(' · ')
}

/** 分类与规则配置 */
export function RulesClient() {
  const [categories, setCategories] = useState<BillCategory[]>([])
  const [rules, setRules] = useState<BillRule[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null)
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null)
  /** 非空表示正在编辑这条规则，为空表示新增 */
  const [editingRuleId, setEditingRuleId] = useState('')
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [categoryList, ruleList] = await Promise.all([fetchBillCategories(), fetchBillRules()])
      setCategories(categoryList)
      setRules(ruleList)
      setSelectedId((prev) => (prev && categoryList.some((item) => item.id === prev) ? prev : ''))
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[BillsSettings] 读取分类失败:', detail, err)
      setError(
        isMissingBillTable(err)
          ? '分类表还没创建：请在 Supabase 执行 scripts/create-bill-categories.sql'
          : `读取分类失败：${detail}`,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = categories.find((item) => item.id === selectedId) ?? null
  const selectedRules = useMemo(
    () => rules.filter((rule) => rule.category_id === selectedId),
    [rules, selectedId],
  )
  const ruleCount = (categoryId: string) => rules.filter((rule) => rule.category_id === categoryId).length

  /** 一级分类：没有父级，或父级已不存在的孤儿分类 */
  const topCategories = categories.filter(
    (item) => !item.parent_id || !categories.some((parent) => parent.id === item.parent_id),
  )
  const childCategories = (parentId: string) =>
    categories.filter((item) => item.parent_id === parentId)

  /** 库里已有的收支类型（新增分类时直接复用，避免猜取值） */
  const categoryTypes = useMemo(() => {
    const values = new Set(categories.map((item) => item.category_type).filter(Boolean))
    if (values.size === 0) values.add('expense')
    return [...values]
  }, [categories])

  const defaultCategoryType = (parentId?: string | null) => {
    const parent = parentId ? categories.find((item) => item.id === parentId) : undefined
    return parent?.category_type ?? categoryTypes[0] ?? 'expense'
  }

  const saveCategory = async () => {
    if (!categoryDraft) return
    const name = categoryDraft.name.trim()
    if (!name) {
      setFormError('分类名称不能为空')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (categoryDraft.id) {
        await updateBillCategory(categoryDraft.id, { name, icon: categoryDraft.icon })
        setCategories((prev) =>
          prev.map((item) =>
            item.id === categoryDraft.id ? { ...item, name, icon: categoryDraft.icon } : item,
          ),
        )
      } else {
        const created = await insertBillCategory({
          name,
          icon: categoryDraft.icon,
          categoryType: categoryDraft.categoryType,
          parentId: categoryDraft.parentId ?? null,
        })
        setCategories((prev) => [...prev, created])
      }
      setCategoryDraft(null)
    } catch (err) {
      setFormError(describeBillError(err))
    } finally {
      setSaving(false)
    }
  }

  const removeCategory = async (category: BillCategory) => {
    const children = childCategories(category.id)
    const hint =
      children.length > 0
        ? `删除分类「${category.name}」？它下面的 ${children.length} 个子分类和所有相关规则会一并删除。`
        : `删除分类「${category.name}」？该分类下的规则会一并删除。`
    if (!confirm(hint)) return
    try {
      await deleteBillCategory(category.id)
      const removedIds = new Set([category.id, ...children.map((child) => child.id)])
      setCategories((prev) => prev.filter((item) => !removedIds.has(item.id)))
      setRules((prev) => prev.filter((rule) => !removedIds.has(rule.category_id)))
      if (removedIds.has(selectedId)) setSelectedId('')
    } catch (err) {
      setError(`删除分类失败：${describeBillError(err)}`)
    }
  }

  /** 打开「添加规则」弹窗（清空编辑状态） */
  const openCreateRule = (categoryId: string) => {
    setFormError('')
    setEditingRuleId('')
    setRuleDraft({
      ruleName: '',
      priority: '100',
      source: '',
      direction: '',
      tradeTypePattern: '',
      counterpartyPattern: '',
      commodityPattern: '',
      matchType: 'all',
      amountMin: '',
      amountMax: '',
      categoryId,
    })
  }

  /** 打开「编辑规则」弹窗并回填当前规则数据 */
  const openEditRule = (rule: BillRule) => {
    setFormError('')
    setEditingRuleId(rule.id)
    setRuleDraft({
      ruleName: rule.rule_name,
      priority: String(rule.priority),
      source: rule.source ?? '',
      direction: rule.direction ?? '',
      tradeTypePattern: rule.trade_type_pattern ?? '',
      counterpartyPattern: rule.counterparty_pattern ?? '',
      commodityPattern: rule.commodity_pattern ?? '',
      matchType: rule.match_type === 'any' ? 'any' : 'all',
      amountMin: rule.amount_min == null ? '' : String(rule.amount_min),
      amountMax: rule.amount_max == null ? '' : String(rule.amount_max),
      categoryId: rule.category_id,
    })
  }

  /** 关闭规则弹窗并清空编辑状态 */
  const closeRuleDraft = () => {
    setRuleDraft(null)
    setEditingRuleId('')
    setFormError('')
  }

  const saveRule = async () => {
    if (!ruleDraft || !selected) return
    const ruleName = ruleDraft.ruleName.trim()
    if (!ruleName) {
      setFormError('规则名称不能为空')
      return
    }
    const priority = Number(ruleDraft.priority)
    if (!Number.isFinite(priority)) {
      setFormError('优先级需要填数字')
      return
    }
    const categoryId = ruleDraft.categoryId || selected.id
    if (!categoryId) {
      setFormError('请选择所属分类')
      return
    }

    const input: BillRuleInput = {
      categoryId,
      ruleName,
      priority,
      source: ruleDraft.source || null,
      direction: ruleDraft.direction || null,
      tradeTypePattern: ruleDraft.tradeTypePattern.trim() || null,
      counterpartyPattern: ruleDraft.counterpartyPattern.trim() || null,
      commodityPattern: ruleDraft.commodityPattern.trim() || null,
      matchType: ruleDraft.matchType,
      amountMin: parseAmount(ruleDraft.amountMin),
      amountMax: parseAmount(ruleDraft.amountMax),
    }

    const hasCondition = Boolean(
      input.source ||
        input.direction ||
        input.tradeTypePattern ||
        input.counterpartyPattern ||
        input.commodityPattern ||
        input.amountMin != null ||
        input.amountMax != null,
    )
    if (!hasCondition) {
      setFormError('至少填写一个匹配条件（来源 / 方向 / 关键词 / 金额）')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      if (editingRuleId) {
        const updated = await updateBillRule(editingRuleId, input)
        setRules((prev) =>
          prev
            .map((rule) => (rule.id === updated.id ? updated : rule))
            .sort((a, b) => a.priority - b.priority),
        )
      } else {
        const created = await insertBillRule(input)
        setRules((prev) => [...prev, created].sort((a, b) => a.priority - b.priority))
      }
      closeRuleDraft()
    } catch (err) {
      setFormError(describeBillError(err))
    } finally {
      setSaving(false)
    }
  }

  const removeRule = async (rule: BillRule) => {
    if (!confirm(`删除规则「${rule.rule_name}」？`)) return
    try {
      await deleteBillRule(rule.id)
      setRules((prev) => prev.filter((item) => item.id !== rule.id))
    } catch (err) {
      setError(`删除规则失败：${describeBillError(err)}`)
    }
  }

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden">
      <PageHeader
        title="分类与规则"
        subtitle={selected ? '这个分类下的自动归类规则' : '按来源 / 方向 / 关键词自动归类'}
        backHref="/bills/import"
        backLabel="返回账单"
        action={
          selected ? undefined : (
            <button
              type="button"
              onClick={() => {
                setFormError('')
                setCategoryDraft({ name: '', icon: ICONS[0], categoryType: defaultCategoryType() })
              }}
              className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white active:bg-primary/90"
            >
              + 新增分类
            </button>
          )
        }
      />

      <div className="mx-auto w-full max-w-full overflow-x-hidden px-4 pb-24">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900"
            >
              重试
            </button>
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">正在读取分类…</p>
        ) : selected ? (
          /* 第二步：某分类下的规则列表 */
          <section>
            {/* 第一行：返回 + 添加规则 */}
            <div className="mb-2 flex w-full min-w-0 items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedId('')
                  setFormError('')
                }}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 active:bg-slate-200"
              >
                ← 返回
              </button>
              <button
                type="button"
                onClick={() => openCreateRule(selected.id)}
                className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white active:bg-primary/90"
              >
                + 添加规则
              </button>
            </div>

            {/* 第二行：当前分类标题 + 规则数量 */}
            <div className="mb-2 min-w-0">
              <h2 className="truncate text-lg font-bold">
                {categoryIcon(selected)} {selected.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedRules.length} 条规则 · {categoryTypeLabel(selected.category_type)}
              </p>
            </div>

            {childCategories(selected.id).length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {childCategories(selected.id).map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => setSelectedId(child.id)}
                    className="max-w-full truncate rounded-full border bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
                  >
                    {categoryIcon(child)} {child.name}
                  </button>
                ))}
              </div>
            )}

            {selectedRules.length === 0 ? (
              <p className="whitespace-normal break-words rounded-xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                还没有规则，添加「盒马」「山姆」这类关键词试试
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {selectedRules.map((rule) => (
                  <li key={rule.id} className="flex min-w-0 items-center gap-2 rounded-2xl border bg-card px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-base font-semibold">{rule.rule_name}</span>
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {ruleConditionSummary(rule)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {MATCH_TYPE_LABELS[rule.match_type] ?? rule.match_type} · 优先级 {rule.priority}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`编辑规则 ${rule.rule_name}`}
                      onClick={() => openEditRule(rule)}
                      className="shrink-0 rounded-full px-3 py-2 text-base active:bg-muted"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      aria-label={`删除规则 ${rule.rule_name}`}
                      onClick={() => void removeRule(rule)}
                      className="shrink-0 rounded-full px-3 py-2 text-base active:bg-muted"
                    >
                      🗑️
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedRules.length > 0 && (
              <p className="mt-3 rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                同一笔账单命中多条规则时，优先级数字小的先生效；优先级相同时二级分类优先
              </p>
            )}
          </section>
        ) : (
          /* 第一步：分类列表 */
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-bold">分类</h2>
              <span className="text-xs text-muted-foreground">{categories.length} 个</span>
            </div>

            {categories.length === 0 ? (
              <p className="whitespace-normal break-words rounded-xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                还没有分类，点右上角「+ 新增分类」创建一个吧
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {topCategories.map((parent) => {
                  const children = childCategories(parent.id)
                  return (
                    <li key={parent.id} className="overflow-hidden rounded-2xl border bg-card">
                      <div className="flex min-w-0 items-center gap-1 p-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(parent.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="text-2xl">{categoryIcon(parent)}</span>
                          <span className="min-w-0">
                            <span className="block truncate text-base font-semibold">{parent.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {ruleCount(parent.id)} 条规则 · {categoryTypeLabel(parent.category_type)}
                              {children.length > 0 ? ` · ${children.length} 个子分类` : ''}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`在 ${parent.name} 下添加子分类`}
                          onClick={() => {
                            setFormError('')
                            setCategoryDraft({
                              name: '',
                              icon: categoryIcon(parent),
                              categoryType: parent.category_type,
                              parentId: parent.id,
                            })
                          }}
                          className="rounded-full px-3 py-2 text-sm font-bold text-primary active:bg-muted"
                        >
                          ＋
                        </button>
                        <button
                          type="button"
                          aria-label={`编辑 ${parent.name}`}
                          onClick={() => {
                            setFormError('')
                            setCategoryDraft({
                              id: parent.id,
                              name: parent.name,
                              icon: categoryIcon(parent),
                              categoryType: parent.category_type,
                              parentId: parent.parent_id,
                            })
                          }}
                          className="rounded-full px-2.5 py-2 text-sm active:bg-muted"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${parent.name}`}
                          onClick={() => void removeCategory(parent)}
                          className="rounded-full px-2.5 py-2 text-sm active:bg-muted"
                        >
                          🗑️
                        </button>
                      </div>

                      {children.length > 0 && (
                        <ul className="border-t">
                          {children.map((child) => (
                            <li
                              key={child.id}
                              className="flex min-w-0 items-center gap-1 border-b px-3 py-2 last:border-b-0"
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedId(child.id)}
                                className="flex min-w-0 flex-1 items-center gap-2 pl-4 text-left"
                              >
                                <span className="text-lg">{categoryIcon(child)}</span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">{child.name}</span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {ruleCount(child.id)} 条规则
                                  </span>
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label={`编辑 ${child.name}`}
                                onClick={() => {
                                  setFormError('')
                                  setCategoryDraft({
                                    id: child.id,
                                    name: child.name,
                                    icon: categoryIcon(child),
                                    categoryType: child.category_type,
                                    parentId: child.parent_id,
                                  })
                                }}
                                className="rounded-full px-2.5 py-2 text-sm active:bg-muted"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                aria-label={`删除 ${child.name}`}
                                onClick={() => void removeCategory(child)}
                                className="rounded-full px-2.5 py-2 text-sm active:bg-muted"
                              >
                                🗑️
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {categoryDraft && (
        <Modal
          title={
            categoryDraft.id
              ? '编辑分类'
              : categoryDraft.parentId
                ? '添加子分类'
                : '新增分类'
          }
          onClose={() => setCategoryDraft(null)}
        >
          <div className="flex flex-col gap-3">
            {!categoryDraft.id && categoryDraft.parentId && (
              <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                父级分类：
                <span className="font-semibold text-foreground">
                  {categories.find((item) => item.id === categoryDraft.parentId)?.name ?? '—'}
                </span>
              </p>
            )}
            <label className={fieldLabelClass}>
              分类名称
              <input
                autoFocus
                value={categoryDraft.name}
                onChange={(event) =>
                  setCategoryDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                }
                placeholder="如：买菜"
                className={inputClass}
              />
            </label>

            {!categoryDraft.id && (
              <label className={fieldLabelClass}>
                收支类型
                <select
                  value={categoryDraft.categoryType}
                  onChange={(event) =>
                    setCategoryDraft((prev) =>
                      prev ? { ...prev, categoryType: event.target.value } : prev,
                    )
                  }
                  className={inputClass}
                >
                  {categoryTypes.map((value) => (
                    <option key={value} value={value}>
                      {categoryTypeLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              选择图标
              <div className="grid grid-cols-6 gap-1.5">
                {ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setCategoryDraft((prev) => (prev ? { ...prev, icon } : prev))}
                    className={cn(
                      'rounded-xl border py-1.5 text-lg',
                      categoryDraft.icon === icon
                        ? 'border-primary bg-orange-50'
                        : 'border-transparent bg-muted',
                    )}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCategoryDraft(null)}
                className="flex-1 rounded-xl bg-muted py-2 text-sm font-semibold"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveCategory()}
                className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {ruleDraft && selected && (
        <Modal
          title={editingRuleId ? '编辑规则' : `给「${selected.name}」添加规则`}
          onClose={closeRuleDraft}
        >
          <div className="flex flex-col gap-3">
            <label className={fieldLabelClass}>
              规则名称
              <input
                autoFocus
                value={ruleDraft.ruleName}
                onChange={(event) =>
                  setRuleDraft((prev) => (prev ? { ...prev, ruleName: event.target.value } : prev))
                }
                placeholder="如：超市买菜"
                className={inputClass}
              />
            </label>

            <label className={fieldLabelClass}>
              所属分类
              <select
                value={ruleDraft.categoryId}
                onChange={(event) =>
                  setRuleDraft((prev) =>
                    prev ? { ...prev, categoryId: event.target.value } : prev,
                  )
                }
                className={inputClass}
              >
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.parent_id ? '　↳ ' : ''}
                    {categoryIcon(item)} {item.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className={fieldLabelClass}>
                优先级（越小越优先）
                <input
                  type="number"
                  inputMode="numeric"
                  value={ruleDraft.priority}
                  onChange={(event) =>
                    setRuleDraft((prev) => (prev ? { ...prev, priority: event.target.value } : prev))
                  }
                  className={inputClass}
                />
              </label>
              <label className={fieldLabelClass}>
                数据来源
                <select
                  value={ruleDraft.source}
                  onChange={(event) =>
                    setRuleDraft((prev) => (prev ? { ...prev, source: event.target.value } : prev))
                  }
                  className={inputClass}
                >
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className={fieldLabelClass}>
                收支方向
                <select
                  value={ruleDraft.direction}
                  onChange={(event) =>
                    setRuleDraft((prev) =>
                      prev ? { ...prev, direction: event.target.value } : prev,
                    )
                  }
                  className={inputClass}
                >
                  {DIRECTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={fieldLabelClass}>
                条件关系
                <select
                  value={ruleDraft.matchType}
                  onChange={(event) =>
                    setRuleDraft((prev) =>
                      prev ? { ...prev, matchType: event.target.value as BillRuleMatchType } : prev,
                    )
                  }
                  className={inputClass}
                >
                  <option value="all">全部满足（AND）</option>
                  <option value="any">任一满足（OR）</option>
                </select>
              </label>
            </div>

            <p className="text-xs font-semibold text-muted-foreground">
              关键词条件（多个关键词用逗号分隔，留空表示不限制）
            </p>

            <label className={fieldLabelClass}>
              交易类型
              <input
                value={ruleDraft.tradeTypePattern}
                onChange={(event) =>
                  setRuleDraft((prev) =>
                    prev ? { ...prev, tradeTypePattern: event.target.value } : prev,
                  )
                }
                placeholder="如：转账,消费"
                className={inputClass}
              />
            </label>

            <label className={fieldLabelClass}>
              交易对方
              <input
                value={ruleDraft.counterpartyPattern}
                onChange={(event) =>
                  setRuleDraft((prev) =>
                    prev ? { ...prev, counterpartyPattern: event.target.value } : prev,
                  )
                }
                placeholder="如：盒马,山姆"
                className={inputClass}
              />
            </label>

            <label className={fieldLabelClass}>
              商品说明
              <input
                value={ruleDraft.commodityPattern}
                onChange={(event) =>
                  setRuleDraft((prev) =>
                    prev ? { ...prev, commodityPattern: event.target.value } : prev,
                  )
                }
                placeholder="如：蔬菜,水果"
                className={inputClass}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className={fieldLabelClass}>
                最小金额
                <input
                  type="number"
                  inputMode="decimal"
                  value={ruleDraft.amountMin}
                  onChange={(event) =>
                    setRuleDraft((prev) => (prev ? { ...prev, amountMin: event.target.value } : prev))
                  }
                  placeholder="不限"
                  className={inputClass}
                />
              </label>
              <label className={fieldLabelClass}>
                最大金额
                <input
                  type="number"
                  inputMode="decimal"
                  value={ruleDraft.amountMax}
                  onChange={(event) =>
                    setRuleDraft((prev) => (prev ? { ...prev, amountMax: event.target.value } : prev))
                  }
                  placeholder="不限"
                  className={inputClass}
                />
              </label>
            </div>

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeRuleDraft}
                className="flex-1 rounded-xl bg-muted py-2 text-sm font-semibold"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveRule()}
                className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
