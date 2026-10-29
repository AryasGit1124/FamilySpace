-- ============================================================
-- knowledge_mastery：各学科知识点掌握度（数学 / 英语 / 思维按此复习薄弱点）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
--
-- knowledge_point 存各学科自定义的字符串：
--   数学：点数 / 数量匹配 / 比大小 / 加减法
--   英语：字母A / 单词Apple
--   思维：记忆翻翻乐_4x4 / 找规律_ABAB
-- ============================================================

create table if not exists public.knowledge_mastery (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  -- 学科：数学 / 英语 / 思维 …
  subject text not null,
  knowledge_point text not null,
  -- 0 = 还没练过；1-6 复习等级（越高间隔越长）
  mastery_level integer not null default 0,
  correct_streak integer not null default 0,
  next_review_date date not null default current_date,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 表已存在时补齐缺失字段（历史表可能缺列）
alter table public.knowledge_mastery add column if not exists family_id uuid;
alter table public.knowledge_mastery add column if not exists subject text;
alter table public.knowledge_mastery add column if not exists knowledge_point text;
alter table public.knowledge_mastery add column if not exists mastery_level integer not null default 0;
alter table public.knowledge_mastery add column if not exists correct_streak integer not null default 0;
alter table public.knowledge_mastery add column if not exists next_review_date date not null default current_date;
alter table public.knowledge_mastery add column if not exists updated_at timestamptz not null default now();
alter table public.knowledge_mastery add column if not exists created_at timestamptz not null default now();

-- 旧版本脚本用的是 knowledge 列名，这里统一改名成 knowledge_point
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'knowledge_mastery' and column_name = 'knowledge'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'knowledge_mastery' and column_name = 'knowledge_point'
  ) then
    alter table public.knowledge_mastery rename column knowledge to knowledge_point;
  end if;
end $$;

-- 同一学科 + 知识点只保留一条
create unique index if not exists knowledge_mastery_subject_point_key
  on public.knowledge_mastery (subject, knowledge_point);

create index if not exists knowledge_mastery_family_subject_idx
  on public.knowledge_mastery (family_id, subject);

-- 与其它业务表保持一致：客户端用 anon key 直接读写
alter table public.knowledge_mastery disable row level security;
grant all on public.knowledge_mastery to anon, authenticated;

notify pgrst, 'reload schema';
