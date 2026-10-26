'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import { redeemReward, type RewardItem } from '@/lib/supabase-queries'

type Props = {
  rewards: RewardItem[]
  starTotal: number
}

/** 星星兑换：仅孩子可见；家长访问自动跳转到「商城配置」 */
export function StoreClient({ rewards, starTotal }: Props) {
  const router = useRouter()
  const { role } = useAuth()
  const [redeemingId, setRedeemingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // 家长不应看到兑换页，跳到商城配置
  useEffect(() => {
    if (role === 'parent') router.replace('/settings?tab=store')
  }, [role, router])

  if (role === 'parent') return null

  const handleRedeem = async (reward: RewardItem) => {
    if (redeemingId) return
    const confirmed = window.confirm(
      `确定要花 ${reward.cost_stars} 颗星星兑换‘${reward.title}’吗？`,
    )
    if (!confirmed) return

    setRedeemingId(reward.id)
    setError('')
    try {
      await redeemReward(reward)
      window.alert('兑换成功！快去找爸爸妈妈领取吧！')
      // Server Component 重新查询星星总数与库存
      router.refresh()
    } catch (err) {
      console.error('[Store] 兑换失败:', err)
      setError(`兑换失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRedeemingId(null)
    }
  }

  return (
    <>
      {/* 顶部固定的星星总数 */}
      <div className="sticky top-16 z-20 bg-gray-50/95 px-5 pb-3 pt-3 backdrop-blur-sm">
        <div className="rounded-[2rem] bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 px-6 py-5 text-center text-white shadow-lg shadow-amber-200/60">
          <p className="text-sm font-bold tracking-widest text-white/85">星星商城</p>
          <p className="mt-1 flex items-center justify-center gap-2">
            <span className="text-5xl drop-shadow-sm" aria-hidden="true">
              ⭐
            </span>
            <span className="text-6xl font-black tabular-nums drop-shadow-sm">{starTotal}</span>
          </p>
          <p className="mt-1 text-xs font-medium text-white/85">完成打卡赚星星，快来兑换心愿吧</p>
        </div>
      </div>

      {error && (
        <p className="mx-5 mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {rewards.length === 0 ? (
        <p className="mx-5 mt-3 rounded-3xl border-2 border-dashed border-amber-200 bg-white p-8 text-center text-sm text-muted-foreground">
          礼物正在准备中，请过几天再来看看吧
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 px-5 pb-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rewards.map((reward) => {
            const insufficient = starTotal < reward.cost_stars
            const busy = redeemingId === reward.id

            return (
              <li
                key={reward.id}
                className="flex flex-col items-center rounded-[1.75rem] border-2 border-amber-100 bg-white p-4 text-center shadow-sm"
              >
                <span
                  className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 text-4xl"
                  aria-hidden="true"
                >
                  {reward.icon || '🎁'}
                </span>
                <p className="mt-3 min-h-10 text-sm font-bold leading-snug">{reward.title}</p>
                <p className="mt-1 flex items-center gap-1 text-lg font-extrabold text-amber-500">
                  {reward.cost_stars}
                  <span className="text-base" aria-hidden="true">
                    ⭐
                  </span>
                </p>
                <Button
                  type="button"
                  variant={insufficient ? 'secondary' : 'default'}
                  className={
                    insufficient
                      ? 'mt-3 w-full rounded-xl'
                      : 'mt-3 w-full rounded-xl bg-amber-500 text-white shadow-sm hover:bg-amber-600'
                  }
                  disabled={insufficient || busy}
                  onClick={() => void handleRedeem(reward)}
                >
                  {insufficient ? '星星不够哦' : busy ? '兑换中…' : '立即兑换'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
