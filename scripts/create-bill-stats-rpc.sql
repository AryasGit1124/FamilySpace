-- ============================================================
-- 账单统计：索引 + 数据库级汇总函数（RPC）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- 依赖：public.current_family_id()（create-bill-ods.sql 已创建）
-- ============================================================

-- 1. 索引
-- 以下两个索引在 create-bill-ods.sql 中已按同名结构创建过，这里只补建不存在的
create index if not exists bill_ods_family_time_idx
  on public.bill_ods (family_id, trade_time desc);
create index if not exists bill_ods_family_category_idx
  on public.bill_ods (family_id, category_id);

-- 2. 按月汇总：某家庭某年的每月收入 / 支出
-- 注意：
--   * 时间统一按北京时间（Asia/Shanghai）截取年月，与前端展示口径一致
--   * direction 兼容「支出 / 支」「收入 / 收」，排除「不计收支」
--   * 使用 security invoker + 家庭校验，避免越权读取其它家庭的汇总
drop function if exists public.get_bill_monthly_summary(uuid, int);

create or replace function public.get_bill_monthly_summary(
    p_family_id uuid,
    p_year int
) returns table (
    month_str text,
    total_expense numeric,
    total_income numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(b.trade_time at time zone 'Asia/Shanghai', 'YYYY-MM') as month_str,
    coalesce(sum(case when b.direction in ('支出', '支') then b.amount else 0 end), 0) as total_expense,
    coalesce(sum(case when b.direction in ('收入', '收') then b.amount else 0 end), 0) as total_income
  from public.bill_ods b
  where b.family_id = p_family_id
    and p_family_id = public.current_family_id()
    and b.trade_time is not null
    and extract(year from b.trade_time at time zone 'Asia/Shanghai') = p_year
    and coalesce(b.amount, 0) <> 0
  group by 1
  order by 1 desc;
$$;

grant execute on function public.get_bill_monthly_summary(uuid, int) to authenticated;

-- ============================================================
-- 3. 统计页通用聚合（按日 / 按月 / 按年，支持分类、登记人、金额筛选）
-- ============================================================
drop function if exists public.get_bill_stats(uuid, int, text, uuid[], text, numeric, numeric, boolean);

create or replace function public.get_bill_stats(
    p_family_id uuid,
    p_year int default null,             -- null = 全部年份
    p_granularity text default 'month',  -- day / month / year
    p_category_ids uuid[] default null,  -- null = 全部分类
    p_creator text default null,
    p_min_amount numeric default null,
    p_max_amount numeric default null,
    p_exclude_zero boolean default false
) returns table (
    bucket text,
    total_expense numeric,
    total_income numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    case p_granularity
      when 'day' then to_char(b.trade_time at time zone 'Asia/Shanghai', 'YYYY-MM-DD')
      when 'year' then to_char(b.trade_time at time zone 'Asia/Shanghai', 'YYYY')
      else to_char(b.trade_time at time zone 'Asia/Shanghai', 'YYYY-MM')
    end as bucket,
    coalesce(sum(case when b.direction in ('支出', '支') then b.amount else 0 end), 0) as total_expense,
    coalesce(sum(case when b.direction in ('收入', '收') then b.amount else 0 end), 0) as total_income
  from public.bill_ods b
  where b.family_id = p_family_id
    and p_family_id = public.current_family_id()
    and b.trade_time is not null
    and (p_year is null
         or extract(year from b.trade_time at time zone 'Asia/Shanghai') = p_year)
    and (p_category_ids is null or b.category_id = any (p_category_ids))
    and (p_creator is null or p_creator = '' or b.creator_name = p_creator)
    and (p_min_amount is null or coalesce(b.amount, 0) >= p_min_amount)
    and (p_max_amount is null or coalesce(b.amount, 0) <= p_max_amount)
    and (not p_exclude_zero or coalesce(b.amount, 0) <> 0)
  group by 1
  order by 1;
$$;

grant execute on function public.get_bill_stats(uuid, int, text, uuid[], text, numeric, numeric, boolean) to authenticated;

-- ============================================================
-- 4. 支出分类聚合（饼图）
-- ============================================================
drop function if exists public.get_bill_category_summary(uuid, int, uuid[], text, numeric, numeric, boolean);

create or replace function public.get_bill_category_summary(
    p_family_id uuid,
    p_year int default null,
    p_category_ids uuid[] default null,
    p_creator text default null,
    p_min_amount numeric default null,
    p_max_amount numeric default null,
    p_exclude_zero boolean default false
) returns table (
    category_id uuid,
    total_expense numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.category_id,
    coalesce(sum(b.amount), 0) as total_expense
  from public.bill_ods b
  where b.family_id = p_family_id
    and p_family_id = public.current_family_id()
    and b.trade_time is not null
    and b.direction in ('支出', '支')
    and (p_year is null
         or extract(year from b.trade_time at time zone 'Asia/Shanghai') = p_year)
    and (p_category_ids is null or b.category_id = any (p_category_ids))
    and (p_creator is null or p_creator = '' or b.creator_name = p_creator)
    and (p_min_amount is null or coalesce(b.amount, 0) >= p_min_amount)
    and (p_max_amount is null or coalesce(b.amount, 0) <= p_max_amount)
    and (not p_exclude_zero or coalesce(b.amount, 0) <> 0)
  group by b.category_id;
$$;

grant execute on function public.get_bill_category_summary(uuid, int, uuid[], text, numeric, numeric, boolean) to authenticated;

-- ============================================================
-- 5. 辅助：可选年份 / 登记人（用于下拉框，避免拉全量明细）
-- ============================================================
drop function if exists public.get_bill_years(uuid);

create or replace function public.get_bill_years(p_family_id uuid)
returns table (year_str text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct to_char(b.trade_time at time zone 'Asia/Shanghai', 'YYYY') as year_str
  from public.bill_ods b
  where b.family_id = p_family_id
    and p_family_id = public.current_family_id()
    and b.trade_time is not null
  order by 1 desc;
$$;

grant execute on function public.get_bill_years(uuid) to authenticated;

drop function if exists public.get_bill_creators(uuid);

create or replace function public.get_bill_creators(p_family_id uuid)
returns table (creator text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct b.creator_name as creator
  from public.bill_ods b
  where b.family_id = p_family_id
    and p_family_id = public.current_family_id()
    and coalesce(b.creator_name, '') <> ''
  order by 1;
$$;

grant execute on function public.get_bill_creators(uuid) to authenticated;

notify pgrst, 'reload schema';
