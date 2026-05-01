export const DEFAULT_CONTENT_CATEGORIES = [
  '工作',
  '家庭',
  '恋爱与亲密关系',
  '个人成长',
  '学习',
  '财务',
  '运动健康',
  '社交',
  '玩乐休闲',
  '灵性修行',
  '日常生活',
]

export const DEFAULT_CORE_NEEDS = [
  '被理解', '被看见', '被接纳', '被爱', '被需要',
  '被认可', '被信任', '安全感', '掌控感', '归属感',
  '独立自主', '公平', '边界被尊重', '被支持', '休息',
  '成就感', '意义感', '自我表达', '连接感', '被倾听',
]

export const DEFAULT_CONTACTS = [
  { canonical: '妈妈', aliases: ['妈妈', '母亲', '老妈', '阿妈'], group_name: '家人' },
  { canonical: '爸爸', aliases: ['爸爸', '父亲', '老爸', '阿爸'], group_name: '家人' },
  { canonical: '奶奶', aliases: ['奶奶', '祖母'], group_name: '家人' },
  { canonical: '爷爷', aliases: ['爷爷', '祖父'], group_name: '家人' },
  { canonical: '外婆', aliases: ['外婆', '姥姥', '外祖母'], group_name: '家人' },
  { canonical: '外公', aliases: ['外公', '姥爷', '外祖父'], group_name: '家人' },
  { canonical: '哥哥', aliases: ['哥哥', '大哥', '兄长'], group_name: '家人' },
  { canonical: '弟弟', aliases: ['弟弟', '小弟'], group_name: '家人' },
  { canonical: '姐姐', aliases: ['姐姐', '大姐'], group_name: '家人' },
  { canonical: '妹妹', aliases: ['妹妹', '小妹'], group_name: '家人' },
  { canonical: '男友', aliases: ['男友', '男朋友', '男盆友'], group_name: '伴侣' },
  { canonical: '女友', aliases: ['女友', '女朋友', '女盆友'], group_name: '伴侣' },
  { canonical: '老公', aliases: ['老公', '丈夫', '先生'], group_name: '伴侣' },
  { canonical: '老婆', aliases: ['老婆', '妻子', '太太'], group_name: '伴侣' },
  { canonical: '婆婆', aliases: ['婆婆'], group_name: '家人' },
  { canonical: '老板', aliases: ['老板', '上司', '领导'], group_name: '同事' },
  { canonical: '同事', aliases: ['同事'], group_name: '同事' },
  { canonical: '客户', aliases: ['客户', '甲方'], group_name: '同事' },
  { canonical: '朋友', aliases: ['朋友', '好友', '好朋友'], group_name: '朋友' },
  { canonical: '闺蜜', aliases: ['闺蜜', '死党'], group_name: '朋友' },
  { canonical: '同学', aliases: ['同学'], group_name: '朋友' },
  { canonical: '室友', aliases: ['室友'], group_name: '朋友' },
]

export function createDefaultCategoryRows(userId) {
  return DEFAULT_CONTENT_CATEGORIES.map((label, index) => ({
    user_id: userId,
    field_name: 'content_category',
    option_value: label,
    sort_order: index,
  }))
}

export function createDefaultCoreNeedRows(userId) {
  return DEFAULT_CORE_NEEDS.map((label, index) => ({
    user_id: userId,
    field_name: 'core_need',
    option_value: label,
    sort_order: index,
  }))
}

export function createDefaultContactRows(userId) {
  return DEFAULT_CONTACTS.map((contact, index) => ({
    user_id: userId,
    canonical: contact.canonical,
    aliases: contact.aliases,
    group_name: contact.group_name ?? null,
    sort_order: index,
  }))
}
