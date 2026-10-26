'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import type { AdventureLevel } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

/** 当前解锁到的最大关卡号（默认 1）；与关卡挑战页共用 */
const STORAGE_KEY = 'adventure-max-unlocked-level'

/**
 * 蛇形排版：手机端按 index % 4 计算水平偏移（靠左 → 中偏左 → 中偏右 → 靠右）；
 * iPad 端（md+）切换为两列交错 S 形路径，由 MD_ZIGZAG 的左右站位覆盖。
 */
const SNAKE_LAYOUT = [
  'self-start ml-8',
  'self-center -translate-x-14',
  'self-center translate-x-14',
  'self-end mr-8',
] as const

/** iPad 两列交错：偶数节点站左列，奇数节点站右列并上移，形成 S 形 */
const MD_ZIGZAG = [
  'md:self-auto md:m-0 md:translate-x-0 md:justify-self-start md:pl-16 lg:pl-24',
  'md:self-auto md:ml-0 md:mr-0 md:translate-x-0 md:justify-self-end md:-mt-16 md:pr-16 lg:pr-24',
] as const

function loadMaxUnlocked(maxLevel: number): number {
  try {
    const value = Number.parseInt(window.localStorage.getItem(STORAGE_KEY) ?? '', 10)
    if (Number.isInteger(value) && value >= 1) return Math.min(value, maxLevel + 1)
    // 迁移旧版进度：adventure-passed-levels = [1,2,...] → max + 1
    const legacyRaw = window.localStorage.getItem('adventure-passed-levels')
    if (legacyRaw) {
      const legacy: unknown = JSON.parse(legacyRaw)
      if (Array.isArray(legacy)) {
        const levels = legacy.filter((item): item is number => typeof item === 'number')
        if (levels.length > 0) return Math.min(Math.max(...levels) + 1, maxLevel + 1)
      }
    }
  } catch {
    // 忽略损坏数据
  }
  return 1
}

type NodeState = 'passed' | 'current' | 'locked'

function nodeStateOf(levelNumber: number, maxUnlocked: number): NodeState {
  if (levelNumber < maxUnlocked) return 'passed'
  if (levelNumber === maxUnlocked) return 'current'
  return 'locked'
}

export function AdventureMap({
  backHref,
  serverPassed = [],
  levels,
}: {
  backHref?: string
  /** Supabase adventure_progress 里的通关记录（跨设备同步），与本地进度取并集 */
  serverPassed?: number[]
  /** 从 adventure_levels 表拉取的关卡配置（已按 level_number 升序） */
  levels: AdventureLevel[]
}) {
  // 进度在 useEffect 里读取，初始为 1（第 1 关解锁），避免 hydration 不匹配
  const [maxUnlocked, setMaxUnlocked] = useState(1)

  useEffect(() => {
    const serverMax = serverPassed.length > 0 ? Math.max(...serverPassed) + 1 : 1
    const merged = Math.min(
      Math.max(loadMaxUnlocked(levels.length), serverMax),
      levels.length + 1,
    )
    setMaxUnlocked(merged)
    window.localStorage.setItem(STORAGE_KEY, String(merged))
  }, [serverPassed, levels.length])

  const passedCount = Math.min(maxUnlocked - 1, levels.length)

  return (
    <>
      <PageHeader
        title="冒险岛"
        subtitle={`已通关 ${passedCount} / ${levels.length} 关`}
        backHref={backHref}
        backLabel="返回冒险岛学科"
      />
      {/* 手机端白底；iPad 端整页天空→草地渐变，更有游戏氛围 */}
      <div className="px-5 pb-6 md:min-h-screen md:bg-gradient-to-b md:from-sky-200 md:via-green-100 md:to-green-300 md:py-6">
        <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-3xl border bg-gradient-to-b from-sky-200 via-emerald-50 to-emerald-100 shadow-sm md:max-w-3xl md:shadow-md lg:max-w-4xl">
          {/* 手机端：居中的虚线小径；iPad 端改为左右两条虚线，对应两列站位 */}
          <div
            className="absolute inset-y-6 left-1/2 border-l-4 border-dashed border-amber-700/40 md:hidden"
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-6 left-1/4 hidden border-l-4 border-dashed border-amber-700/40 md:block"
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-6 right-1/4 hidden border-l-4 border-dashed border-amber-700/40 md:block"
            aria-hidden="true"
          />
          <span className="absolute left-6 top-4 text-2xl md:text-4xl" aria-hidden="true">☁️</span>
          <span className="absolute right-8 top-16 text-2xl md:text-4xl" aria-hidden="true">🌴</span>
          <span className="absolute bottom-10 left-8 text-2xl md:text-4xl" aria-hidden="true">🏁</span>

          {/* 关卡节点：手机单列蛇形；iPad 两列交错 */}
          <ul
            className="relative z-10 flex flex-col gap-7 px-4 py-8 md:grid md:grid-cols-2 md:gap-x-40 md:gap-y-14 md:px-10 md:py-12 lg:gap-x-56"
            role="list"
            aria-label="关卡列表"
          >
            {levels.map((level, index) => {
              const state = nodeStateOf(level.level_number, maxUnlocked)
              const isBoss = level.is_boss
              const layout = cn(SNAKE_LAYOUT[index % SNAKE_LAYOUT.length], MD_ZIGZAG[index % 2])

              const node = (
                <span
                  className={cn(
                    'relative flex items-center justify-center rounded-full border-4 font-bold shadow-md transition-transform',
                    isBoss
                      ? 'size-24 text-3xl md:size-32 md:text-5xl'
                      : 'size-20 text-xl md:size-28 md:text-3xl lg:size-32 lg:text-4xl',
                    state === 'current' && 'breathe-glow',
                    state === 'current' &&
                      (isBoss
                        ? 'border-white bg-gradient-to-br from-red-400 to-rose-500 text-white ring-4 ring-red-300/50'
                        : 'border-white bg-gradient-to-br from-amber-300 to-orange-400 text-white ring-4 ring-amber-300/50'),
                    state === 'passed' && 'border-emerald-200 bg-emerald-400',
                    state === 'locked' && 'border-stone-200 bg-stone-300/80',
                  )}
                >
                  {state === 'passed' ? (
                    <span aria-hidden="true">⭐</span>
                  ) : state === 'locked' ? (
                    <span aria-hidden="true" className={cn(!isBoss && 'grayscale')}>
                      {isBoss ? '👹' : '🔒'}
                    </span>
                  ) : isBoss ? (
                    <span aria-hidden="true">👹</span>
                  ) : (
                    level.level_number
                  )}
                </span>
              )

              return (
                <li key={level.level_number} className={layout}>
                  {state === 'locked' ? (
                    <span aria-label={`第 ${level.level_number} 关${isBoss ? '（Boss 关）' : ''}，未解锁`}>
                      {node}
                    </span>
                  ) : (
                    <Link
                      href={`/adventure/level/${level.level_number}`}
                      aria-label={`进入第 ${level.level_number} 关${isBoss ? '（Boss 关）' : ''}`}
                      className="block transition-transform hover:scale-110 active:scale-95"
                    >
                      {node}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          通关当前关卡后，下一关自动解锁；红色大关卡是 Boss 关
        </p>
      </div>
    </>
  )
}
