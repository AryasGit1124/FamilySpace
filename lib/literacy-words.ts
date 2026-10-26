/** 常用字组词表：听音选字朗读用「字，词语的字」的形式帮助理解 */
export const WORD_EXAMPLES: Record<string, string> = {
  一: '一个', 二: '二月', 三: '三只', 四: '四季', 五: '五星', 六: '六个', 七: '七夕', 八: '八月', 九: '九天', 十: '十分',
  人: '人们', 大: '大家', 小: '小鸟', 口: '口水', 手: '小手', 上: '上面', 下: '下雨', 中: '中间', 山: '大山', 水: '河水',
  火: '火苗', 木: '木头', 日: '日子', 月: '月亮', 土: '土地', 石: '石头', 云: '白云', 雨: '大雨', 风: '大风', 目: '目光',
  耳: '耳朵', 头: '头发', 足: '足球', 身: '身体', 心: '爱心', 牙: '牙齿', 爸: '爸爸', 妈: '妈妈', 爷: '爷爷', 奶: '奶奶',
  哥: '哥哥', 姐: '姐姐', 弟: '弟弟', 妹: '妹妹', 家: '家人', 们: '我们', 你: '你们', 我: '我们', 他: '他们', 她: '她们',
  好: '好人', 学: '学习', 生: '学生', 书: '书本', 字: '汉字', 语: '语文', 文: '文化', 笔: '铅笔', 本: '本子', 包: '书包',
  牛: '小牛', 羊: '小羊', 马: '小马', 鸟: '小鸟', 鱼: '小鱼', 虫: '虫子', 鸡: '小鸡', 鸭: '小鸭', 兔: '兔子', 狗: '小狗',
  猫: '小猫', 猪: '小猪', 花: '花朵', 草: '小草', 树: '大树', 叶: '树叶', 果: '水果', 瓜: '西瓜', 米: '大米', 麦: '麦子',
  豆: '豆子', 菜: '白菜', 竹: '竹子', 林: '树林', 森: '森林', 江: '长江', 河: '小河', 海: '大海', 湖: '湖水', 波: '波浪',
  天: '天空', 地: '大地', 星: '星星', 空: '天空', 雪: '雪花', 霜: '冰霜', 雾: '大雾', 雷: '打雷', 电: '闪电', 光: '阳光',
  灯: '电灯', 车: '汽车', 船: '小船', 桥: '大桥', 路: '马路', 房: '房子', 屋: '房屋', 门: '大门', 窗: '窗户', 桌: '桌子',
  椅: '椅子', 床: '小床', 衣: '衣服', 裤: '裤子', 袜: '袜子', 帽: '帽子', 鞋: '鞋子', 镜: '镜子', 碗: '饭碗', 筷: '筷子',
  走: '走路', 跑: '跑步', 跳: '跳高', 站: '站立', 坐: '坐下', 立: '立正', 飞: '飞机', 游: '游泳', 唱: '唱歌', 画: '画画',
  写: '写字', 读: '读书', 听: '听话', 说: '说话', 看: '看见', 问: '问题', 想: '想念', 笑: '微笑', 哭: '哭泣', 睡: '睡觉',
  醒: '醒来', 吃: '吃饭', 喝: '喝水', 开: '开门', 关: '关门', 拿: '拿着', 放: '放下', 推: '推车', 拉: '拉手', 找: '找到',
  长: '长短', 短: '短处', 高: '高兴', 低: '低头', 远: '远方', 近: '近处', 快: '快乐', 慢: '慢慢', 多: '多少', 少: '多少',
  新: '新年', 旧: '旧书', 冷: '冷水', 热: '热水', 香: '香味', 甜: '甜瓜', 苦: '苦瓜', 辣: '辣椒', 软: '柔软', 硬: '硬币',
  圆: '圆圈', 方: '方形', 尖: '尖尖', 平: '平安', 直: '直线', 弯: '弯腰', 亮: '明亮', 黑: '黑色', 白: '白色', 红: '红色',
}

/**
 * 字卡词图联想：Emoji + 组词 + 语境短句 + 拆字结构。
 * 只配置有把握的字，缺省字段会在 getWordCard 里自动降级（组词取自 WORD_EXAMPLES）。
 */
