import test from 'node:test'
import assert from 'node:assert/strict'
import {
  amountFilterParams,
  amountLabel,
  buildBuckets,
  buildCategoryShares,
  buildPieData,
  bucketTotals,
  categoryFilterIds,
  categoryIcon,
  categoryIdOr,
  categoryOrFilter,
  categorySubtreeIds,
  monthBounds,
  percentOf,
  PIE_COLORS,
  shareScopeIds,
} from '../lib/bill-stats.ts'

/** 分类：餐饮（外卖 / 买菜）、交通（无图标） */
const categories = [
  { id: 'food', parent_id: null, name: '餐饮', icon: '🍜' },
  { id: 'food-takeout', parent_id: 'food', name: '外卖', icon: '🥡' },
  { id: 'food-market', parent_id: 'food', name: '买菜', icon: '🥬' },
  { id: 'traffic', parent_id: null, name: '交通', icon: '' },
]

// ─── 分类图标与子树 ───────────────────────────────────────────────────────────

test('categoryIcon：有图标用图标，空值兜底 💰', () => {
  assert.equal(categoryIcon({ icon: '🍜' }), '🍜')
  assert.equal(categoryIcon({ icon: '' }), '💰')
  assert.equal(categoryIcon(null), '💰')
  assert.equal(categoryIcon(undefined), '💰')
})

test('categorySubtreeIds：一级分类包含所有子孙分类（多级）', () => {
  const threeLevels = [
    { id: 'root', parent_id: null },
    { id: 'mid', parent_id: 'root' },
    { id: 'leaf', parent_id: 'mid' },
    { id: 'other', parent_id: null },
  ]
  assert.deepEqual([...categorySubtreeIds(threeLevels, 'root')], ['root', 'mid', 'leaf'])
  assert.deepEqual([...categorySubtreeIds(threeLevels, 'mid')], ['mid', 'leaf'])
  assert.deepEqual([...categorySubtreeIds(threeLevels, 'leaf')], ['leaf'])
})

// ─── 时间区间与 SQL 条件 ─────────────────────────────────────────────────────

test('monthBounds：全年 / 指定月 / 12 月跨年', () => {
  assert.deepEqual(monthBounds('2026', 'all'), {
    start: '2026-01-01T00:00:00',
    end: '2027-01-01T00:00:00',
  })
  assert.deepEqual(monthBounds('2026'), {
    start: '2026-01-01T00:00:00',
    end: '2027-01-01T00:00:00',
  })
  assert.deepEqual(monthBounds('2026', '3'), {
    start: '2026-03-01T00:00:00',
    end: '2026-04-01T00:00:00',
  })
  assert.deepEqual(monthBounds('2026', '12'), {
    start: '2026-12-01T00:00:00',
    end: '2027-01-01T00:00:00',
  })
})

test('categoryIdOr：一级 / 二级分类两列都匹配', () => {
  assert.equal(categoryIdOr(['a', 'b']), 'category_id.in.(a,b),subcategory_id.in.(a,b)')
})

test('categoryOrFilter：未选分类返回 null', () => {
  assert.equal(categoryOrFilter(null, null), null)
  assert.equal(categoryOrFilter('', ['food']), null)
})

test('categoryOrFilter：一级分类展开全部二级分类（下钻「宝宝教育」）', () => {
  assert.equal(
    categoryOrFilter('food', ['food', 'food-takeout', 'food-market']),
    'category_id.eq.food,subcategory_id.eq.food,subcategory_id.in.(food-takeout,food-market)',
  )
})

test('categoryOrFilter：二级分类只匹配自身，没有子分类时省略 in 条件', () => {
  assert.equal(
    categoryOrFilter('food-takeout', ['food-takeout']),
    'category_id.eq.food-takeout,subcategory_id.eq.food-takeout',
  )
  assert.equal(
    categoryOrFilter('food-takeout', null),
    'category_id.eq.food-takeout,subcategory_id.eq.food-takeout',
  )
})

// ─── 金额筛选 ────────────────────────────────────────────────────────────────

test('amountLabel：各筛选类型的胶囊文案', () => {
  assert.equal(amountLabel('all', '', ''), '金额')
  assert.equal(amountLabel('gte100', '', ''), '金额 ≥ 100')
  assert.equal(amountLabel('gte500', '', ''), '金额 ≥ 500')
  assert.equal(amountLabel('custom', '', ''), '金额 0-不限')
  assert.equal(amountLabel('custom', '100', '500'), '金额 100-500')
})

test('amountFilterParams：预设档位不带自定义金额', () => {
  assert.deepEqual(amountFilterParams('all', '100', '500'), {
    minAmount: null,
    maxAmount: null,
    excludeZero: false,
  })
  assert.deepEqual(amountFilterParams('gte100', '', ''), {
    minAmount: 100,
    maxAmount: null,
    excludeZero: false,
  })
  assert.deepEqual(amountFilterParams('gte500', '', ''), {
    minAmount: 500,
    maxAmount: null,
    excludeZero: false,
  })
})

test('amountFilterParams：自定义范围解析数字，空值 / 非法值按未填写', () => {
  assert.deepEqual(amountFilterParams('custom', '18.5', '200'), {
    minAmount: 18.5,
    maxAmount: 200,
    excludeZero: false,
  })
  assert.deepEqual(amountFilterParams('custom', '  ', '100'), {
    minAmount: null,
    maxAmount: 100,
    excludeZero: false,
  })
  assert.deepEqual(amountFilterParams('custom', 'abc', '0'), {
    minAmount: null,
    maxAmount: 0,
    excludeZero: false,
  })
})

