-- ============================================================
-- bill_ods：账单 ODS 层（真实物理列 + raw_data 原始 JSON）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- 依赖：public.current_family_id()（本脚本自带兜底创建）
-- ============================================================

-- 1. 账单明细表
create table if not exists public.bill_ods (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  source text not null,              -- 'wechat' 微信 / 'alipay' 支付宝
  batch_id text,                     -- 导入批次号，方便整批撤回
  trade_time timestamptz,            -- 交易时间
  trade_type text,                   -- 微信「交易类型」/ 支付宝「交易分类」
  counterparty text,                 -- 交易对方
  account text,                      -- 对方账号（微信为 null）
  commodity text,                    -- 微信「商品」/ 支付宝「商品说明」
  direction text,                    -- 收/支（原样保留，含「不计收支」）
  amount numeric(12, 2),             -- 金额（已去掉 ¥ 与千分位）
  pay_method text,                   -- 微信「支付方式」/ 支付宝「收/付款方式」
  status text,                       -- 微信「当前状态」/ 支付宝「交易状态」
  trade_no text,                     -- 微信「交易单号」/ 支付宝「交易订单号」
  merchant_no text,                  -- 微信「商户单号」/ 支付宝「商家订单号」
  remark text,                       -- 备注
  raw_data jsonb,                    -- 整行原始数据
  category_id uuid references public.bill_categories (id) on delete set null,
  created_at timestamptz default now()
);

-- 已有表补列（规则清洗 / 手动分类用）
alter table public.bill_ods
  add column if not exists category_id uuid references public.bill_categories (id) on delete set null;

-- 登记人：谁导入 / 谁手动记的账（冗余存名字，profile 查不到也能显示）
alter table public.bill_ods
  add column if not exists creator_id uuid references auth.users (id);
alter table public.bill_ods
  add column if not exists creator_name text;

-- 明细页按时间倒序、批次页按 batch_id 聚合，都用到索引
create index if not exists bill_ods_family_time_idx
  on public.bill_ods (family_id, trade_time desc);
create index if not exists bill_ods_family_batch_idx
  on public.bill_ods (family_id, batch_id);
create index if not exists bill_ods_family_category_idx
  on public.bill_ods (family_id, category_id);
create index if not exists bill_ods_family_creator_idx
  on public.bill_ods (family_id, creator_name);

-- 2. 当前用户所属家庭（未执行过 enable-rls-strict.sql 时兜底创建）
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

-- 3. 开启 RLS：只能读写本家庭的数据
alter table public.bill_ods enable row level security;

drop policy if exists "family members can manage bills" on public.bill_ods;
create policy "family members can manage bills"
  on public.bill_ods for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

grant select, insert, update, delete on public.bill_ods to authenticated;

notify pgrst, 'reload schema';
