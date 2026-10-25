'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { handleGameCheckin } from '@/lib/rewards'
import { MATH_ROUND_TOTAL } from './game-ui'

/**
 * 数学小游戏公共轮次逻辑：
 * 答对累计到 5 题后通关，并按「首答正确率」结算星星。
 *
 * 调用方需在答对时调用 addSolved(firstTry)，firstTry 表示本题是否第一次就答对。
 */
export function useMathRound(taskId: string | null) {
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

  const addSolved = useCallback((firstTry: boolean) => {
    const next = solvedRef.current + 1
    solvedRef.current = next
    setSolved(next)
    if (firstTry) {
      const ft = firstTryRef.current + 1
      firstTryRef.current = ft
      setFirstTryCorrect(ft)
    }
    if (next >= MATH_ROUND_TOTAL) setFinished(true)
  }, [])

  const reset = useCallback(() => {
    solvedRef.current = 0
    firstTryRef.current = 0
    setSolved(0)
    setFirstTryCorrect(0)
    setFinished(false)
    setChecked(false)
    setError('')
    setEarnedStars(0)
  }, [])

  /** 通关后按首答正确率结算星星并打卡 */
  useEffect(() => {
    if (!finished) return
    if (!taskId) {
      setError('没找到打卡任务，本次进度未写入')
      return
    }

    let cancelled = false
    setCheckingIn(true)
    handleGameCheckin(taskId, MATH_ROUND_TOTAL, firstTryRef.current, isParentRef.current)
      .then((stars) => {
        if (cancelled) return
        setEarnedStars(stars)
        setChecked(true)
      })
      .catch((err: unknown) => {
        console.error('[MathGame] 打卡失败:', err)
        if (!cancelled) setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        if (!cancelled) setCheckingIn(false)
      })

    return () => {
      cancelled = true
    }
  }, [finished, taskId])

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
  }
}
