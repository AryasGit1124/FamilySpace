-- 打卡审核机制：checkins.status 支持 pending / approved / rejected，并记录待发放星星数
-- 可重复执行；执行前会清洗历史 status 值，避免违反新的 check 约束

-- 1. 新增字段
alter table public.checkins add column if not exists stars integer not null default 1;
-- 首答正确率百分制得分（线上游戏写入；线下课程为 null）
alter table public.checkins add column if not exists score integer;
alter table public.checkins add column if not exists reviewed_at timestamptz;

-- 2. 删除旧的 status check 约束（历史约束可能只允许 done 等旧值）
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.checkins'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.checkins drop constraint %I', c.conname);
  end loop;
end $$;

-- 3. 历史数据归档：旧版已发星的打卡统一视为已通过
update public.checkins
set status = 'approved'
where status is null
   or status in ('done', 'checked')
   or status not in ('pending', 'approved', 'rejected');

-- 4. 默认值与非空 + 新约束
alter table public.checkins alter column status set default 'pending';
alter table public.checkins alter column status set not null;

alter table public.checkins
  add constraint checkins_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- 5. 刷新 PostgREST 架构缓存（否则新字段读写会报 PGRST204）
notify pgrst, 'reload schema';
