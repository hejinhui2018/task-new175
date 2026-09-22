import type {
  AppState,
  AssetRef,
  Draft,
  FormVersion,
  MigrationPlan,
} from './types';

const ALL = ['android', 'ios'] as const;

/** v1（2025 旧版）：隐私说明还是一道合并的文本题 */
export function sampleV1(now: number): FormVersion {
  return {
    id: 'form-v1-2025',
    name: '2025 资料表 v1',
    createdAt: now - 1000 * 60 * 60 * 24 * 90,
    note: '隐私收集与地区声明为同一段文字说明',
    questions: [
      {
        id: 'q1',
        key: 'q_collect',
        title: '应用是否收集个人数据？',
        type: 'single',
        options: [
          { id: 'yes', label: '是' },
          { id: 'no', label: '否' },
        ],
        conditions: [],
        scope: { platforms: [...ALL], regions: ['*'] },
      },
      {
        id: 'q2',
        key: 'q_region_statement',
        title: '隐私说明：请描述数据收集适用的地区与目的',
        type: 'text',
        options: [],
        conditions: [{ questionId: 'q_collect', optionId: 'yes' }],
        scope: { platforms: [...ALL], regions: ['*'] },
      },
      {
        id: 'q3',
        key: 'q_ads',
        title: '应用是否包含广告？',
        type: 'single',
        options: [
          { id: 'ads_no', label: '无广告' },
          { id: 'ads_self', label: '自营推广' },
          { id: 'ads_thirdparty', label: '第三方广告' },
        ],
        conditions: [],
        scope: { platforms: [...ALL], regions: ['*'] },
      },
      {
        id: 'q4',
        key: 'q_tracking',
        title: '是否使用广告标识符进行追踪？',
        type: 'single',
        options: [
          { id: 'track_yes', label: '是' },
          { id: 'track_no', label: '否' },
        ],
        // v1：只有第三方广告才问追踪
        conditions: [{ questionId: 'q_ads', optionId: 'ads_thirdparty' }],
        scope: { platforms: [...ALL], regions: ['*'] },
      },
    ],
  };
}

/** v2（2026 新版）：隐私说明拆成多道平台/地区条件题 */
export function sampleV2(now: number): FormVersion {
  return {
    id: 'form-v2-2026',
    name: '2026 资料表 v2',
    createdAt: now - 1000 * 60 * 60 * 24 * 10,
    note: '隐私说明拆分为中国大陆声明、其他地区声明与收集目的，追踪条件调整为“收集数据即询问”，广告新增联盟广告选项',
    questions: [
      {
        id: 'q1',
        key: 'q_collect',
        title: '应用是否收集个人数据？',
        type: 'single',
        options: [
          { id: 'yes', label: '是' },
          { id: 'no', label: '否' },
        ],
        conditions: [],
        scope: { platforms: [...ALL], regions: ['*'] },
      },
      {
        id: 'q2a',
        key: 'q_region_cn',
        title: '中国大陆地区数据收集声明（单独声明）',
        type: 'single',
        options: [
          { id: 'cn_declared', label: '已在隐私政策中单独声明' },
          { id: 'cn_none', label: '不在中国大陆收集' },
        ],
        conditions: [{ questionId: 'q_collect', optionId: 'yes' }],
        scope: { platforms: [...ALL], regions: ['CN'] },
        splitFrom: 'q_region_statement',
      },
      {
        id: 'q2b',
        key: 'q_region_row',
        title: '其他地区数据收集声明',
        type: 'single',
        options: [
          { id: 'row_declared', label: '已按当地要求声明（GDPR/CCPA 等）' },
          { id: 'row_none', label: '不在上述地区收集' },
        ],
        conditions: [{ questionId: 'q_collect', optionId: 'yes' }],
        scope: { platforms: [...ALL], regions: ['US', 'EU-DE', 'JP'] },
        splitFrom: 'q_region_statement',
      },
      {
        id: 'q2c',
        key: 'q_purpose',
        title: '数据收集目的（可多选）',
        type: 'multi',
        options: [
          { id: 'p_analytics', label: '分析统计' },
          { id: 'p_ads', label: '广告归因' },
          { id: 'p_func', label: '基础功能（同步/提醒）' },
        ],
        conditions: [{ questionId: 'q_collect', optionId: 'yes' }],
        scope: { platforms: [...ALL], regions: ['*'] },
        splitFrom: 'q_region_statement',
      },
      {
        id: 'q3',
        key: 'q_ads',
        title: '应用是否包含广告？',
        type: 'single',
        options: [
          { id: 'ads_no', label: '无广告' },
          { id: 'ads_self', label: '自营推广' },
          { id: 'ads_thirdparty', label: '第三方广告' },
          { id: 'ads_affiliate', label: '联盟广告（新增）' },
        ],
        conditions: [],
        scope: { platforms: [...ALL], regions: ['*'] },
      },
      {
        id: 'q4',
        key: 'q_tracking',
        title: '是否使用广告标识符进行追踪？',
        type: 'single',
        options: [
          { id: 'track_yes', label: '是' },
          { id: 'track_no', label: '否' },
        ],
        // 条件调整：v2 只要收集数据就询问
        conditions: [{ questionId: 'q_collect', optionId: 'yes' }],
        scope: { platforms: [...ALL], regions: ['*'] },
      },
    ],
  };
}

