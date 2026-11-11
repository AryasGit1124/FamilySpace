-- ============================================================
-- exchange_requests：孩子提交的兑换申请（待家长确认）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行；可重复执行
-- ============================================================

create table if not exists public.exchange_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  reward_id uuid references public.rewards_store (id) on delete cascade,
  reward_title text not null,
  cost_stars int not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists exchange_requests_family_status_idx
  on public.exchange_requests (family_id, status, created_at desc);

-- 与其它业务表保持一致：客户端用 anon key 直接读写
alter table public.exchange_requests disable row level security;
grant all on public.exchange_requests to anon, authenticated;

notify pgrst, 'reload schema';
