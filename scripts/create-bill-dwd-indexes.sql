-- bill_dwd 索引：统计页汇总、明细页分页都按 family_id + trade_time 查询
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴执行（可重复执行，已存在则跳过）

-- 明细倒序分页：where family_id = ? order by trade_time desc
create index if not exists bill_dwd_family_time_idx
  on public.bill_dwd (family_id, trade_time desc);

-- 分类下钻：category_id / subcategory_id 的 or 条件
create index if not exists bill_dwd_family_category_idx
  on public.bill_dwd (family_id, category_id);

create index if not exists bill_dwd_family_subcategory_idx
  on public.bill_dwd (family_id, subcategory_id);

-- 登记人筛选
create index if not exists bill_dwd_family_creator_idx
  on public.bill_dwd (family_id, creator_name);

-- 首页首屏：本周 checkins 区间查询
create index if not exists checkins_family_date_idx
  on public.checkins (family_id, checkin_date);

notify pgrst, 'reload schema';
