-- ============================================================
-- bill_categories / bill_category_rules：账单分类与自动归类规则
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- 说明：与当前线上表结构保持一致（icon 替代旧 emoji，规则改为多条件匹配）
-- ============================================================

-- 1. 分类（如：买菜 / 交通 / 教育）
create table if not exists public.bill_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  parent_id uuid references public.bill_categories (id) on delete cascade,
  name text not null,
  category_type text not null default 'expense',
  sort_order int not null default 0,
  enabled boolean not null default true,
  is_system boolean not null default false,
  icon text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bill_categories_family_idx
  on public.bill_categories (family_id, sort_order);
create index if not exists bill_categories_parent_idx
  on public.bill_categories (family_id, parent_id);

-- 2. 归类规则：来源 / 收支 / 四个关键词字段 / 金额区间 / 条件关系
create table if not exists public.bill_category_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  rule_name text not null,
  description text,
  priority int not null default 100,        -- 数字越大越优先
  enabled boolean not null default true,
  source text,                              -- 空 = 不限来源
  direction text,                           -- 空 = 不限收支
  trade_type_pattern text,
  counterparty_pattern text,
  commodity_pattern text,
  pay_method_pattern text,
  match_type text not null default 'all',   -- all / any
  amount_min numeric,
  amount_max numeric,
  category_id uuid not null references public.bill_categories (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bill_category_rules_category_idx
  on public.bill_category_rules (family_id, category_id, priority desc);
create index if not exists bill_category_rules_enabled_idx
  on public.bill_category_rules (family_id, enabled, priority desc);

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

-- 5. match_type 约束：all（全部满足）/ any（任一满足），与前端「条件关系」一致
--    必须先删旧约束再改数据，否则旧约束（exact/contains）会让 update 直接失败
alter table public.bill_category_rules
  drop constraint if exists bill_category_rules_match_type_check;

update public.bill_category_rules
set match_type = case
  when lower(coalesce(match_type, 'all')) in ('any', 'or') then 'any'
  else 'all'
end
where match_type is null
   or lower(match_type) not in ('all', 'any');

alter table public.bill_category_rules
  add constraint bill_category_rules_match_type_check check (match_type in ('all', 'any'));

notify pgrst, 'reload schema';
