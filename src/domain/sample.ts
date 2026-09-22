import { freezeBatch } from './batch'
import { stableHash } from './hash'
import type { Answer, AppState, AssetRef, Draft, FormVersion } from './types'

const T0 = Date.UTC(2026, 8, 1, 9, 0, 0) // 2026-09-01
const DAY = 86_400_000

function ans(questionId: string, value: Answer['value'], source: Answer['source'], at: number): Answer {
  return { questionId, value, source, updatedAt: at }
}

function answersOf(list: Answer[]): Record<string, Answer> {
  return Object.fromEntries(list.map(a => [a.questionId, a]))
}

function assets(draftId: string): AssetRef[] {
  return [
    { id: `${draftId}_icon`, kind: 'icon', label: '应用图标 512×512', checksum: stableHash(`${draftId}:icon`) },
    { id: `${draftId}_shot`, kind: 'screenshot', label: '主界面截图', checksum: stableHash(`${draftId}:screenshot`) },
  ]
}

/**
 * 内置样例：效率应用 FocusFlow 多地区上架。
 * v1 把隐私说明揉成一道题；v2 拆成条件问题，地区声明从欧盟扩展到韩国，
 * 崩溃上报去掉「每次询问」选项，并新增平台必填声明。
 * Android/欧盟 草稿故意缺一段地区声明（对应上次换版丢声明的事故）。
 */
