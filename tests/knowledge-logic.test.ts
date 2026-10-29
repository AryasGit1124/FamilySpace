import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_MASTERY_LEVEL,
  isDue,
  isPassed,
  isTimedPassed,
  letterFromKnowledge,
  letterKnowledge,
  maxNumberForLevel,
  nextMasteryState,
  pickDueTargets,
  pickFocusIndex,
  pickLevelIndex,
  reviewIntervalDays,
  reviewTargetForIndex,
  wordFromKnowledge,
  wordKnowledge,
} from '../lib/knowledge-logic.ts'

/** 构造一条掌握度记录 */
const row = (knowledge: string, mastery_level: number, next_review_date: string) => ({
  knowledge,
  mastery_level,
  next_review_date,
})

// ─── 掌握度升降与复习节奏 ─────────────────────────────────────────────────────

test('nextMasteryState：首次答对记 1 级、连击 1、明天复习', () => {
  assert.deepEqual(nextMasteryState(0, 0, true), {
    masteryLevel: 1,
    correctStreak: 1,
    intervalDays: 1,
  })
})

test('nextMasteryState：连对 2 次升一级，间隔从 1 天延长到 3 天', () => {
  assert.deepEqual(nextMasteryState(1, 1, true), {
    masteryLevel: 2,
    correctStreak: 2,
    intervalDays: 3,
  })
})

test('nextMasteryState：满级后不再超过上限', () => {
  const state = nextMasteryState(MAX_MASTERY_LEVEL, 5, true)
  assert.equal(state.masteryLevel, MAX_MASTERY_LEVEL)
  assert.equal(state.intervalDays, 60)
})

test('nextMasteryState：答错则连击归零、等级重置为 1', () => {
  assert.deepEqual(nextMasteryState(4, 3, false), {
    masteryLevel: 1,
    correctStreak: 0,
    intervalDays: 1,
  })
})

test('reviewIntervalDays：等级 1-6 依次延长，越界按 1 天', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map(reviewIntervalDays),
    [1, 3, 7, 15, 30, 60],
  )
  assert.equal(reviewIntervalDays(0), 1)
  assert.equal(reviewIntervalDays(7), 1)
})

test('isPassed：按 75% 达标线判断，0 题视为未达标', () => {
  assert.equal(isPassed(3, 4), true)
  assert.equal(isPassed(6, 8), true)
  assert.equal(isPassed(2, 4), false)
  assert.equal(isPassed(0, 0), false)
  assert.equal(isPassed(1, 2, 0.5), true)
})

test('isDue：今天及以前到期才需要复习；0 级不算到期', () => {
  const today = '2026-10-29'
  assert.equal(isDue({ mastery_level: 1, next_review_date: today }, today), true)
  assert.equal(isDue({ mastery_level: 1, next_review_date: '2026-10-20' }, today), true)
  assert.equal(isDue({ mastery_level: 1, next_review_date: '2026-10-30' }, today), false)
  assert.equal(isDue({ mastery_level: 0, next_review_date: '2026-10-01' }, today), false)
})

// ─── 英语知识点命名与到期挑选 ─────────────────────────────────────────────────

test('英语知识点命名：字母/单词可双向解析', () => {
  assert.equal(letterKnowledge('a'), '字母A')
  assert.equal(letterKnowledge('Z'), '字母Z')
  assert.equal(wordKnowledge('Apple'), '单词Apple')

  assert.equal(letterFromKnowledge('字母A'), 'A')
  assert.equal(wordFromKnowledge('单词Apple'), 'Apple')
  assert.equal(letterFromKnowledge('单词Apple'), null)
  assert.equal(wordFromKnowledge('字母A'), null)
  assert.equal(letterFromKnowledge(null), null)
  assert.equal(letterFromKnowledge('字母'), null)
})

test('pickDueTargets：只取到期且类型匹配的知识点，等级低/到期早的排前面', () => {
  const today = '2026-10-29'
  const rows = [
    row('字母B', 2, '2026-10-29'),
    row('字母A', 1, '2026-10-20'),
    row('字母C', 1, '2026-10-29'),
    row('字母D', 3, '2026-11-05'), // 未到期
    row('字母E', 0, '2026-10-01'), // 还没练过
    row('单词Apple', 1, '2026-10-10'),
  ]

  assert.deepEqual(pickDueTargets(rows, 'letter', today), ['字母A', '字母C', '字母B'])
  assert.deepEqual(pickDueTargets(rows, 'word', today), ['单词Apple'])
  assert.deepEqual(pickDueTargets([], 'letter', today), [])
})

test('reviewTargetForIndex：前 N 题插入复习知识点，超出后返回 null', () => {
  const pool = ['字母A', '字母B']
  assert.equal(reviewTargetForIndex(pool, 0, 2), '字母A')
  assert.equal(reviewTargetForIndex(pool, 1, 2), '字母B')
  assert.equal(reviewTargetForIndex(pool, 2, 2), null)
  assert.equal(reviewTargetForIndex(['字母A'], 1, 2), '字母A')
  assert.equal(reviewTargetForIndex([], 0, 2), null)
  assert.equal(reviewTargetForIndex(pool, -1, 2), null)
})