// ─── 分类范围推导 ────────────────────────────────────────────────────────────

test('categoryFilterIds：未选不加条件，分类列表里找不到时仍按传入 id 过滤', () => {
  assert.equal(categoryFilterIds(categories, ''), null)
  assert.deepEqual(categoryFilterIds(categories, 'missing'), ['missing'])
})

test('categoryFilterIds：选一级带出所有二级，选二级只查自己', () => {
  assert.deepEqual(categoryFilterIds(categories, 'food'), ['food', 'food-takeout', 'food-market'])
  assert.deepEqual(categoryFilterIds(categories, 'food-takeout'), ['food-takeout'])
  assert.deepEqual(categoryFilterIds(categories, 'traffic'), ['traffic'])
})

test('shareScopeIds：选二级时统计同一父级下的兄弟分类', () => {
  assert.deepEqual(shareScopeIds(categories, 'food-takeout'), ['food', 'food-takeout', 'food-market'])
  assert.deepEqual(shareScopeIds(categories, 'food'), ['food', 'food-takeout', 'food-market'])
  assert.equal(shareScopeIds(categories, ''), null)
})

// ─── 分类支出列表 ────────────────────────────────────────────────────────────

test('buildCategoryShares：映射名称 / 图标，过滤 0 元并按金额降序', () => {
  const shares = buildCategoryShares(
    [
      { category_id: 'traffic', total_expense: 40 },
      { category_id: 'food', total_expense: 100 },
      { category_id: 'food-takeout', total_expense: 60 },
      { category_id: null, total_expense: 50 },
      { category_id: 'food-market', total_expense: 0 },
    ],
    categories,
  )

  assert.deepEqual(
    shares.map((share) => [share.id, share.name, share.emoji, share.value]),
    [
      ['food', '餐饮', '🍜', 100],
      ['food-takeout', '外卖', '🥡', 60],
      [null, '未分类', '❓', 50],
      ['traffic', '交通', '💰', 40],
    ],
  )
})

test('buildCategoryShares：选中一级或二级时，一级分类标注「未细分」', () => {
  const rows = [{ category_id: 'food', total_expense: 100 }]
  assert.equal(buildCategoryShares(rows, categories, 'food')[0].name, '餐饮（未细分）')
  assert.equal(buildCategoryShares(rows, categories, 'food-takeout')[0].name, '餐饮（未细分）')
  assert.equal(buildCategoryShares(rows, categories, 'traffic')[0].name, '餐饮')
  assert.equal(buildCategoryShares(rows, categories)[0].name, '餐饮')
})

test('buildCategoryShares：分类已删除时用 RPC 返回的分类名兜底', () => {
  const shares = buildCategoryShares(
    [{ category_id: 'deleted', category_name: '旧分类', total_expense: 12 }],
    categories,
  )
  assert.deepEqual(shares, [{ id: 'deleted', name: '旧分类', emoji: '💰', value: 12 }])
})

// ─── 饼图 / 柱状图 ───────────────────────────────────────────────────────────

test('buildPieData：前 5 个保留，其余合并为「其他」', () => {
  const shares = [1, 2, 3, 4, 5, 6, 7].map((value) => ({
    id: `c${value}`,
    name: `分类${value}`,
    emoji: '🍜',
    value,
  }))
  const pie = buildPieData(shares)

  assert.equal(pie.length, 6)
  assert.deepEqual(
    pie.slice(0, 5).map((item) => item.value),
    [7, 6, 5, 4, 3],
  )
  assert.deepEqual(pie[5], { id: null, name: '其他', emoji: '📦', value: 3, fill: PIE_COLORS[5] })
  assert.deepEqual(
    pie.slice(0, 5).map((item) => item.fill),
    PIE_COLORS.slice(0, 5),
  )
  // 不修改传入数组的顺序
  assert.equal(shares[0].value, 1)
})

test('buildPieData：不超过 5 个分类时没有「其他」', () => {
  const shares = [
    { id: 'a', name: 'A', emoji: '🍜', value: 2 },
    { id: 'b', name: 'B', emoji: '🍜', value: 1 },
  ]
  const pie = buildPieData(shares)
  assert.equal(pie.length, 2)
  assert.deepEqual(
    pie.map((item) => item.name),
    ['A', 'B'],
  )
})

test('buildBuckets：每月收入 / 支出 / 结余', () => {
  const buckets = buildBuckets([
    { bucket: '2026-01', total_income: 1000, total_expense: 300 },
    { bucket: '2026-02', total_income: 0, total_expense: 500 },
  ])

  assert.deepEqual(buckets, [
    { key: '2026-01', label: '2026-01', income: 1000, expense: 300, net: 700 },
    { key: '2026-02', label: '2026-02', income: 0, expense: 500, net: -500 },
  ])
})

test('bucketTotals：合计收入 / 支出 / 结余；空数据全为 0', () => {
  assert.deepEqual(bucketTotals([]), { income: 0, expense: 0, net: 0 })
  assert.deepEqual(
    bucketTotals(buildBuckets([
      { bucket: '2026-01', total_income: 1000, total_expense: 300 },
      { bucket: '2026-02', total_income: 200, total_expense: 500 },
    ])),
    { income: 1200, expense: 800, net: 400 },
  )
})

test('percentOf：total 为 0 时返回 0，否则返回百分比', () => {
  assert.equal(percentOf(0, 0), 0)
  assert.equal(percentOf(50, 200), 25)
  assert.equal(percentOf(1, 3), 1 / 3 * 100)
})
