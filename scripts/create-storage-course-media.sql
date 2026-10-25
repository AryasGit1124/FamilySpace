-- ============================================================
-- Storage 桶 course-media 的 RLS 策略
-- ------------------------------------------------------------
-- 本项目上传资料使用 anon key（未启用 Auth），
-- 而 storage.objects 是 Supabase 系统表，RLS 无法关闭，
-- 必须显式建策略，否则上传时报 403：
--   "new row violates row-level security policy"
-- ============================================================

-- 1. 确保桶存在且为公开桶（公开 = 任何人可通过 publicUrl 读取文件内容）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-media',
  'course-media',
  true,
  104857600,                          -- 100MB，与前端 MAX_SIZE 对齐
  array['video/*', 'image/*']::text[] -- 只允许视频和图片
)
on conflict (id) do update
  set public = true,
      file_size_limit = 104857600,
      allowed_mime_types = array['video/*', 'image/*']::text[];

-- 2. 清理可能已存在的同名策略（避免重复创建报错）
drop policy if exists "course-media insert" on storage.objects;
drop policy if exists "course-media select" on storage.objects;
drop policy if exists "course-media update" on storage.objects;
drop policy if exists "course-media delete" on storage.objects;

-- 3. 允许 anon / authenticated 在 course-media 桶内增删改查对象
create policy "course-media insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'course-media');

create policy "course-media select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'course-media');

create policy "course-media update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'course-media')
  with check (bucket_id = 'course-media');

create policy "course-media delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'course-media');
