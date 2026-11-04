'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchStarTotal } from '@/lib/supabase-queries'

/**
 * 全局星星计数：显示 star_ledger 总额。
 * 挂载时加载一次，此后监听 stars-changed 事件实时刷新（打卡成功后由 insertStar 广播）。
 */
export function StarBadge() {
  const [total, setTotal] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setTotal(await fetchStarTotal())
    } catch (err) {
      // 未登录 / 网络失败时显示 0，不能抛错阻断后续渲染
      console.warn('[StarBadge] 读取星星总额失败:', err)
      setTotal(0)
    }
  }, [])

  useEffect(() => {
    void load()
    window.addEventListener('stars-changed', load)
    return () => window.removeEventListener('stars-changed', load)
  }, [load])

  return (
    <div
      aria-label={`当前共有 ${total ?? 0} 颗星星`}
      className="flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-600"
    >
      <span aria-hidden="true">⭐</span>
      <span>{total ?? '-'}</span>
    </div>
  )
}
