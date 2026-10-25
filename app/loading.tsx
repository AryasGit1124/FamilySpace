/**
 * 首页加载骨架屏 —— 导航到"今日"时立即显示，消除 force-dynamic
 * 重查 Supabase 期间的白屏等待感。
 */
export default function TodayLoading() {
  return (
    <div aria-busy="true" aria-label="页面加载中" className="flex flex-col gap-4 px-5 pb-6">
      {/* 标题区 */}
      <div className="flex flex-col gap-1.5 px-1 pt-6">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
      </div>
      {/* 周几 Tab */}
      <div className="flex gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-14 min-w-[3.2rem] flex-1 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      {/* 课程卡片 */}
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      {/* 打卡任务列表 */}
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  )
}
