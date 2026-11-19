/** 账单模块的规范类型：与数据库最新结构一一对应，app/bills 统一从这里取类型 */

/** 中间层 bill_dwd 的一行（清洗后的账单，前端金额统一用 net_amount） */
export interface BillDWD {
  id: string
  family_id: string
  entry_source: 'import' | 'manual'
  source: string // alipay / wechat
  trade_time: string
  trade_type: string
  counterparty: string
  commodity: string
  direction: string
  original_amount: number
  refund_amount: number
  net_amount: number // 前端统一用这个金额
  transaction_nature: 'income' | 'expense'
  category_id: string | null
  subcategory_id: string | null
  category_source: 'rule' | 'uncategorized' | 'manual'
  creator_name: string
  needs_review: boolean
}

/** 账单分类（一级 parent_id = null，二级挂在父级下） */
export interface BillCategory {
  id: string
  parent_id: string | null
  name: string
  category_type: string
  icon: string
}

/** 自动归类规则（priority 数字越小越优先） */
export interface BillRule {
  id: string
  rule_name: string
  priority: number // 数字越小越优先
  source: string | null
  direction: string | null
  trade_type_pattern: string | null
  counterparty_pattern: string | null
  commodity_pattern: string | null
  match_type: 'all' | 'any'
  amount_min: number | null
  amount_max: number | null
  category_id: string
}
