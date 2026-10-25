/** 英语模块本地内容：26 个字母 + 适合学龄前儿童的词汇库（纯前端，不依赖数据库） */

export type AlphabetLetter = {
  upper: string
  lower: string
}

export const ALPHABET: AlphabetLetter[] = Array.from({ length: 26 }, (_, index) => {
  const upper = String.fromCharCode(65 + index)
  return { upper, lower: upper.toLowerCase() }
})

export type VocabWord = {
  en: string
  zh: string
  emoji: string
}

/**
 * 词汇库：26 个字母全覆盖，每个字母尽量提供 2~3 个常见词，
 * 供词汇视听随机出题、自然拼读按字母分组练习。
 */
export const VOCAB: VocabWord[] = [
  { en: 'Apple', zh: '苹果', emoji: '🍎' },
  { en: 'Ant', zh: '蚂蚁', emoji: '🐜' },
  { en: 'Airplane', zh: '飞机', emoji: '✈️' },
  { en: 'Banana', zh: '香蕉', emoji: '🍌' },
  { en: 'Ball', zh: '球', emoji: '⚽' },
  { en: 'Bear', zh: '熊', emoji: '🐻' },
  { en: 'Cat', zh: '猫', emoji: '🐱' },
  { en: 'Car', zh: '汽车', emoji: '🚗' },
  { en: 'Cake', zh: '蛋糕', emoji: '🍰' },
  { en: 'Dog', zh: '狗', emoji: '🐶' },
  { en: 'Duck', zh: '鸭子', emoji: '🦆' },
  { en: 'Drum', zh: '鼓', emoji: '🥁' },
  { en: 'Elephant', zh: '大象', emoji: '🐘' },
  { en: 'Egg', zh: '鸡蛋', emoji: '🥚' },
  { en: 'Ear', zh: '耳朵', emoji: '👂' },
  { en: 'Fish', zh: '鱼', emoji: '🐟' },
  { en: 'Frog', zh: '青蛙', emoji: '🐸' },
  { en: 'Flower', zh: '花', emoji: '🌸' },
  { en: 'Grapes', zh: '葡萄', emoji: '🍇' },
  { en: 'Giraffe', zh: '长颈鹿', emoji: '🦒' },
  { en: 'Guitar', zh: '吉他', emoji: '🎸' },
  { en: 'Horse', zh: '马', emoji: '🐴' },
  { en: 'Hat', zh: '帽子', emoji: '👒' },
  { en: 'House', zh: '房子', emoji: '🏠' },
  { en: 'Ice cream', zh: '冰淇淋', emoji: '🍦' },
  { en: 'Insect', zh: '昆虫', emoji: '🐛' },
  { en: 'Island', zh: '小岛', emoji: '🏝️' },
  { en: 'Juice', zh: '果汁', emoji: '🧃' },
  { en: 'Jeep', zh: '吉普车', emoji: '🚙' },
  { en: 'Kite', zh: '风筝', emoji: '🪁' },
  { en: 'Key', zh: '钥匙', emoji: '🔑' },
  { en: 'Kangaroo', zh: '袋鼠', emoji: '🦘' },
  { en: 'Lion', zh: '狮子', emoji: '🦁' },
  { en: 'Lemon', zh: '柠檬', emoji: '🍋' },
  { en: 'Leaf', zh: '叶子', emoji: '🍃' },
  { en: 'Monkey', zh: '猴子', emoji: '🐵' },
  { en: 'Moon', zh: '月亮', emoji: '🌙' },
  { en: 'Milk', zh: '牛奶', emoji: '🥛' },
  { en: 'Nose', zh: '鼻子', emoji: '👃' },
  { en: 'Noodle', zh: '面条', emoji: '🍜' },
  { en: 'Orange', zh: '橙子', emoji: '🍊' },
  { en: 'Owl', zh: '猫头鹰', emoji: '🦉' },
  { en: 'Octopus', zh: '章鱼', emoji: '🐙' },
  { en: 'Panda', zh: '熊猫', emoji: '🐼' },
  { en: 'Pig', zh: '猪', emoji: '🐷' },
  { en: 'Pizza', zh: '披萨', emoji: '🍕' },
  { en: 'Queen', zh: '女王', emoji: '👑' },
  { en: 'Quilt', zh: '被子', emoji: '🛏️' },
  { en: 'Rabbit', zh: '兔子', emoji: '🐰' },
  { en: 'Rainbow', zh: '彩虹', emoji: '🌈' },
  { en: 'Robot', zh: '机器人', emoji: '🤖' },
  { en: 'Sun', zh: '太阳', emoji: '☀️' },
  { en: 'Star', zh: '星星', emoji: '⭐' },
  { en: 'Snake', zh: '蛇', emoji: '🐍' },
  { en: 'Tiger', zh: '老虎', emoji: '🐯' },
  { en: 'Tree', zh: '树', emoji: '🌳' },
  { en: 'Train', zh: '火车', emoji: '🚂' },
  { en: 'Umbrella', zh: '雨伞', emoji: '☂️' },
  { en: 'Unicorn', zh: '独角兽', emoji: '🦄' },
  { en: 'Violin', zh: '小提琴', emoji: '🎻' },
  { en: 'Van', zh: '面包车', emoji: '🚐' },
  { en: 'Volcano', zh: '火山', emoji: '🌋' },
  { en: 'Watermelon', zh: '西瓜', emoji: '🍉' },
  { en: 'Wolf', zh: '狼', emoji: '🐺' },
  { en: 'Whale', zh: '鲸鱼', emoji: '🐳' },
  { en: 'Xylophone', zh: '木琴', emoji: '🎹' },
  { en: 'Yo-yo', zh: '溜溜球', emoji: '🪀' },
  { en: 'Yarn', zh: '毛线', emoji: '🧶' },
  { en: 'Zebra', zh: '斑马', emoji: '🦓' },
]
