-- media 表支持「纯文字作业」（可重复执行）
--   file_type 允许新增 'text'，file_url 允许为空（无文件）
-- 背景：线下课有时只有文字作业，家长不选文件直接提交文字

-- 1. file_url 允许为空（若原本是 NOT NULL）
alter table public.media
  alter column file_url drop not null;

-- 2. 删除 media 表上所有涉及 file_type 的旧 check 约束（不管叫什么名字）
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.media'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%file_type%'
  loop
    execute format('alter table public.media drop constraint %I', c.conname);
  end loop;
end $$;

-- 3. 清洗历史数据：不在白名单内的旧值统一置空，避免新约束失败
update public.media
  set file_type = null
  where file_type is not null
    and file_type not in ('video', 'image', 'text');

-- 4. 重新加约束（含 text）
alter table public.media
  add constraint media_file_type_check
  check (file_type is null or file_type in ('video', 'image', 'text'));

-- 5. 刷新 PostgREST 架构缓存
notify pgrst, 'reload schema';
