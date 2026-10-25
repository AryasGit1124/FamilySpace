-- ============================================================
-- daily_contents：AI 生成内容的按天缓存（如识字故事）
-- 可重复执行；表已存在时自动补齐缺失字段
-- ============================================================

create table if not exists public.daily_contents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid,
  type text not null,           -- 如 'literacy_story'
  date date not null,           -- 内容所属日期
  content text not null,
  created_at timestamptz not null default now()
);

-- 表已存在时补齐缺失字段（add column if not exists 幂等）
alter table public.daily_contents add column if not exists family_id uuid;
alter table public.daily_contents add column if not exists type text;
alter table public.daily_contents add column if not exists date date;
alter table public.daily_contents add column if not exists content text;
alter table public.daily_contents add column if not exists created_at timestamptz not null default now();

-- 读取时按 家庭+类型+日期 查最新一条
create index if not exists daily_contents_lookup_idx
  on public.daily_contents (family_id, type, date, created_at desc);

-- 刷新 PostgREST 架构缓存，避免新表/新字段不生效
notify pgrst, 'reload schema';