export type WordCard = {
  emoji?: string
  word?: string
  /** 语境短句，如「四季的四」 */
  sentence?: string
  /** 拆字结构，如「一 + 人」 */
  structure?: string
}

const WORD_CARDS: Record<string, WordCard> = {
  // ── 1 级 · 数字与基础字 ──
  一: { emoji: '1️⃣', sentence: '一二的一' },
  二: { emoji: '2️⃣', sentence: '二月的二' },
  三: { emoji: '3️⃣', sentence: '三个的三' },
  四: { emoji: '🍀', word: '四叶草', sentence: '四季的四' },
  五: { emoji: '🖐️', sentence: '五星的五' },
  六: { emoji: '6️⃣', sentence: '六月的六' },
  七: { emoji: '7️⃣', sentence: '七夕的七' },
  八: { emoji: '8️⃣', sentence: '八月的八' },
  九: { emoji: '9️⃣', sentence: '九天的九' },
  十: { emoji: '🔟', sentence: '十分的十' },
  人: { emoji: '🧍', sentence: '大人的人', structure: '撇 + 捺' },
  大: { emoji: '🐘', word: '大象', sentence: '大小的大', structure: '一 + 人' },
  小: { emoji: '🐜', sentence: '小鸟的小' },
  口: { emoji: '👄', sentence: '开口的口' },
  手: { emoji: '✋', sentence: '小手的手' },
  上: { emoji: '⬆️', sentence: '上面的上' },
  下: { emoji: '⬇️', sentence: '下面的下' },
  中: { emoji: '🎯', sentence: '中间的中' },
  山: { emoji: '⛰️', sentence: '大山的山' },
  水: { emoji: '💧', word: '水滴', sentence: '喝水的水' },
  火: { emoji: '🔥', sentence: '火苗的火' },
  木: { emoji: '🌳', sentence: '木头的木' },
  日: { emoji: '☀️', sentence: '日子的日', structure: '口 + 一' },
  月: { emoji: '🌙', sentence: '月亮的月' },
  土: { emoji: '🏜️', sentence: '土地的土' },
  石: { emoji: '🪨', sentence: '石头的石' },
  云: { emoji: '☁️', sentence: '白云的云' },
  雨: { emoji: '🌧️', sentence: '下雨的雨' },
  风: { emoji: '🌬️', sentence: '大风的风' },
  目: { emoji: '👁️', sentence: '目光的目' },

  // ── 2 级 · 身体与家人 ──
  耳: { emoji: '👂', sentence: '耳朵的耳' },
  头: { emoji: '🧑', sentence: '头发的头' },
  足: { emoji: '🦶', sentence: '足球的足' },
  身: { emoji: '🧍', sentence: '身体的身' },
  心: { emoji: '❤️', sentence: '爱心的心' },
  牙: { emoji: '🦷', sentence: '牙齿的牙' },
  爸: { emoji: '👨', sentence: '爸爸的爸' },
  妈: { emoji: '👩', sentence: '妈妈的妈', structure: '女 + 马' },
  爷: { emoji: '👴', sentence: '爷爷的爷' },
  奶: { emoji: '👵', sentence: '奶奶的奶' },
  哥: { emoji: '🧑', sentence: '哥哥的哥' },
  姐: { emoji: '👧', sentence: '姐姐的姐' },
  弟: { emoji: '👦', sentence: '弟弟的弟' },
  妹: { emoji: '👧', sentence: '妹妹的妹' },
  家: { emoji: '🏠', sentence: '家人的家' },
  们: { emoji: '👥', sentence: '我们的们' },
  你: { emoji: '🫵', sentence: '你们的你' },
  我: { emoji: '🙋', sentence: '我们的我' },
  他: { emoji: '🧑', sentence: '他们的他' },
  她: { emoji: '👩', sentence: '她的她' },
  好: { emoji: '👍', sentence: '好人的好', structure: '女 + 子' },
  学: { emoji: '📚', sentence: '学习的学' },
  生: { emoji: '🌱', sentence: '学生的生' },
  书: { emoji: '📖', sentence: '书本的书' },
  字: { emoji: '🔤', sentence: '汉字的字', structure: '宀 + 子' },
  语: { emoji: '🗣️', sentence: '语文的语' },
  文: { emoji: '📜', sentence: '文化的文' },
  笔: { emoji: '🖊️', sentence: '铅笔的笔' },
  本: { emoji: '📒', sentence: '本子的本' },
  包: { emoji: '🎒', sentence: '书包的包' },

  // ── 3 级 · 动物与自然 ──
  牛: { emoji: '🐮' }, 羊: { emoji: '🐑' }, 马: { emoji: '🐴' }, 鸟: { emoji: '🐦' }, 鱼: { emoji: '🐟' },
  虫: { emoji: '🐛' }, 鸡: { emoji: '🐔' }, 鸭: { emoji: '🦆' }, 兔: { emoji: '🐰' }, 狗: { emoji: '🐶' },
  猫: { emoji: '🐱' }, 猪: { emoji: '🐷' }, 花: { emoji: '🌸' }, 草: { emoji: '🌿', sentence: '小草的草' },
  树: { emoji: '🌳', sentence: '大树的树' }, 叶: { emoji: '🍃', sentence: '树叶的叶' },
  果: { emoji: '🍎', sentence: '水果的果' }, 瓜: { emoji: '🍉', sentence: '西瓜的瓜' },
  米: { emoji: '🍚', sentence: '大米的米' }, 麦: { emoji: '🌾' }, 豆: { emoji: '🫘' },
  菜: { emoji: '🥬', sentence: '白菜的菜' }, 竹: { emoji: '🎋' }, 林: { emoji: '🌲', sentence: '树林的林' },
  森: { emoji: '🌳' }, 江: { emoji: '🏞️', sentence: '长江的江' }, 河: { emoji: '🏞️', sentence: '小河的河' },
  海: { emoji: '🌊', sentence: '大海的海' }, 湖: { emoji: '🏞️', sentence: '湖水的湖' }, 波: { emoji: '🌊' },

  // ── 4 级 · 天象与生活物品 ──
  天: { emoji: '🌤️' }, 地: { emoji: '🌍', sentence: '大地的地' }, 星: { emoji: '⭐' },
  空: { emoji: '🌌', sentence: '天空的空' }, 雪: { emoji: '❄️' }, 霜: { emoji: '🧊' },
  雾: { emoji: '🌫️', sentence: '大雾的雾' }, 雷: { emoji: '⛈️', sentence: '打雷的雷' },
  电: { emoji: '⚡', sentence: '闪电的电' }, 光: { emoji: '💡', sentence: '阳光的光' },
  灯: { emoji: '🏮', structure: '火 + 丁' }, 车: { emoji: '🚗', sentence: '汽车的车' },
  船: { emoji: '⛵', sentence: '小船的船' }, 桥: { emoji: '🌉', sentence: '大桥的桥' },
  路: { emoji: '🛣️', sentence: '马路的路' }, 房: { emoji: '🏠' }, 屋: { emoji: '🏡' },
  门: { emoji: '🚪', sentence: '大门的门' }, 窗: { emoji: '🪟' }, 桌: { emoji: '🪑' },
  椅: { emoji: '💺' }, 床: { emoji: '🛏️' }, 衣: { emoji: '👕' }, 裤: { emoji: '👖' },
  袜: { emoji: '🧦' }, 帽: { emoji: '🧢' }, 鞋: { emoji: '👟' }, 镜: { emoji: '🪞' },
  碗: { emoji: '🥣' }, 筷: { emoji: '🥢' },

  // ── 5 级 · 动作 ──
  走: { emoji: '🚶' }, 跑: { emoji: '🏃' }, 跳: { emoji: '🤸' }, 站: { emoji: '🧍' }, 坐: { emoji: '🪑' },
  立: { emoji: '🧍' }, 飞: { emoji: '✈️', sentence: '飞机的飞' }, 游: { emoji: '🏊' }, 唱: { emoji: '🎤' },
  画: { emoji: '🎨' }, 写: { emoji: '✍️' }, 读: { emoji: '📖' }, 听: { emoji: '👂' }, 说: { emoji: '💬' },
  看: { emoji: '👀' }, 问: { emoji: '❓', sentence: '问题的问' }, 想: { emoji: '💭' }, 笑: { emoji: '😄' },
  哭: { emoji: '😢' }, 睡: { emoji: '😴' }, 醒: { emoji: '⏰' }, 吃: { emoji: '🍚' }, 喝: { emoji: '🥤' },
  开: { emoji: '🔓' }, 关: { emoji: '🔒' }, 拿: { emoji: '🤲' }, 放: { emoji: '📤' }, 推: { emoji: '➡️' },
  拉: { emoji: '⬅️' }, 找: { emoji: '🔍' },

  // ── 6 级 · 形容词 ──
  长: { emoji: '📏' }, 短: { emoji: '📐' }, 高: { emoji: '🦒' }, 低: { emoji: '🐜' },
  远: { emoji: '🏔️' }, 近: { emoji: '👣' }, 快: { emoji: '🐇' }, 慢: { emoji: '🐢' },
  多: { emoji: '🧺' }, 少: { emoji: '🥄', sentence: '多少的少' }, 新: { emoji: '🆕' }, 旧: { emoji: '📦' },
  冷: { emoji: '🥶' }, 热: { emoji: '🥵' }, 香: { emoji: '🌸' }, 甜: { emoji: '🍯' }, 苦: { emoji: '💊' },
  辣: { emoji: '🌶️' }, 软: { emoji: '🧸', sentence: '柔软的软' }, 硬: { emoji: '🪨' }, 圆: { emoji: '⭕' },
  方: { emoji: '🟦' }, 尖: { emoji: '🔺' }, 平: { emoji: '➖' }, 直: { emoji: '📏' }, 弯: { emoji: '🌙' },
  亮: { emoji: '🔆', sentence: '明亮的亮' }, 黑: { emoji: '⬛' }, 白: { emoji: '⬜' }, 红: { emoji: '🔴' },
}

