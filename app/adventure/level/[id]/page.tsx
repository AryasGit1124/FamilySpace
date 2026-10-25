import {
  buildDefaultAdventureLevels,
  ensureModuleTaskIdBySubjectName,
  fetchAdventureLevels,
  fetchAdventurePassedLevels,
  fetchMasteredCharsWithPinyin,
} from '@/lib/supabase-queries'
import { LevelChallenge } from './level-client'

export const dynamic = 'force-dynamic'

/** 冒险岛关卡挑战页：语文 + 数学 + 逻辑混合出题打怪兽，难度由 adventure_levels 表驱动 */
export default async function LevelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const level = Number.parseInt(id, 10)
  const validLevel = Number.isInteger(level) ? level : 0

  const [masteredChars, serverPassed, taskId, levels] = await Promise.all([
    fetchMasteredCharsWithPinyin().catch((err: unknown) => {
      console.error('[Level] 加载已掌握汉字失败:', err)
      return []
    }),
    fetchAdventurePassedLevels(),
    ensureModuleTaskIdBySubjectName({
      subjectName: '冒险岛',
      title: '冒险岛',
      gameRoute: '/adventure',
    }).catch((err: unknown) => {
      console.error('[Level] 获取打卡任务失败:', err)
      return null
    }),
    fetchAdventureLevels(),
  ])

  const levelList = levels.length > 0 ? levels : buildDefaultAdventureLevels()
  const config = levelList.find((item) => item.level_number === validLevel) ?? null

  return (
    <LevelChallenge
      level={validLevel}
      maxLevel={levelList.length}
      boss={config?.is_boss ?? validLevel % 5 === 0}
      difficultyMax={
        config?.difficulty_max ?? Math.min(5 + Math.floor((validLevel - 1) / 3) * 5, 20)
      }
      masteredChars={masteredChars}
      serverPassed={serverPassed}
      taskId={taskId}
    />
  )
}
