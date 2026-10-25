-- ============================================================
-- child_mastery：修复「识字测试点认识/不认识报错」
-- 1. 补齐 updated_at 字段（upsertMastery 写入需要）
-- 2. status 约束统一为 mastered / review
-- 可重复执行
-- ============================================================

-- 1. 补齐字段
alter table public.child_mastery
  add column if not exists updated_at timestamptz not null default now();

-- 2. 清洗历史数据中非白名单的 status（统一置为 review，避免加约束失败）
update public.child_mastery
  set status = 'review'
  where status is distinct from 'mastered'
    and status is distinct from 'review';

-- 3. 重建 status check 约束（先删旧的同名约束）
alter table public.child_mastery
  drop constraint if exists child_mastery_status_check;

alter table public.child_mastery
  add constraint child_mastery_status_check
  check (status in ('mastered', 'review'));

-- 4. 刷新 PostgREST 架构缓存
notify pgrst, 'reload schema';
