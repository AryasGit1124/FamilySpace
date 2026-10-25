-- 冒险岛通关进度表：换设备也能同步（地图页读取、关卡页通关时写入）
create table if not exists adventure_progress (
  id uuid primary key default gen_random_uuid(),
  level_id int not null,
  passed_at timestamptz not null default now()
);

alter table adventure_progress enable row level security;

-- 与项目其他表一致：匿名 key 下允许读写（单家庭使用场景）
create policy "allow read adventure_progress"
  on adventure_progress for select
  using (true);

create policy "allow insert adventure_progress"
  on adventure_progress for insert
  with check (true);
