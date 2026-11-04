-- ============================================================
-- growth_records：成长档案（照片 / 视频记录）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- ============================================================

create table if not exists public.growth_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video', 'text')),
  file_url text,
  cover_url text,
  title text,
  content text,
  record_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 兼容已建过表的库：补充纯文字记录字段，并放宽媒体类型与文件地址约束
alter table public.growth_records add column if not exists content text;
alter table public.growth_records alter column file_url drop not null;
alter table public.growth_records drop constraint if exists growth_records_media_type_check;
alter table public.growth_records add constraint growth_records_media_type_check
  check (media_type in ('image', 'video', 'text'));

create index if not exists growth_records_family_date_idx
  on public.growth_records (family_id, record_date desc);

-- 与其它业务表保持一致：客户端用 anon key 直接读写
alter table public.growth_records disable row level security;
grant all on public.growth_records to anon, authenticated;

notify pgrst, 'reload schema';
