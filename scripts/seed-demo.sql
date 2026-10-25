-- ===== 一次性插入演示数据 =====
-- 执行前请确保 subjects 表里已有 6 条默认学科（你之前的 SQL 已经插过）
-- 如果 tasks / weekly_templates / schedules / checkins 已有数据，下面会做 upsert

-- 1. 确保 tasks 里有足够的任务（按 subject title 去重 upsert）
insert into public.tasks (subject_id, title, type, format, description)
select s.id, '识字乐园', 'online', 'self', '线上玩游戏学汉字'
from public.subjects s where s.name = '语文'
on conflict (id) do nothing;

insert into public.tasks (subject_id, title, type, format, description)
select s.id, '背诵古诗《静夜思》', 'offline', 'self', '家长听背，约 5 分钟'
from public.subjects s where s.name = '语文'
on conflict (id) do nothing;

insert into public.tasks (subject_id, title, type, format, description)
select s.id, '口算 20 题', 'online', 'self', '在线答题，约 10 分钟'
from public.subjects s where s.name = '数学'
on conflict (id) do nothing;

insert into public.tasks (subject_id, title, type, format, description)
select s.id, '单词跟读 Unit 3', 'online', 'self', 'App 跟读，约 8 分钟'
from public.subjects s where s.name = '英语'
on conflict (id) do nothing;

insert into public.tasks (subject_id, title, type, format, description)
select s.id, '线下外教课', 'offline', 'teacher', '少年宫 302 教室'
from public.subjects s where s.name = '英语'
on conflict (id) do nothing;

-- 2. 今天（周二 day_of_week=2）的 weekly_templates —— 挂 3 条打卡任务
insert into public.weekly_templates (task_id, day_of_week)
select id, 2 from public.tasks where title = '识字乐园'
on conflict do nothing;

insert into public.weekly_templates (task_id, day_of_week)
select id, 2 from public.tasks where title = '口算 20 题'
on conflict do nothing;

insert into public.weekly_templates (task_id, day_of_week)
select id, 2 from public.tasks where title = '单词跟读 Unit 3'
on conflict do nothing;

-- 3. 今天（周二）的线下课程 schedules —— "线下外教课" 16:30-17:30
insert into public.schedules (subject_id, task_id, day_of_week, start_time, duration_minutes, location)
select s.id, t.id, 2, '16:30:00', 60, '少年宫 302 教室'
from public.subjects s
join public.tasks t on t.subject_id = s.id
where s.name = '英语' and t.title = '线下外教课'
on conflict do nothing;

-- 4. 插一条今天的 checkin —— "识字乐园" 已经打过卡，首页会显示已完成
insert into public.checkins (task_id, checkin_date, status)
select id, current_date, 'done' from public.tasks where title = '识字乐园'
on conflict do nothing;

-- ===== 验证查询 =====
select '=== 今日打卡任务（周二模板） ===' as info;
select wt.id as template_id, wt.day_of_week, t.title, t.type, t.format, s.name as subject
from weekly_templates wt join tasks t on t.id = wt.task_id join subjects s on s.id = t.subject_id
where wt.day_of_week = 2;

select '=== 今日线下课程（周二课表） ===' as info;
select sc.id, sc.start_time, sc.duration_minutes, sc.location, t.title, s.name as subject
from schedules sc join tasks t on t.id = sc.task_id join subjects s on s.id = sc.subject_id
where sc.day_of_week = 2;

select '=== 今日打卡记录 ===' as info;
select c.task_id, c.checkin_date, t.title from checkins c join tasks t on t.id = c.task_id where c.checkin_date = current_date;