// ─── 数学难度与今日主题 ───────────────────────────────────────────────────────

test('maxNumberForLevel：低等级 5 以内、中等级 10 以内、高等级 20 以内', () => {
  assert.equal(maxNumberForLevel(0), 5)
  assert.equal(maxNumberForLevel(1), 5)
  assert.equal(maxNumberForLevel(2), 10)
  assert.equal(maxNumberForLevel(3), 10)
  assert.equal(maxNumberForLevel(4), 20)
  assert.equal(maxNumberForLevel(6), 20)
})

test('pickFocusIndex：没有记录时从第一个新知识点开始', () => {
  const names = ['点数', '数量匹配', '比大小', '加减法']
  assert.deepEqual(pickFocusIndex([], names, '2026-10-29'), { index: 0, level: 0 })
})

test('pickFocusIndex：优先复习到期的知识点（等级低、到期早优先）', () => {
  const names = ['点数', '数量匹配', '比大小', '加减法']
  const today = '2026-10-29'
  const rows = [
    row('点数', 3, '2026-11-01'),
    row('数量匹配', 1, today),
    row('比大小', 2, '2026-10-25'),
    row('加减法', 4, '2026-11-10'),
  ]
  // 数量匹配等级最低（1）排在比大小（2）前面
  assert.deepEqual(pickFocusIndex(rows, names, today), { index: 1, level: 1 })
})

test('pickFocusIndex：没有到期知识点时选完全没练过的（新学）', () => {
  const names = ['点数', '数量匹配', '比大小', '加减法']
  const today = '2026-10-29'
  const rows = [
    row('点数', 2, '2026-11-02'),
    row('比大小', 3, '2026-11-05'),
    row('加减法', 1, '2026-11-01'),
  ]
  assert.deepEqual(pickFocusIndex(rows, names, today), { index: 1, level: 0 })
})

test('pickFocusIndex：全都有记录且都没到期时兜底取等级最低的', () => {
  const names = ['点数', '数量匹配', '比大小', '加减法']
  const today = '2026-10-29'
  const rows = [
    row('点数', 3, '2026-11-01'),
    row('数量匹配', 2, '2026-11-03'),
    row('比大小', 1, '2026-11-02'),
    row('加减法', 4, '2026-11-10'),
  ]
  assert.deepEqual(pickFocusIndex(rows, names, today), { index: 2, level: 1 })
})

// ─── 思维难度解锁与用时判定 ───────────────────────────────────────────────────

const levels = [
  { knowledge: '记忆翻翻乐_4x3' },
  { knowledge: '记忆翻翻乐_4x4' },
  { knowledge: '记忆翻翻乐_5x4' },
]

test('pickLevelIndex：没有记录时停留在最简单难度', () => {
  assert.equal(pickLevelIndex(levels, []), 0)
})

test('pickLevelIndex：上一档未满级不解锁下一档', () => {
  assert.equal(pickLevelIndex(levels, [{ knowledge: levels[0].knowledge, mastery_level: 5 }]), 0)
})

test('pickLevelIndex：上一档满级后自动解锁下一档', () => {
  assert.equal(pickLevelIndex(levels, [{ knowledge: levels[0].knowledge, mastery_level: MAX_MASTERY_LEVEL }]), 1)
})

test('pickLevelIndex：逐级解锁直到最高难度', () => {
  const rows = [
    { knowledge: levels[0].knowledge, mastery_level: MAX_MASTERY_LEVEL },
    { knowledge: levels[1].knowledge, mastery_level: MAX_MASTERY_LEVEL },
  ]
  assert.equal(pickLevelIndex(levels, rows), 2)
})

test('pickLevelIndex：中间一档未满级则停在那一档', () => {
  const rows = [
    { knowledge: levels[0].knowledge, mastery_level: MAX_MASTERY_LEVEL },
    { knowledge: levels[1].knowledge, mastery_level: MAX_MASTERY_LEVEL - 1 },
  ]
  assert.equal(pickLevelIndex(levels, rows), 1)
})

test('pickLevelIndex：支持自定义解锁等级', () => {
  assert.equal(pickLevelIndex(levels, [{ knowledge: levels[0].knowledge, mastery_level: 3 }], 3), 1)
})

test('isTimedPassed：正确率达标且不超时才算过关', () => {
  assert.equal(isTimedPassed(0.8, 100, 120, 0.8), true)
  assert.equal(isTimedPassed(0.8, 120, 120, 0.8), true)
  assert.equal(isTimedPassed(0.79, 100, 120, 0.8), false)
  assert.equal(isTimedPassed(0.9, 121, 120, 0.8), false)
  assert.equal(isTimedPassed(0.9, 0, 120, 0.8), false)
})

test('isTimedPassed：记忆翻牌 60% 达标线', () => {
  assert.equal(isTimedPassed(0.6, 100, 150, 0.6), true)
  assert.equal(isTimedPassed(0.5, 100, 150, 0.6), false)
})
