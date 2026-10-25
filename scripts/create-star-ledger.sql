-- 星星代币账本：每次打卡奖励星星，StarBadge 汇总 amount 展示总数
create table if not exists star_ledger (
  id uuid primary key default gen_random_uuid(),
  amount int not null,
  reason text not null default '完成打卡',
  created_at timestamptz not null default now()
);

alter table star_ledger enable row level security;

-- 与项目其他表一致：匿名 key 下允许读写（单家庭使用场景）
create policy "allow read star_ledger"
  on star_ledger for select
  using (true);

create policy "allow insert star_ledger"
  on star_ledger for insert
  with check (true);
