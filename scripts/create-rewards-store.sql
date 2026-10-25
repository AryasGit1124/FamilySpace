-- 星星商城：家长配置可兑换的奖励，孩子在 /store 页用星星兑换
create table if not exists rewards_store (
  id uuid primary key default gen_random_uuid(),
  icon text not null default '🎁',
  title text not null,
  cost_stars int not null check (cost_stars >= 0),
  stock int not null default 1 check (stock >= 0),
  created_at timestamptz not null default now()
);

alter table rewards_store enable row level security;

-- 与项目其他表一致：匿名 key 下允许读写（单家庭使用场景，家长在后台自行增删改）
-- 先 drop 再建，保证脚本可以重复执行
drop policy if exists "allow read rewards_store" on rewards_store;
create policy "allow read rewards_store"
  on rewards_store for select
  using (true);

drop policy if exists "allow write rewards_store" on rewards_store;
create policy "allow write rewards_store"
  on rewards_store for all
  using (true)
  with check (true);

-- 预置几条示例奖励（按标题判重，重复执行不会产生重复数据）
insert into rewards_store (icon, title, cost_stars, stock)
select *
from (
  values
    ('🍦', '冰激淋', 5, 10),
    ('🧸', '新玩具', 20, 3),
    ('📺', '多看 15 分钟动画片', 10, 10),
    ('🎨', '和爸爸妈妈一起画画', 8, 10)
) as seed(icon, title, cost_stars, stock)
where not exists (select 1 from rewards_store where rewards_store.title = seed.title);
