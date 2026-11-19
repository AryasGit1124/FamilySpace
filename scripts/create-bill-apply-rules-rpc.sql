-- ============================================================
-- 一键应用规则：在数据库内完成「匹配 + 写回」，前端零遍历
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- 依赖：public.current_family_id()、public.bill_dwd、
--       public.bill_category_rules、public.bill_categories
--
-- 规则模型（新表结构）：
--   * 每个字段都是「可空 = 不限制」
--   * source / direction 为空表示不限来源 / 收支
--   * amount_min / amount_max 按净额绝对值比较
--   * trade_type/counterparty/commodity/pay_method_pattern 支持逗号分隔多个关键词，
--     同一字段内「任一关键词命中」即可（忽略大小写、按包含匹配）
--   * match_type = all（默认，全部字段都满足）/ any（任一字段满足）
--   * priority 越小越先命中；同优先级时二级分类优先
--   * 收支方向优先读 transaction_nature（income / expense），为空时回退 direction
--   * 命中 → 写 category_id（一级）+ subcategory_id（二级），category_source = 'rule'
--   * 手动改过分类（category_source = manual）的账单不会被覆盖
--   * 之前由规则写入、现在不再命中的账单会被清空分类
-- ============================================================

-- 关键词匹配：pattern 为空 → 命中；否则按 , ， 、 | ; ； 拆词，任一包含即命中
create or replace function public.bill_pattern_match(p_value text, p_pattern text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(btrim(p_pattern), '') = '' then true
    else exists (
      select 1
      from unnest(regexp_split_to_array(btrim(p_pattern), '\s*[,，、|;；]\s*')) as kw
      where btrim(kw) <> ''
        and coalesce(p_value, '') ilike ('%' || btrim(kw) || '%')
    )
  end;
$$;

-- 规则的收支方向匹配（兼容中英文，空 = 不限，「不计收支」不算支出/收入）
create or replace function public.bill_rule_direction_match(p_rule text, p_direction text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(btrim(p_rule), '') = '' then true
    when coalesce(p_direction, '') like '%不计%' then false
    when lower(btrim(p_rule)) in ('expense', 'out', 'debit', '支出', '支') then
      (coalesce(p_direction, '') like '%支%'
       or lower(coalesce(p_direction, '')) in ('expense', 'out', 'debit', 'payment'))
    when lower(btrim(p_rule)) in ('income', 'in', 'credit', '收入', '收') then
      (coalesce(p_direction, '') like '%收%'
       or lower(coalesce(p_direction, '')) in ('income', 'in', 'credit', 'refund'))
    else true
  end;
$$;

drop function if exists public.apply_category_rules(uuid);

create or replace function public.apply_category_rules(p_family_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_family_id is null or p_family_id <> public.current_family_id() then
    raise exception '无权操作其他家庭的账单';
  end if;

  with hit as (
    select
      d.id as bill_id,
      r.category_id,
      c.parent_id,
      r.id as rule_id,
      row_number() over (
        partition by d.id
        order by
          r.priority asc,
          case when c.parent_id is null then 0 else 1 end desc,
          r.id
      ) as rn
    from public.bill_dwd d
    join public.bill_category_rules r
      on r.family_id = d.family_id
     and r.enabled
    join public.bill_categories c
      on c.id = r.category_id
    where d.family_id = p_family_id
      -- 手动改过分类的账单不覆盖
      and coalesce(lower(d.category_source), '') not in ('manual', 'user', '人工', '手动')
      and (coalesce(btrim(r.source), '') = '' or r.source = d.source)
      and public.bill_rule_direction_match(
        r.direction,
        coalesce(nullif(btrim(d.transaction_nature), ''), d.direction)
      )
      and (r.amount_min is null or abs(coalesce(d.net_amount, 0)) >= r.amount_min)
      and (r.amount_max is null or abs(coalesce(d.net_amount, 0)) <= r.amount_max)
      and (
        case
          -- 没有任何关键词条件：视为只受来源 / 方向 / 金额约束
          when coalesce(btrim(r.trade_type_pattern), '') = ''
           and coalesce(btrim(r.counterparty_pattern), '') = ''
           and coalesce(btrim(r.commodity_pattern), '') = ''
           and coalesce(btrim(r.pay_method_pattern), '') = '' then true
          when lower(coalesce(r.match_type, 'all')) in ('any', 'or', '任一', '任意', '满足任一') then
            public.bill_pattern_match(d.trade_type, r.trade_type_pattern)
            or public.bill_pattern_match(d.counterparty, r.counterparty_pattern)
            or public.bill_pattern_match(d.commodity, r.commodity_pattern)
            or public.bill_pattern_match(d.pay_method, r.pay_method_pattern)
          else
            public.bill_pattern_match(d.trade_type, r.trade_type_pattern)
            and public.bill_pattern_match(d.counterparty, r.counterparty_pattern)
            and public.bill_pattern_match(d.commodity, r.commodity_pattern)
            and public.bill_pattern_match(d.pay_method, r.pay_method_pattern)
        end
      )
  ),
  picked as (
    select bill_id, category_id, parent_id, rule_id
    from hit
    where rn = 1
  ),
  changed as (
    update public.bill_dwd d
       set category_id = coalesce(p.parent_id, p.category_id),
           subcategory_id = case when p.parent_id is null then null else p.category_id end,
           matched_rule_id = p.rule_id,
           category_source = 'rule',
           needs_review = false
      from picked p
     where d.id = p.bill_id
       and (
         d.category_id is distinct from coalesce(p.parent_id, p.category_id)
         or d.subcategory_id is distinct from
            (case when p.parent_id is null then null else p.category_id end)
       )
    returning 1
  ),
  cleared as (
    update public.bill_dwd d
       set category_id = null,
           subcategory_id = null,
           matched_rule_id = null,
           category_source = null
     where d.family_id = p_family_id
       and lower(coalesce(d.category_source, '')) = 'rule'
       and not exists (select 1 from picked p where p.bill_id = d.id)
    returning 1
  )
  select (select count(*) from changed) + (select count(*) from cleared)
    into v_count;

  return v_count;
end;
$$;

grant execute on function public.apply_category_rules(uuid) to authenticated;

notify pgrst, 'reload schema';