/**
 * 取某个字的词图联想信息；表里没有的字返回 null（UI 降级为只显示汉字和拼音）。
 * 组词优先用词卡配置，其次用 WORD_EXAMPLES；语境短句在组词以该字开头时自动生成。
 */
export function getWordCard(ch: string): WordCard | null {
  const rich = WORD_CARDS[ch]
  const word = rich?.word ?? WORD_EXAMPLES[ch]
  if (!rich && !word) return null
  const sentence = rich?.sentence ?? (word && word.startsWith(ch) ? `${word}的${ch}` : undefined)
  return { emoji: rich?.emoji, word, sentence, structure: rich?.structure }
}

/** 由组词反查 Emoji：优先同名词卡，其次以该组词开头的语境句 */
function emojiForWord(word: string): string | undefined {
  let fuzzy: string | undefined
  for (const card of Object.values(WORD_CARDS)) {
    if (!card.emoji) continue
    if (card.word === word) return card.emoji
    if (!fuzzy && card.sentence?.startsWith(word)) fuzzy = card.emoji
  }
  return fuzzy
}

/**
 * 把字卡的 Emoji / 组词 / 语境句统一到同一个语义：
 * 组词以数据库 word 为准（必须包含本字），Emoji 与语境句都由这个组词推导，
 * 避免出现「显示月亮、朗读明亮」这类不一致。
 */
export function resolveWordCard(
  ch: string,
  db?: { emoji?: string | null; word?: string | null; sentence?: string | null } | null,
): WordCard | null {
  const local = getWordCard(ch)
  const dbWord = db?.word?.trim()
  const word = dbWord && dbWord.includes(ch) ? dbWord : local?.word
  const dbEmoji = db?.emoji && db.emoji !== '✨' ? db.emoji : undefined

  if (!word) {
    const sentence = db?.sentence?.trim() || local?.sentence
    const emoji = dbEmoji ?? local?.emoji
    return emoji || sentence ? { emoji, sentence, structure: local?.structure } : null
  }

  const emoji = emojiForWord(word) ?? (local?.word === word ? local.emoji : undefined) ?? dbEmoji ?? local?.emoji
  return { emoji, word, sentence: `${word}的${ch}`, structure: local?.structure }
}
