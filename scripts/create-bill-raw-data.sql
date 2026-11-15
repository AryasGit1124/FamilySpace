-- ============================================================
-- bill_raw_data：账单原始数据表（ODS 层）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- 依赖：public.current_family_id()（由 scripts/enable-rls-strict.sql 提供，
--       本脚本里已带 if not exists 的兜底创建，未执行过也不会报错）
-- ============================================================

-- 1. 原始账单表：一行 = 文件里的一行，所有列原样进 raw_json
create table if not exists public.bill_raw_data (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  source text not null,        -- 来源: 'wechat'(微信) / 'alipay'(支付宝)
  batch_id text,               -- 导入批次号，方便按批次撤回
  row_index int,               -- 该记录在原文件中的行号
  raw_json jsonb not null,     -- 完整保留该行数据的所有列
  created_at timestamptz default now()
);

-- 按家庭 + 批次查询（撤回 / 重新清洗）走索引
create index if not exists bill_raw_data_family_batch_idx
  on public.bill_raw_data (family_id, batch_id);

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
alter table public.bill_raw_data enable row level security;

drop policy if exists "family members can manage raw bills" on public.bill_raw_data;
create policy "family members can manage raw bills"
  on public.bill_raw_data for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

grant select, insert, update, delete on public.bill_raw_data to authenticated;

notify pgrst, 'reload schema';