export function createSampleState(): AppState {
  const v1: FormVersion = {
    id: 'fv_v1',
    label: 'v1 · 2025 资料表',
    note: '单条隐私说明的旧版资料表',
    createdAt: T0,
    questions: [
      {
        id: 'q_privacy_collect',
        title: '是否收集用户数据？',
        type: 'single',
        required: true,
        options: [
          { id: 'none', label: '不收集' },
          { id: 'anonymous', label: '仅匿名数据' },
          { id: 'personal', label: '个人数据' },
        ],
      },
      {
        id: 'q_region_note',
        title: '欧盟地区隐私声明',
        type: 'text',
        required: true,
        options: [],
        condition: { regions: ['EU'] },
      },
      { id: 'q_analytics', title: '是否接入分析 SDK？', type: 'boolean', required: true, options: [] },
      {
        id: 'q_crash',
        title: '崩溃上报策略',
        type: 'single',
        required: true,
        options: [
          { id: 'auto', label: '自动上报' },
          { id: 'ask', label: '每次询问' },
          { id: 'never', label: '不上报' },
        ],
      },
      { id: 'q_support', title: '支持链接', type: 'text', required: true, options: [] },
    ],
  }

  const v2: FormVersion = {
    id: 'fv_v2',
    label: 'v2 · 2026 多地区资料表',
    note: '隐私说明拆分为条件问题，地区声明扩展到韩国',
    createdAt: T0 + 30 * DAY,
    questions: [
      { id: 'q_data_collect', title: '是否收集任何数据？', type: 'boolean', required: true, options: [], splitFrom: 'q_privacy_collect' },
      {
        id: 'q_data_types',
        title: '收集哪些数据类型？',
        type: 'multi',
        required: true,
        options: [
          { id: 'usage', label: '使用数据' },
          { id: 'device', label: '设备标识' },
          { id: 'identity', label: '身份信息' },
          { id: 'location', label: '位置信息' },
        ],
        splitFrom: 'q_privacy_collect',
        condition: { dependsOn: { questionId: 'q_data_collect', equals: 'true' } },
      },
      {
        id: 'q_data_ads',
        title: '数据是否用于广告？',
        type: 'single',
        required: true,
        options: [
          { id: 'noads', label: '不用于广告' },
          { id: 'contextual', label: '情境广告' },
          { id: 'personalized', label: '个性化广告' },
        ],
        splitFrom: 'q_privacy_collect',
        condition: { dependsOn: { questionId: 'q_data_collect', equals: 'true' } },
      },
      {
        id: 'q_region_decl',
        title: '地区隐私声明（欧盟/韩国）',
        type: 'text',
        required: true,
        options: [],
        condition: { regions: ['EU', 'KR'] },
        replaces: 'q_region_note',
      },
      {
        id: 'q_analytics_level',
        title: '分析数据级别',
        type: 'single',
        required: true,
        options: [
          { id: 'off', label: '关闭' },
          { id: 'anonymous', label: '匿名统计' },
          { id: 'full', label: '完整分析' },
        ],
        replaces: 'q_analytics',
      },
      {
        id: 'q_crash',
        title: '崩溃上报策略',
        type: 'single',
        required: true,
        options: [
          { id: 'auto', label: '自动上报' },
          { id: 'never', label: '不上报' },
        ],
      },
      { id: 'q_support', title: '支持链接', type: 'text', required: true, options: [] },
      {
        id: 'q_android_safety',
        title: 'Android 数据安全声明',
        type: 'text',
        required: true,
        options: [],
        condition: { platforms: ['android'] },
      },
      {
        id: 'q_ios_att',
        title: 'iOS 跟踪透明度说明',
        type: 'text',
        required: true,
        options: [],
        condition: { platforms: ['ios'] },
      },
    ],
  }

  const at = T0 + 20 * DAY
  const drafts: Draft[] = [
    {
      id: 'd_android_us',
      appId: 'app_focusflow',
      appName: 'FocusFlow',
      platform: 'android',
      region: 'US',
      formVersionId: 'fv_v1',
      updatedAt: at,
      assets: assets('d_android_us'),
      answers: answersOf([
        ans('q_privacy_collect', 'none', 'manual', at),
        ans('q_analytics', false, 'manual', at),
        ans('q_crash', 'auto', 'manual', at),
        ans('q_support', 'https://focusflow.example/support', 'imported', at),
      ]),
    },
    {
      id: 'd_android_eu',
      appId: 'app_focusflow',
      appName: 'FocusFlow',
      platform: 'android',
      region: 'EU',
      formVersionId: 'fv_v1',
      updatedAt: at,
      assets: assets('d_android_eu'),
      answers: answersOf([
        ans('q_privacy_collect', 'anonymous', 'manual', at),
        ans('q_analytics', true, 'manual', at),
        ans('q_crash', 'auto', 'manual', at),
        ans('q_support', 'https://focusflow.example/support', 'imported', at),
        // 故意缺少 q_region_note：上次换版后 Android 旧草稿丢了一段地区声明
      ]),
    },
    {
      id: 'd_android_kr',
      appId: 'app_focusflow',
      appName: 'FocusFlow',
      platform: 'android',
      region: 'KR',
      formVersionId: 'fv_v1',
      updatedAt: at,
      assets: assets('d_android_kr'),
      answers: answersOf([
        ans('q_privacy_collect', 'none', 'manual', at),
        ans('q_analytics', false, 'manual', at),
        ans('q_crash', 'never', 'manual', at),
        ans('q_support', 'https://focusflow.example/support', 'inherited', at),
      ]),
    },
    {
      id: 'd_ios_us',
      appId: 'app_focusflow',
      appName: 'FocusFlow',
      platform: 'ios',
      region: 'US',
      formVersionId: 'fv_v1',
      updatedAt: at,
      assets: assets('d_ios_us'),
      answers: answersOf([
        ans('q_privacy_collect', 'personal', 'manual', at),
        ans('q_analytics', true, 'manual', at),
        ans('q_crash', 'ask', 'manual', at),
        ans('q_support', 'https://focusflow.example/support', 'imported', at),
      ]),
    },
    {
      id: 'd_ios_eu',
      appId: 'app_focusflow',
      appName: 'FocusFlow',
      platform: 'ios',
      region: 'EU',
      formVersionId: 'fv_v1',
      updatedAt: at,
      assets: assets('d_ios_eu'),
      answers: answersOf([
        ans('q_privacy_collect', 'anonymous', 'manual', at),
        ans('q_region_note', '我们仅为提供服务而在欧盟境内处理必要数据。', 'manual', at),
        ans('q_analytics', false, 'manual', at),
        ans('q_crash', 'auto', 'manual', at),
        ans('q_support', 'https://focusflow.example/support', 'imported', at),
      ]),
    },
  ]

  const batch = freezeBatch(
    'b_launch',
    '2026-09 首发批次',
    drafts.map(d => d.id),
    drafts,
    v1,
    T0 + 40 * DAY,
  )

  return {
    formVersions: [v1, v2],
    currentFormVersionId: 'fv_v2',
    drafts,
    batches: [batch],
    reviewLog: [],
  }
}
