-- literacy_chars 增加 AI 字卡字段（可重复执行）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行
alter table if exists public.literacy_chars add column if not exists emoji text;
alter table if exists public.literacy_chars add column if not exists word text;
alter table if exists public.literacy_chars add column if not exists sentence text;

-- 项目没有配置 service_role key，允许已登录用户通过 /api/fill-chars 写入全局字库内容
drop policy if exists literacy_chars_content_update on public.literacy_chars;
create policy literacy_chars_content_update on public.literacy_chars
  for update to authenticated using (true) with check (true);

-- 让 PostgREST 立即感知新字段与策略
notify pgrst, 'reload schema';
