-- 冒险岛关卡配置表：地图页按 level_number 动态渲染，挑战页读取难度与 Boss 标记
create table if not exists adventure_levels (
  id uuid primary key default gen_random_uuid(),
  level_number int not null unique,
  is_boss boolean not null default false,
  difficulty_max int not null default 10,
  created_at timestamptz not null default now()
);

alter table adventure_levels enable row level security;

-- 与项目其他表一致：匿名 key 下允许读写（单家庭使用场景）
create policy "allow read adventure_levels"
  on adventure_levels for select
  using (true);

create policy "allow write adventure_levels"
  on adventure_levels for all
  using (true)
  with check (true);

-- 预置 20 关：每 5 关一个 Boss；难度 1-3 关 5 以内，4-6 关 10 以内，7-9 关 15 以内，10 关起 20 以内
insert into adventure_levels (level_number, is_boss, difficulty_max) values
  (1,  false, 5),
  (2,  false, 5),
  (3,  false, 5),
  (4,  false, 10),
  (5,  true,  10),
  (6,  false, 10),
  (7,  false, 15),
  (8,  false, 15),
  (9,  false, 15),
  (10, true,  20),
  (11, false, 20),
  (12, false, 20),
  (13, false, 20),
  (14, false, 20),
  (15, true,  20),
  (16, false, 20),
  (17, false, 20),
  (18, false, 20),
  (19, false, 20),
  (20, true,  20)
on conflict (level_number) do nothing;
