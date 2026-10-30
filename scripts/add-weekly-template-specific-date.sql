-- ============================================================
-- weekly_templates.specific_date：临时任务只在指定日期生效
-- 平时模板 specific_date 为 null；临时任务填当天日期
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- ============================================================

alter table public.weekly_templates add column if not exists specific_date date;
-- 临时任务的奖励星星数（普通模板为 null，按 1 颗处理）
alter table public.weekly_templates add column if not exists stars integer;

create index if not exists weekly_templates_specific_date_idx
  on public.weekly_templates (family_id, specific_date);

notify pgrst, 'reload schema';
