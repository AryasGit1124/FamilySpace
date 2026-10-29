'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { handleGameCheckin } from '@/lib/rewards'
import { applyKnowledgeResult, type KnowledgeMasteryRow } from '@/lib/supabase-queries'
import {
  letterFromKnowledge,
  letterKnowledge,
  pickDueTargets,
  reviewTargetForIndex,
  wordFromKnowledge,
  wordKnowledge,
  LETTER_KNOWLEDGE_PREFIX,
  WORD_KNOWLEDGE_PREFIX,
  isPassed,
} from '@/lib/knowledge-logic'
import type { ReviewTargetKind } from '@/lib/knowledge-logic'
import { todayStr } from '@/lib/dates'
import { ENGLISH_ROUND_TOTAL } from './game-ui'

/**
 * 英语知识点在 knowledge_mastery.knowledge 里的命名：
 * 「字母A」表示具体字母，「单词Apple」表示具体单词（subject = '英语'）。
 * 命名与解析规则在 lib/knowledge-logic 里，这里统一再导出给各小游戏使用。
 */
export {
  LETTER_KNOWLEDGE_PREFIX,
  WORD_KNOWLEDGE_PREFIX,
  letterFromKnowledge,
  letterKnowledge,
  wordFromKnowledge,
  wordKnowledge,
}
export type { ReviewTargetKind }

/** 每轮 5 题里给「到期该复习」的知识点预留的题数（其余为常规新题） */
const REVIEW_QUESTION_COUNT = 2

/**
 * 英语小游戏公共轮次逻辑：
 * 答对累计到 5 题后通关，并按「首答正确率」结算星星。
 *
 * 出题前用 pickReviewTarget(kind) 取到期的字母 / 单词，优先插进前 2 题；
 * 每答一题调用 recordKnowledge(本题知识点, 是否首答正确)，通关时统一回写掌握度。
 *
 * 调用方需在答对时调用 addSolved(firstTry)，firstTry 表示本题是否第一次就答对。
 */
export function useEnglishRound(taskId: string | null, knowledge: KnowledgeMasteryRow[] = []) {
  const { role } = useAuth()
  /** 家长端测试模式：不真正发星。用 ref 避免 auth 异步加载导致结算 effect 重复触发 */
  const isParentRef = useRef(role === 'parent')
  useEffect(() => {
    isParentRef.current = role === 'parent'
  }, [role])
  const [solved, setSolved] = useState(0)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  const [finished, setFinished] = useState(false)
  const [checked, setChecked] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)
  const [error, setError] = useState('')
  const [earnedStars, setEarnedStars] = useState(0)
  const solvedRef = useRef(0)
  const firstTryRef = useRef(0)

  /** 本轮答过的知识点成绩（首答正确题数 / 题数），通关时统一回写 */
  const knowledgeStatsRef = useRef(new Map<string, { total: number; correct: number }>())

  const letterTargets = useMemo(
    () => pickDueTargets(knowledge, 'letter', todayStr()),
    [knowledge],
  )
  const wordTargets = useMemo(
    () => pickDueTargets(knowledge, 'word', todayStr()),
    [knowledge],
  )

  /** 出下一题时应优先复习的知识点；只在前 REVIEW_QUESTION_COUNT 题生效 */
  const pickReviewTarget = useCallback(
    (kind: ReviewTargetKind): string | null => {
      const pool = kind === 'letter' ? letterTargets : wordTargets
      return reviewTargetForIndex(pool, solvedRef.current, REVIEW_QUESTION_COUNT)
    },
    [letterTargets, wordTargets],
  )

  /** 记录一题的知识点成绩（knowledge 为空表示本题不计入掌握度） */
  const recordKnowledge = useCallback((name: string | null, firstTry: boolean) => {
    if (!name) return
    const stat = knowledgeStatsRef.current.get(name) ?? { total: 0, correct: 0 }
    stat.total += 1
    if (firstTry) stat.correct += 1
    knowledgeStatsRef.current.set(name, stat)
  }, [])

  const addSolved = useCallback((firstTry: boolean) => {
    const next = solvedRef.current + 1
    solvedRef.current = next
    setSolved(next)
    if (firstTry) {
      const ft = firstTryRef.current + 1
      firstTryRef.current = ft
      setFirstTryCorrect(ft)
    }
    if (next >= ENGLISH_ROUND_TOTAL) setFinished(true)
  }, [])

  const reset = useCallback(() => {
    solvedRef.current = 0
    firstTryRef.current = 0
    knowledgeStatsRef.current = new Map()
    setSolved(0)
    setFirstTryCorrect(0)
    setFinished(false)
    setChecked(false)
    setError('')
    setEarnedStars(0)
  }, [])

  useEffect(() => {
    if (!finished) return
    if (!taskId) {
      setError('没找到打卡任务，本次进度未写入')
      return
    }

    let cancelled = false
    setCheckingIn(true)
    handleGameCheckin(taskId, ENGLISH_ROUND_TOTAL, firstTryRef.current, isParentRef.current)
      .then((stars) => {
        if (cancelled) return
        setEarnedStars(stars)
        setChecked(true)
      })
      .catch((err: unknown) => {
        console.error('[EnglishGame] 打卡失败:', err)
        if (!cancelled) setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        if (!cancelled) setCheckingIn(false)
      })

    return () => {
      cancelled = true
    }
  }, [finished, taskId])

  /** 通关后按每个知识点的首答正确率回写掌握度（每个知识点本轮只写一次） */
  useEffect(() => {
    if (!finished) return
    for (const [name, stat] of knowledgeStatsRef.current) {
      applyKnowledgeResult('英语', name, isPassed(stat.correct, stat.total)).catch(
        (err: unknown) => {
          console.warn('[EnglishGame] 写入知识点掌握度失败:', err)
        },
      )
    }
  }, [finished])

  return {
    solved,
    firstTryCorrect,
    finished,
    checked,
    checkingIn,
    error,
    earnedStars,
    /** 家长端测试模式：星星仅展示，未真正发放 */
    isParent: isParentRef.current,
    addSolved,
    reset,
    /** 出下一题时优先复习的到期知识点（知识库还没记录时返回 null） */
    pickReviewTarget,
    /** 记录本题知识点成绩，通关后统一回写掌握度 */
    recordKnowledge,
  }
}
