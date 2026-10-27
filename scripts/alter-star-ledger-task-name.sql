-- 星星流水增加「具体任务 / 兑换商品名称」，统计页优先展示 task_name，为空再回退 reason
alter table star_ledger add column if not exists task_name text;

-- 让 PostgREST 立刻感知新列，避免写入报 PGRST204（schema cache 不认识 task_name）
notify pgrst, 'reload schema';
