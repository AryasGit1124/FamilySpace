-- 开启严格 RLS：所有业务表按 family_id 隔离
--
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴执行
-- 前置条件：代码已切到 cookie 会话（lib/supabase.ts 使用 @supabase/ssr + middleware.ts），
--           服务端渲染才能携带用户身份；否则 Server Component 的查询会被策略拦成空数据。
-- 本脚本可重复执行：每次先清空 public 下所有旧策略，再按家庭重建。

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. 清空历史策略（旧策略互相引用会导致 Postgres 无限递归 42P17）
-- ─────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. 当前用户所属家庭
--    SECURITY DEFINER 以函数属主身份读取 profiles，绕过 RLS，
--    避免与 profiles 自身的策略互相引用造成递归。
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_family_id() from public;
grant execute on function public.current_family_id() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. 凭邀请码查家庭
--    单独用 RPC 实现，避免为了「加入家庭」而放开 families 全表可读
--    （全表可读会泄露所有家庭的邀请码）
-- ─────────────────────────────────────────────────────────────
create or replace function public.find_family_by_invite_code(code text)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name
  from public.families f
  where f.invite_code = upper(code)
  limit 1
$$;

revoke all on function public.find_family_by_invite_code(text) from public;
grant execute on function public.find_family_by_invite_code(text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. 表级权限（策略只做行级过滤，表权限仍需授予）
-- ─────────────────────────────────────────────────────────────
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. families：只能看/改自己所在的家庭
-- ─────────────────────────────────────────────────────────────
alter table public.families enable row level security;

create policy families_select on public.families
  for select to authenticated
  using (id = public.current_family_id());

-- 建家庭时用户还没有 profile，无法用 family_id 判定，故允许新建
create policy families_insert on public.families
  for insert to authenticated
  with check (true);

create policy families_update on public.families
  for update to authenticated
  using (id = public.current_family_id())
  with check (id = public.current_family_id());

create policy families_delete on public.families
  for delete to authenticated
  using (id = public.current_family_id());

-- ─────────────────────────────────────────────────────────────
-- 6. profiles：自己的记录 + 同家庭成员
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or family_id = public.current_family_id());

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 用户管理里可以移除同家庭的其他成员，也可以移除自己
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (id = auth.uid() or family_id = public.current_family_id());

-- ─────────────────────────────────────────────────────────────
-- 7. 家庭业务表：读写都限定在 family_id 内
-- ─────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'subjects',
    'tasks',
    'weekly_templates',
    'schedules',
    'checkins',
    'star_ledger',
    'rewards_store',
    'media',
    'child_mastery',
    'adventure_progress',
    'daily_contents'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (family_id = public.current_family_id()) with check (family_id = public.current_family_id())',
      t || '_family_all',
      t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 8. 全局内容表：不区分家庭，登录后可读（写入仍走 SQL/服务端）
-- ─────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['literacy_chars', 'poems', 'adventure_levels']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_content_read',
      t
    );
  end loop;
end $$;

commit;

-- 让 PostgREST 立即感知策略变化
notify pgrst, 'reload schema';
