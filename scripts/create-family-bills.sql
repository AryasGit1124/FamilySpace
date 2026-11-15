-- ============================================================
-- family_bills：微信 / 支付宝账单导入记录
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- ============================================================

create table if not exists public.family_bills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  occurred_at timestamptz not null,
  source text not null check (source in ('wechat', 'alipay')),
  direction text not null check (direction in ('income', 'expense')),
  amount numeric(12, 2) not null check (amount >= 0),
  category text,
  description text,
  imported_at timestamptz not null default now()
);

create index if not exists family_bills_family_time_idx
  on public.family_bills (family_id, occurred_at desc);

-- 与其它业务表保持一致：客户端用 anon key 直接读写
alter table public.family_bills disable row level security;
grant all on public.family_bills to anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 升级（已建表的老库直接执行下面几行即可，可重复执行）
-- 保存原始流水字段，便于以后按单号对账、展示支付方式
-- ────────────────────────────────────────────────────────────
alter table public.family_bills add column if not exists raw_data jsonb;
alter table public.family_bills add column if not exists trade_no text;
alter table public.family_bills add column if not exists merchant_no text;
alter table public.family_bills add column if not exists pay_method text;

notify pgrst, 'reload schema';
