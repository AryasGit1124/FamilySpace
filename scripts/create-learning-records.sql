-- ============================================================
-- learning_records：识字等模块的学习得分记录（打卡时写入）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- ============================================================

create table if not exists public.learning_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  record_date date not null default current_date,
  subject text,
  module text,
  new_count integer not null default 0,
  review_count integer not null default 0,
  total_count integer not null default 0,
  first_try_correct integer not null default 0,
  score integer not null default 0,
  detail text,
  created_at timestamptz not null default now()
);

-- 兼容已建过表的库：补上 detail（古诗名等）
alter table public.learning_records add column if not exists detail text;

create index if not exists learning_records_family_date_idx
  on public.learning_records (family_id, record_date desc);

-- 与其它业务表保持一致：客户端用 anon key 直接读写
alter table public.learning_records disable row level security;
grant all on public.learning_records to anon, authenticated;

notify pgrst, 'reload schema';