function privacyDoc(seed: string, fp: string): AssetRef {
  return {
    id: `asset-privacy-${seed}`,
    name: `FocusFlow 隐私政策（${seed}）.pdf`,
    kind: 'doc',
    fingerprint: fp,
    uri: `assets://privacy-${seed}.pdf`,
  };
}

function screenshot(seed: string, fp: string): AssetRef {
  return {
    id: `asset-shot-${seed}`,
    name: `应用截图（${seed}）.png`,
    kind: 'image',
    fingerprint: fp,
    uri: `assets://shot-${seed}.png`,
  };
}

export function sampleDrafts(now: number): Draft[] {
  const base = {
    appName: 'FocusFlow 专注效率',
    formVersionId: 'form-v1-2025',
    status: 'draft' as const,
  };
  return [
    {
      ...base,
      id: 'draft-android-cn',
      platform: 'android',
      region: 'CN',
      updatedAt: now - 86400_000 * 3,
      assets: [privacyDoc('android-cn', 'fp-doc-cn-1'), screenshot('android-cn', 'fp-shot-cn-1')],
      // 上次换版后，这份 Android 旧草稿的地区声明只剩笼统文字
      answers: [
        { questionKey: 'q_collect', optionIds: ['yes'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_collect' },
        { questionKey: 'q_region_statement', optionIds: [], text: '收集一些分析数据', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_region_statement' },
        { questionKey: 'q_ads', optionIds: ['ads_self'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_ads' },
      ],
    },
    {
      ...base,
      id: 'draft-android-us',
      platform: 'android',
      region: 'US',
      updatedAt: now - 86400_000 * 5,
      assets: [privacyDoc('android-us', 'fp-doc-us-1'), screenshot('android-us', 'fp-shot-us-1')],
      answers: [
        { questionKey: 'q_collect', optionIds: ['yes'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_collect' },
        { questionKey: 'q_region_statement', optionIds: [], text: 'Analytics and crash data collected worldwide.', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_region_statement' },
        { questionKey: 'q_ads', optionIds: ['ads_thirdparty'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_ads' },
        { questionKey: 'q_tracking', optionIds: ['track_yes'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_tracking' },
      ],
    },
    {
      ...base,
      id: 'draft-ios-cn',
      platform: 'ios',
      region: 'CN',
      updatedAt: now - 86400_000 * 2,
      assets: [privacyDoc('ios-cn', 'fp-doc-ioscn-1'), screenshot('ios-cn', 'fp-shot-ioscn-1')],
      // 不收集数据：拆分后的声明题对它全部隐藏
      answers: [
        { questionKey: 'q_collect', optionIds: ['no'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_collect' },
        { questionKey: 'q_ads', optionIds: ['ads_no'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_ads' },
      ],
    },
    {
      ...base,
      id: 'draft-ios-de',
      platform: 'ios',
      region: 'EU-DE',
      updatedAt: now - 86400_000 * 8,
      assets: [privacyDoc('ios-de', 'fp-doc-de-1'), screenshot('ios-de', 'fp-shot-de-1')],
      answers: [
        { questionKey: 'q_collect', optionIds: ['yes'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_collect' },
        { questionKey: 'q_region_statement', optionIds: [], text: 'Daten werden für Analyse und Werbung erhoben (DSGVO).', source: { kind: 'asset', ref: 'asset-privacy-ios-de' }, basedOn: 'form-v1-2025:q_region_statement' },
        { questionKey: 'q_ads', optionIds: ['ads_thirdparty'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_ads' },
        { questionKey: 'q_tracking', optionIds: ['track_yes'], text: '', source: { kind: 'manual' }, basedOn: 'form-v1-2025:q_tracking' },
      ],
    },
  ];
}

/** 版本间迁移计划：声明每道旧题答案的去向 */
export function samplePlan(now: number): MigrationPlan {
  return {
    id: 'plan-v1-to-v2',
    fromVersionId: 'form-v1-2025',
    toVersionId: 'form-v2-2026',
    createdAt: now - 86400_000 * 9,
    mappings: [
      { fromKey: 'q_collect', destination: 'carry' },
      // 一段文字无法自动判定各地区选项 -> 逐份草稿人工确认（ambiguous-split）
      {
        fromKey: 'q_region_statement',
        destination: 'split',
        toKeys: ['q_region_cn', 'q_region_row', 'q_purpose'],
        note: '原隐私说明为一段文字，CN/ROW 声明选项与收集目的需逐份确认；范围外的目标题自动跳过',
      },
      { fromKey: 'q_ads', destination: 'carry', note: '新增联盟广告选项，旧答案仍有效' },
      { fromKey: 'q_tracking', destination: 'carry', note: 'v2 条件放宽：收集数据即询问，原“是”答案沿用；不追踪者需补答' },
    ],
  };
}

export function buildSampleState(now: number): AppState {
  return {
    versions: [sampleV1(now), sampleV2(now)],
    activeVersionId: 'form-v2-2026',
    drafts: sampleDrafts(now),
    plans: [samplePlan(now)],
    batches: [],
    reviewLog: [],
  };
}
