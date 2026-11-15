-- ============================================================
-- bill_categories / bill_category_rules：账单分类与自动归类规则
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- ============================================================

-- 1. 分类（如：买菜 / 交通 / 教育）
create table if not exists public.bill_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  name text not null,
  emoji text not null default '📁',
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index if not exists bill_categories_family_idx
  on public.bill_categories (family_id, sort_order);

-- 1.1 多级分类：父级分类（删除父级会级联删除子级）
alter table public.bill_categories
  add column if not exists parent_id uuid references public.bill_categories (id) on delete cascade;

create index if not exists bill_categories_parent_idx
  on public.bill_categories (family_id, parent_id);

-- 2. 归类规则（关键词命中后归入对应分类）
create table if not exists public.bill_category_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  category_id uuid not null references public.bill_categories (id) on delete cascade,
  keyword text not null,
  match_field text not null default 'all'
    check (match_field in ('counterparty', 'commodity', 'all')),
  priority int not null default 100,   -- 数字越大越优先
  created_at timestamptz default now()
);

create index if not exists bill_category_rules_category_idx
  on public.bill_category_rules (family_id, category_id, priority desc);

-- 3. 当前用户所属家庭（未执行过 enable-rls-strict.sql 时兜底创建）
create or replace function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.profiles where id = auth.uid()
$$;

grant execute on function public.current_family_id() to authenticated;

-- 4. RLS：只能读写本家庭的数据
alter table public.bill_categories enable row level security;
drop policy if exists "family members can manage bill categories" on public.bill_categories;
create policy "family members can manage bill categories"
  on public.bill_categories for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
grant select, insert, update, delete on public.bill_categories to authenticated;

alter table public.bill_category_rules enable row level security;
drop policy if exists "family members can manage bill rules" on public.bill_category_rules;
create policy "family members can manage bill rules"
  on public.bill_category_rules for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
grant select, insert, update, delete on public.bill_category_rules to authenticated;

notify pgrst, 'reload schema';
