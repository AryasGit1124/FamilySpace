import {
  buildDefaultAdventureLevels,
  fetchAdventureLevels,
  fetchAdventurePassedLevels,
  fetchSubjectIdByName,
} from '@/lib/supabase-queries'
import { AdventureMap } from './adventure-map'

export const dynamic = 'force-dynamic'

/** 冒险岛地图主页：从 Supabase adventure_levels 表动态拉取关卡，蛇形蜿蜒长卷轴 */
export default async function AdventurePage() {
  const [subjectId, serverPassed, levels] = await Promise.all([
    fetchSubjectIdByName('冒险岛').catch((err: unknown) => {
      console.error('[Adventure] 获取冒险岛学科失败:', err)
      return null
    }),
    fetchAdventurePassedLevels(),
    fetchAdventureLevels(),
  ])

  const levelList = levels.length > 0 ? levels : buildDefaultAdventureLevels()

  return (
    <AdventureMap
      backHref={subjectId ? `/subject/${subjectId}` : undefined}
      serverPassed={serverPassed}
      levels={levelList}
    />
  )
}
