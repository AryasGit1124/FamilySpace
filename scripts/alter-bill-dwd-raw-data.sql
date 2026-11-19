-- ============================================================
-- bill_dwd.raw_data 改造（不用触发器）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴执行（可重复执行）
-- 内容：
--   1. 幂等补 raw_data 列
--   2. 清理之前试用过的触发器方案
--   3. 回填历史数据（按 ods_id 关联 bill_ods）
--   4. 重建 process_bill_batch：INSERT 时直接写入 o.raw_data
--      并把规则匹配改为 match_type = 'all' / 'any' 语义
-- ============================================================

-- 1. 字段
alter table public.bill_dwd
  add column if not exists raw_data jsonb;

-- 2. 清理触发器方案（如果之前执行过）
drop trigger if exists trg_bill_dwd_fill_raw_data on public.bill_dwd;
drop function if exists public.fill_bill_dwd_raw_data();

-- 3. 回填历史数据：按 ods_id 关联原始行
update public.bill_dwd d
set raw_data = o.raw_data
from public.bill_ods o
where o.id = d.ods_id
  and d.raw_data is null
  and o.raw_data is not null;

-- 4. 重建清洗函数：写入 raw_data；规则匹配按 all / any
create or replace function public.process_bill_batch(p_batch_id text)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
DECLARE
    v_ods_count             integer := 0;
    v_dwd_count             integer := 0;
    v_drop_count            integer := 0;
    v_categorized_count     integer := 0;
    v_uncategorized_count   integer := 0;
