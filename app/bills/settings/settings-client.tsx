'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { describeBillError, isMissingBillTable } from '@/lib/bills'
import {
  deleteBillCategory,
  deleteBillRule,
  fetchBillCategories,
  fetchBillRules,
  insertBillCategory,
  insertBillRule,
  updateBillCategory,
  type BillCategory,
  type BillCategoryRule,
  type BillRuleField,
} from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

/** 分类图标候选：都是账单里常见的场景 */
const EMOJIS = ['🥬', '🍚', '🛒', '☕', '🍜', '🚗', '🚌', '💊', '🎓', '🏠', '👕', '🎁', '💡', '🐱', '✈️', '📱', '🧾', '💰']

const FIELD_LABELS: Record<BillRuleField, string> = {
  counterparty: '交易对方',
  commodity: '商品说明',
  all: '全部',
}

type CategoryDraft = { id?: string; name: string; emoji: string }
type RuleDraft = { keyword: string; field: BillRuleField; priority: string }

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
        className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-base font-bold">{title}</h3>
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

/** 分类与规则配置 */
export function SettingsClient() {
  const [categories, setCategories] = useState<BillCategory[]>([])
  const [rules, setRules] = useState<BillCategoryRule[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null)
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [categoryList, ruleList] = await Promise.all([fetchBillCategories(), fetchBillRules()])
      setCategories(categoryList)
      setRules(ruleList)
      setSelectedId((prev) =>
        prev && categoryList.some((item) => item.id === prev) ? prev : (categoryList[0]?.id ?? ''),
      )
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
        await updateBillCategory(categoryDraft.id, { name, emoji: categoryDraft.emoji })
        setCategories((prev) =>
          prev.map((item) =>
            item.id === categoryDraft.id ? { ...item, name, emoji: categoryDraft.emoji } : item,
          ),
        )
      } else {
        const created = await insertBillCategory({ name, emoji: categoryDraft.emoji })
        setCategories((prev) => [...prev, created])
        setSelectedId(created.id)
      }
      setCategoryDraft(null)
    } catch (err) {
      setFormError(describeBillError(err))
    } finally {
      setSaving(false)
    }
  }

  const removeCategory = async (category: BillCategory) => {
    if (!confirm(`删除分类「${category.name}」？该分类下的规则会一并删除。`)) return
    try {
      await deleteBillCategory(category.id)
      setCategories((prev) => prev.filter((item) => item.id !== category.id))
      setRules((prev) => prev.filter((rule) => rule.category_id !== category.id))
      if (selectedId === category.id) {
        setSelectedId(categories.find((item) => item.id !== category.id)?.id ?? '')
      }
    } catch (err) {
      setError(`删除分类失败：${describeBillError(err)}`)
    }
  }

  const saveRule = async () => {
    if (!ruleDraft || !selected) return
    const keyword = ruleDraft.keyword.trim()
    if (!keyword) {
      setFormError('匹配关键词不能为空')
      return
    }
    const priority = Number(ruleDraft.priority)
    if (!Number.isFinite(priority)) {
      setFormError('优先级需要填数字')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const created = await insertBillRule({
        categoryId: selected.id,
        keyword,
        matchField: ruleDraft.field,
        priority,
      })
      setRules((prev) => [...prev, created].sort((a, b) => b.priority - a.priority))
      setRuleDraft(null)
    } catch (err) {
      setFormError(describeBillError(err))
    } finally {
      setSaving(false)
    }
  }

  const removeRule = async (rule: BillCategoryRule) => {
    if (!confirm(`删除规则「${rule.keyword}」？`)) return
    try {
      await deleteBillRule(rule.id)
      setRules((prev) => prev.filter((item) => item.id !== rule.id))
    } catch (err) {
      setError(`删除规则失败：${describeBillError(err)}`)
    }
  }

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col overflow-hidden">
      <PageHeader
        title="分类与规则"
        subtitle="给账单配好分类，按关键词自动归类"
        backHref="/bills"
        backLabel="返回账单"
        action={
          <button
            type="button"
            onClick={() => {
              setFormError('')
              setCategoryDraft({ name: '', emoji: EMOJIS[0] })
            }}
            className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary/90"
          >
            + 新增分类
          </button>
        }
      />

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-4 pb-4 md:px-6 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:items-stretch lg:gap-5">
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 lg:col-span-2">
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

        {/* 左：分类列表 */}
        <section className="flex max-h-[38dvh] min-h-0 flex-col rounded-2xl border bg-card lg:max-h-none">
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <h2 className="text-sm font-bold">分类</h2>
            <span className="text-xs text-muted-foreground">{categories.length} 个</span>
          </header>

          {loading ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">正在读取分类…</p>
          ) : categories.length === 0 ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
              还没有分类，点右上角「+ 新增分类」创建一个吧
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
              {categories.map((category) => (
                <li key={category.id}>
                  <div
                    className={cn(
                      'flex items-center gap-1 px-2 py-1.5',
                      selectedId === category.id && 'bg-primary/5',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(category.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-muted/60"
                    >
                      <span className="text-xl">{category.emoji}</span>
                      <span className="truncate text-sm font-medium">{category.name}</span>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {ruleCount(category.id)} 条规则
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`编辑 ${category.name}`}
                      onClick={() => {
                        setFormError('')
                        setCategoryDraft({ id: category.id, name: category.name, emoji: category.emoji })
                      }}
                      className="rounded-lg px-2 py-1 text-sm hover:bg-muted"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${category.name}`}
                      onClick={() => void removeCategory(category)}
                      className="rounded-lg px-2 py-1 text-sm hover:bg-muted"
                    >
                      🗑️
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 右：所选分类的规则 */}
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card">
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <h2 className="min-w-0 truncate text-sm font-bold">
              {selected ? `${selected.emoji} ${selected.name} 的规则` : '归类规则'}
            </h2>
            <button
              type="button"
              disabled={!selected}
              onClick={() => {
                setFormError('')
                setRuleDraft({ keyword: '', field: 'counterparty', priority: '100' })
              }}
              className="ml-auto shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              + 添加规则
            </button>
          </header>

          {!selected ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
              先在左侧选一个分类
            </p>
          ) : selectedRules.length === 0 ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
              还没有规则，添加「盒马」「山姆」这类关键词试试
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
              {selectedRules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{rule.keyword}</span>
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                    {FIELD_LABELS[rule.match_field] ?? rule.match_field}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    优先级 {rule.priority}
                  </span>
                  <button
                    type="button"
                    aria-label={`删除规则 ${rule.keyword}`}
                    onClick={() => void removeRule(rule)}
                    className="shrink-0 rounded-lg px-2 py-1 text-sm hover:bg-muted"
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && selectedRules.length > 0 && (
            <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">
              同一笔账单命中多条规则时，优先级数字大的先生效
            </p>
          )}
        </section>
      </div>

      {categoryDraft && (
        <Modal
          title={categoryDraft.id ? '编辑分类' : '新增分类'}
          onClose={() => setCategoryDraft(null)}
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
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

            <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              选择图标
              <div className="grid grid-cols-6 gap-1.5">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() =>
                      setCategoryDraft((prev) => (prev ? { ...prev, emoji } : prev))
                    }
                    className={cn(
                      'rounded-xl border py-1.5 text-lg',
                      categoryDraft.emoji === emoji
                        ? 'border-primary bg-primary/10'
                        : 'border-transparent bg-muted',
                    )}
                  >
                    {emoji}
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
        <Modal title={`给「${selected.name}」添加规则`} onClose={() => setRuleDraft(null)}>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              匹配关键词
              <input
                autoFocus
                value={ruleDraft.keyword}
                onChange={(event) =>
                  setRuleDraft((prev) => (prev ? { ...prev, keyword: event.target.value } : prev))
                }
                placeholder="如：盒马、山姆"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              匹配字段
              <select
                value={ruleDraft.field}
                onChange={(event) =>
                  setRuleDraft((prev) =>
                    prev ? { ...prev, field: event.target.value as BillRuleField } : prev,
                  )
                }
                className={inputClass}
              >
                <option value="counterparty">交易对方</option>
                <option value="commodity">商品说明</option>
                <option value="all">全部</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              优先级（数字越大越优先）
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

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRuleDraft(null)}
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
