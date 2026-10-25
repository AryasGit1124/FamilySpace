-- ============================================================
-- media 表新增「协同标记与陪伴备注 + 视频封面」字段（可重复执行）
--   teaching_status: 'learned'（已带学）/ 'need_review'（需重看）/ NULL（未标记）
--   parent_note:     家长陪伴备注，多端共享
--   thumb_url:       上传视频时浏览器端抽帧生成的封面图地址
-- ============================================================

alter table public.media
  add column if not exists teaching_status text;

-- 该列若由早期手工创建，可能带有非白名单的 DEFAULT（如 ''），
-- 会导致不显式写该列的 INSERT 违反 check 约束（23514），统一重置为 NULL
alter table public.media
  alter column teaching_status set default null;

alter table public.media
  add column if not exists parent_note text;

alter table public.media
  add column if not exists thumb_url text;

-- 归一化历史数据：该列可能已存在且带有白名单之外的旧值（如 'taught'、空串等），
-- 不清洗直接加 check 约束会报 23514「violated by some row」
update public.media
  set teaching_status = null
  where teaching_status is not null
    and teaching_status not in ('learned', 'need_review');

-- 约束取值范围；先删旧约束保证脚本可重复执行
alter table public.media
  drop constraint if exists media_teaching_status_check;

alter table public.media
  add constraint media_teaching_status_check
  check (teaching_status is null or teaching_status in ('learned', 'need_review'));
