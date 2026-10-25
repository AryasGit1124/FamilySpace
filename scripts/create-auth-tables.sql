-- 家庭与用户资料表（Supabase Auth 登录用）
create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我的家',
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  family_id uuid references families (id) on delete set null,
  role text not null default 'parent',
  created_at timestamptz not null default now()
);

-- 兼容已存在的表：补上缺失的列 / 唯一约束
alter table families add column if not exists name text not null default '我的家';
alter table families add column if not exists invite_code text;
alter table families add column if not exists created_at timestamptz not null default now();
create unique index if not exists families_invite_code_key on families (invite_code);

alter table profiles add column if not exists family_id uuid references families (id) on delete set null;
alter table profiles add column if not exists role text not null default 'parent';
-- 家庭角色昵称：爸爸 / 妈妈 / 爷爷 / 奶奶 / 外公 / 外婆 / 孩子
alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists created_at timestamptz not null default now();

-- ──────────────────────────────────────────────────────────────────────────────
-- 业务数据按家庭隔离：每张业务表加 family_id
-- ──────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'subjects', 'tasks', 'weekly_templates', 'schedules', 'checkins',
    'star_ledger', 'rewards_store', 'media', 'child_mastery', 'adventure_progress'
  ]
  loop
    -- 表可能还没建（如 adventure_progress），先判断存在再操作，避免整个脚本回滚
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format(
        'alter table public.%I add column if not exists family_id uuid references public.families (id) on delete cascade',
        t
      );
      execute format(
        'create index if not exists %I on public.%I (family_id)',
        t || '_family_id_idx',
        t
      );
    end if;
  end loop;
end $$;

-- 历史数据没有 family_id 的统一归到最早创建的那个家庭，避免升级后数据看不见
do $$
declare
  oldest uuid;
  t text;
begin
  select id into oldest from public.families order by created_at asc, id asc limit 1;
  if oldest is null then
    return;
  end if;

  foreach t in array array[
    'subjects', 'tasks', 'weekly_templates', 'schedules', 'checkins',
    'star_ledger', 'rewards_store', 'media', 'child_mastery', 'adventure_progress'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('update public.%I set family_id = %L where family_id is null', t, oldest);
    end if;
  end loop;
end $$;

-- 清掉这些表上的所有旧策略：
-- 旧策略如果互相引用（profiles 策略查 families、families 策略又查 profiles），
-- 会触发 42P17 "infinite recursion detected in policy"，导致创建家庭直接报错
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'families', 'profiles', 'subjects', 'tasks', 'weekly_templates', 'schedules',
        'checkins', 'star_ledger', 'rewards_store', 'media', 'child_mastery',
        'adventure_progress', 'literacy_chars', 'poems', 'adventure_levels'
      ])
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- 关键一步：即使 RLS 被重新打开（Supabase 新建表默认开启 RLS），也要能读写。
-- 这里给每张表建一条宽松策略，策略体是 true，不会引用其它表，因此不会再出现递归。
do $$
declare
  t text;
begin
  foreach t in array array[
    'families', 'profiles', 'subjects', 'tasks', 'weekly_templates', 'schedules',
    'checkins', 'star_ledger', 'rewards_store', 'media', 'child_mastery',
    'adventure_progress', 'literacy_chars', 'poems', 'adventure_levels'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
        t || '_family_access',
        t
      );
    end if;
  end loop;
end $$;

-- 临时关闭 RLS：先把单家庭应用跑通，后续再按 family_id 配置策略
alter table families disable row level security;
alter table profiles disable row level security;
alter table if exists public.subjects disable row level security;
alter table if exists public.tasks disable row level security;
alter table if exists public.weekly_templates disable row level security;
alter table if exists public.schedules disable row level security;
alter table if exists public.checkins disable row level security;
alter table if exists public.star_ledger disable row level security;
alter table if exists public.rewards_store disable row level security;
alter table if exists public.media disable row level security;
alter table if exists public.literacy_chars disable row level security;
alter table if exists public.child_mastery disable row level security;
alter table if exists public.poems disable row level security;
alter table if exists public.adventure_progress disable row level security;
alter table if exists public.adventure_levels disable row level security;

-- 确保匿名 key 能读写这些表
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
