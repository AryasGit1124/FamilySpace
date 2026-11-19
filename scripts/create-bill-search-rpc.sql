-- ============================================================
-- 账单万能搜索 RPC：key 命中商品 / 对方 / 交易类型 / 备注 / 整行原始 JSON
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行（可重复执行）
-- 说明：jsonb 不能直接 ilike，这里用 raw_data::text 转纯文本匹配。
--       同时支持时间 / 分类 / 登记人 / 批次 / 金额 / 分页，便于与筛选叠加。
-- ============================================================

create or replace function public.search_bill_dwd(
    p_family_id   uuid,
    p_keyword     text,
    p_year        text     default null,
    p_month       text     default null,   -- 'all' / null 表示全年
    p_category_ids uuid[]  default null,   -- 一级分类时由前端带上全部二级
    p_creator     text     default null,
    p_batch_id    text     default null,
    p_min_amount  numeric  default null,
    p_max_amount  numeric  default null,
    p_exclude_zero boolean default false,
    p_limit       integer  default 51,
    p_offset      integer  default 0
)
returns setof public.bill_dwd
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      case
        when coalesce(p_year, '') ~ '^\d{4}$'
          then make_date(p_year::int, 1, 1)::timestamp
      end as year_start,
      case
        when coalesce(p_year, '') ~ '^\d{4}$'
         and coalesce(p_month, '') ~ '^\d{1,2}$'
         and p_month::int between 1 and 12
          then make_date(p_year::int, p_month::int, 1)::timestamp
      end as month_start
  )
  select d.*
    from public.bill_dwd d
    cross join bounds b
   where d.family_id = coalesce(public.current_family_id(), p_family_id)

     -- 批次
     and (p_batch_id is null or d.batch_id = p_batch_id)

     -- 年月（trade_time 是北京时间 naive timestamp，直接比较）
     and (
          (b.month_start is not null
             and d.trade_time >= b.month_start
             and d.trade_time < b.month_start + interval '1 month')
       or (b.month_start is null and b.year_start is not null
             and d.trade_time >= b.year_start
             and d.trade_time < b.year_start + interval '1 year')
       or (b.year_start is null)
     )

     -- 分类：一级 / 二级都匹配，两列任一命中
     and (
          p_category_ids is null
       or d.category_id = any(p_category_ids)
       or d.subcategory_id = any(p_category_ids)
     )

     -- 登记人 / 金额
     and (p_creator is null or d.creator_name = p_creator)
     and (not p_exclude_zero or coalesce(d.net_amount, 0) <> 0)
     and (p_min_amount is null or d.net_amount >= p_min_amount)
     and (p_max_amount is null or d.net_amount <= p_max_amount)

     -- 关键词：常规字段 + 整行原始 JSON 文本
     and (
          coalesce(btrim(p_keyword), '') = ''
       or d.commodity    ilike '%' || p_keyword || '%'
       or d.counterparty ilike '%' || p_keyword || '%'
       or d.trade_type   ilike '%' || p_keyword || '%'
       or d.remark       ilike '%' || p_keyword || '%'
       or d.raw_data::text ilike '%' || p_keyword || '%'
     )

   order by d.trade_time desc nulls last, d.id asc
   limit greatest(coalesce(p_limit, 51), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.search_bill_dwd(
  uuid, text, text, text, uuid[], text, text, numeric, numeric, boolean, integer, integer
) to authenticated, anon;

notify pgrst, 'reload schema';

-- 自测
-- select * from public.search_bill_dwd(
--   '你的family_id'::uuid, '山姆',
--   p_year := '2026', p_month := 'all', p_limit := 10
-- );