BEGIN
    /* ========================================================
       1. 参数校验
       ======================================================== */

    IF p_batch_id IS NULL
       OR trim(p_batch_id) = '' THEN
        RAISE EXCEPTION 'batch_id 不能为空';
    END IF;


    /* ========================================================
       2. 检查批次是否存在
       ======================================================== */

    SELECT COUNT(*)
      INTO v_ods_count
      FROM public.bill_ods
     WHERE batch_id = p_batch_id;

    IF v_ods_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', '没有找到对应批次的数据',
            'batch_id', p_batch_id,
            'ods_count', 0,
            'dwd_count', 0,
            'drop_count', 0,
            'categorized_count', 0,
            'uncategorized_count', 0
        );
    END IF;


    /* ========================================================
       3. 将清洗结果为 REMOVE 的数据写入 bill_dwd_drop
       ======================================================== */

    INSERT INTO public.bill_dwd_drop (
        ods_id,
        family_id,
        source,
        batch_id,

        trade_time,
        trade_type,
        counterparty,
        account,
        commodity,
        direction,
        amount,
        pay_method,
        status,
        trade_no,
        merchant_no,
        remark,

        creator_id,
        creator_name,

        drop_reason,

        original_amount,
        refund_amount,
        net_amount,

        rule_version,
        processed_at,
        created_at,
        updated_at
    )
    SELECT
        v.ods_id,
        v.family_id,
        v.source,
        v.batch_id,

        v.trade_time,
        v.trade_type,
        v.counterparty,
        v.account,
        v.commodity,
        v.direction,
        v.original_amount,
        v.pay_method,
        o.status,
        v.trade_no,
        v.merchant_no,
        v.remark,

        v.creator_id,
        v.creator_name,

        v.clean_reason,

        v.original_amount,
        v.refund_amount,
        v.net_amount,

        'v1',
        now(),
        now(),
        now()

    FROM public.v_bill_clean_preview v

    JOIN public.bill_ods o
      ON o.id = v.ods_id

    WHERE v.batch_id = p_batch_id
      AND v.clean_status = 'REMOVE'

    ON CONFLICT (ods_id)
    DO UPDATE SET
        family_id = EXCLUDED.family_id,
        source = EXCLUDED.source,
        batch_id = EXCLUDED.batch_id,

        trade_time = EXCLUDED.trade_time,
        trade_type = EXCLUDED.trade_type,
        counterparty = EXCLUDED.counterparty,
        account = EXCLUDED.account,
        commodity = EXCLUDED.commodity,
        direction = EXCLUDED.direction,
        amount = EXCLUDED.amount,
        pay_method = EXCLUDED.pay_method,
        status = EXCLUDED.status,
        trade_no = EXCLUDED.trade_no,
        merchant_no = EXCLUDED.merchant_no,
        remark = EXCLUDED.remark,

        creator_id = EXCLUDED.creator_id,
        creator_name = EXCLUDED.creator_name,

        drop_reason = EXCLUDED.drop_reason,

        original_amount = EXCLUDED.original_amount,
        refund_amount = EXCLUDED.refund_amount,
        net_amount = EXCLUDED.net_amount,

        rule_version = EXCLUDED.rule_version,
        processed_at = now(),
        updated_at = now();


    /* ========================================================
       4. 如果某条数据现在判断为无效，
          从 bill_dwd 中移除

          只处理当前导入批次，不影响手工录入记录。
       ======================================================== */

    DELETE FROM public.bill_dwd d
     WHERE d.entry_source = 'import'
       AND d.batch_id = p_batch_id
       AND EXISTS (
            SELECT 1
              FROM public.v_bill_clean_preview v
             WHERE v.ods_id = d.ods_id
               AND v.batch_id = p_batch_id
               AND v.clean_status = 'REMOVE'
       );


    /* ========================================================
       5. 将有效数据写入 bill_dwd，并执行分类规则

          raw_data：直接把 bill_ods 整行 JSON 原样写入
       ======================================================== */

    INSERT INTO public.bill_dwd (
        family_id,
        entry_source,
        source,
        ods_id,
        batch_id,

        trade_time,
        trade_type,
        counterparty,
        account,
        commodity,
        direction,
        pay_method,
        trade_no,
        merchant_no,
        remark,

        original_amount,
        refund_amount,
        net_amount,

        transaction_nature,

        category_id,
        subcategory_id,
        matched_rule_id,
        category_source,

        creator_id,
        creator_name,
        needs_review,

        raw_data,

        created_at,
        updated_at
    )
    SELECT
        v.family_id,
        'import',
        v.source,
        v.ods_id,
        v.batch_id,

        v.trade_time,
        v.trade_type,
        v.counterparty,
        v.account,
        v.commodity,

        /*
         * bill_dwd 的 direction 只存收入/支出。
         * 转账、投资等非直接收支性质暂时存 NULL。
         */
        CASE
            WHEN v.transaction_nature = 'expense'
                THEN '支出'

            WHEN v.transaction_nature = 'income'
                THEN '收入'

            ELSE NULL
        END AS direction,

        v.pay_method,
        v.trade_no,
        v.merchant_no,
        v.remark,

        v.original_amount,
        v.refund_amount,
        v.net_amount,

        v.transaction_nature,

        matched_rule.category_id,

        /*
         * bill_categories 使用 parent_id 管理层级，
         * 所以只需要保存最终命中的 category_id。
         */
        NULL AS subcategory_id,

        matched_rule.rule_id,

        CASE
            WHEN matched_rule.rule_id IS NOT NULL
                THEN 'rule'
            ELSE 'uncategorized'
        END AS category_source,

        v.creator_id,
        v.creator_name,

        CASE
            WHEN matched_rule.rule_id IS NULL
                THEN true
            ELSE false
        END AS needs_review,

        o.raw_data,

        now(),
        now()

    FROM public.v_bill_clean_preview v

    JOIN public.bill_ods o
      ON o.id = v.ods_id

    LEFT JOIN LATERAL (
        SELECT
            r.id AS rule_id,
            r.category_id

        FROM public.bill_category_rules r

        WHERE r.family_id = v.family_id
          AND r.enabled = true

          /*
           * 来源匹配：
           * NULL 表示支付宝、微信、手工数据都可以匹配。
           */
          AND (
              r.source IS NULL
              OR r.source = v.source
          )

          /*
           * 方向匹配：
           * 使用清洗预览中的原始 direction。
           */
          AND (
              r.direction IS NULL
              OR r.direction = v.direction
          )

          /*
           * 关键词匹配：
           * match_type = 'all' 时，所有已填写的条件都要命中；
           * match_type = 'any' 时，任一条件命中即可。
           * 关键词统一按「包含」比较（不区分大小写）。
           */
          AND (
              (
                  COALESCE(r.match_type, 'all') <> 'any'
                  AND (
                      (r.trade_type_pattern IS NULL
                          OR COALESCE(v.trade_type, '') ILIKE '%' || r.trade_type_pattern || '%')
                      AND
                      (r.counterparty_pattern IS NULL
                          OR COALESCE(v.counterparty, '') ILIKE '%' || r.counterparty_pattern || '%')
                      AND
                      (r.commodity_pattern IS NULL
                          OR COALESCE(v.commodity, '') ILIKE '%' || r.commodity_pattern || '%')
                      AND
                      (r.pay_method_pattern IS NULL
                          OR COALESCE(v.pay_method, '') ILIKE '%' || r.pay_method_pattern || '%')
                  )
              )
              OR
              (
                  COALESCE(r.match_type, 'all') = 'any'
                  AND (
                      (r.trade_type_pattern IS NOT NULL
                          AND COALESCE(v.trade_type, '') ILIKE '%' || r.trade_type_pattern || '%')
                      OR
                      (r.counterparty_pattern IS NOT NULL
                          AND COALESCE(v.counterparty, '') ILIKE '%' || r.counterparty_pattern || '%')
                      OR
                      (r.commodity_pattern IS NOT NULL
                          AND COALESCE(v.commodity, '') ILIKE '%' || r.commodity_pattern || '%')
                      OR
                      (r.pay_method_pattern IS NOT NULL
                          AND COALESCE(v.pay_method, '') ILIKE '%' || r.pay_method_pattern || '%')
                  )
              )
          )

          /*
           * 最低金额
           */
          AND (
              r.amount_min IS NULL
              OR v.net_amount >= r.amount_min
          )

          /*
           * 最高金额
           */
          AND (
              r.amount_max IS NULL
              OR v.net_amount <= r.amount_max
          )

        /*
         * 数字越小，优先级越高。
         * 优先级相同时，先创建的规则优先。
         */
        ORDER BY
            r.priority ASC,
            r.created_at ASC,
            r.id ASC

        LIMIT 1

    ) matched_rule
      ON true

    WHERE v.batch_id = p_batch_id
      AND v.clean_status = 'KEEP'

    ON CONFLICT (ods_id)
    WHERE ods_id IS NOT NULL

    DO UPDATE SET
        family_id = EXCLUDED.family_id,
        entry_source = 'import',
        source = EXCLUDED.source,
        batch_id = EXCLUDED.batch_id,

        trade_time = EXCLUDED.trade_time,
        trade_type = EXCLUDED.trade_type,
        counterparty = EXCLUDED.counterparty,
        account = EXCLUDED.account,
        commodity = EXCLUDED.commodity,
        direction = EXCLUDED.direction,
        pay_method = EXCLUDED.pay_method,
        trade_no = EXCLUDED.trade_no,
        merchant_no = EXCLUDED.merchant_no,
        remark = EXCLUDED.remark,

        original_amount = EXCLUDED.original_amount,
        refund_amount = EXCLUDED.refund_amount,
        net_amount = EXCLUDED.net_amount,

        transaction_nature = EXCLUDED.transaction_nature,

        /*
         * 如果用户已经手工修改过分类，
         * 重跑批次时不覆盖手工分类。
         */
        category_id =
            CASE
                WHEN bill_dwd.category_source = 'manual'
                    THEN bill_dwd.category_id
                ELSE EXCLUDED.category_id
            END,

        subcategory_id =
            CASE
                WHEN bill_dwd.category_source = 'manual'
                    THEN bill_dwd.subcategory_id
                ELSE EXCLUDED.subcategory_id
            END,

        matched_rule_id =
            CASE
                WHEN bill_dwd.category_source = 'manual'
                    THEN bill_dwd.matched_rule_id
                ELSE EXCLUDED.matched_rule_id
            END,

        category_source =
            CASE
                WHEN bill_dwd.category_source = 'manual'
                    THEN 'manual'
                ELSE EXCLUDED.category_source
            END,

        needs_review =
            CASE
                WHEN bill_dwd.category_source = 'manual'
                    THEN false
                ELSE EXCLUDED.needs_review
            END,

        raw_data = COALESCE(EXCLUDED.raw_data, bill_dwd.raw_data),

        creator_id = EXCLUDED.creator_id,
        creator_name = EXCLUDED.creator_name,
        updated_at = now();


    /* ========================================================
       6. 如果某条数据现在判断为有效，
          从 bill_dwd_drop 移除
       ======================================================== */

    DELETE FROM public.bill_dwd_drop d
     WHERE d.batch_id = p_batch_id
       AND EXISTS (
            SELECT 1
              FROM public.v_bill_clean_preview v
             WHERE v.ods_id = d.ods_id
               AND v.batch_id = p_batch_id
               AND v.clean_status = 'KEEP'
       );


    /* ========================================================
       7. 删除批次中已经不存在于 ODS 的旧 DWD 记录
       ======================================================== */

    DELETE FROM public.bill_dwd d
     WHERE d.entry_source = 'import'
       AND d.batch_id = p_batch_id
       AND NOT EXISTS (
            SELECT 1
              FROM public.bill_ods o
             WHERE o.id = d.ods_id
               AND o.batch_id = p_batch_id
       );


    /* ========================================================
       8. 删除批次中已经不存在于 ODS 的旧 DROP 记录
       ======================================================== */

    DELETE FROM public.bill_dwd_drop d
     WHERE d.batch_id = p_batch_id
       AND NOT EXISTS (
            SELECT 1
              FROM public.bill_ods o
             WHERE o.id = d.ods_id
               AND o.batch_id = p_batch_id
       );


    /* ========================================================
       9. 统计本次处理结果
       ======================================================== */

    SELECT COUNT(*)
      INTO v_dwd_count
      FROM public.bill_dwd
     WHERE entry_source = 'import'
       AND batch_id = p_batch_id;


    SELECT COUNT(*)
      INTO v_drop_count
      FROM public.bill_dwd_drop
     WHERE batch_id = p_batch_id;


    SELECT COUNT(*)
      INTO v_categorized_count
      FROM public.bill_dwd
     WHERE entry_source = 'import'
       AND batch_id = p_batch_id
       AND category_id IS NOT NULL;


    SELECT COUNT(*)
      INTO v_uncategorized_count
      FROM public.bill_dwd
     WHERE entry_source = 'import'
       AND batch_id = p_batch_id
       AND category_id IS NULL;


    /* ========================================================
       10. 返回结果
       ======================================================== */

    RETURN jsonb_build_object(
        'success', true,
        'message', '账单批次清洗和分类完成',
        'batch_id', p_batch_id,

        'ods_count', v_ods_count,
        'dwd_count', v_dwd_count,
        'drop_count', v_drop_count,

        'categorized_count', v_categorized_count,
        'uncategorized_count', v_uncategorized_count,

        'count_check',
            v_dwd_count + v_drop_count = v_ods_count,

        'processed_at', now()
    );


EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION
            '处理账单批次失败。batch_id: %, SQLSTATE: %, error: %',
            p_batch_id,
            SQLSTATE,
            SQLERRM;
END;
$function$;

notify pgrst, 'reload schema';

-- 校验 1：历史数据应全部补齐（结果应为 0）
-- select count(*) from public.bill_dwd
--  where entry_source = 'import' and raw_data is null;

-- 校验 2：随便挑一条看内容
-- select ods_id, raw_data from public.bill_dwd
--  where entry_source = 'import' order by created_at desc limit 1;
