import { describe, expect, it } from 'vitest';
import { buildSampleState } from '../domain/seed';
import { isQuestionVisible, scopeApplies } from '../domain/conditions';
import { diffVersions, impactedDrafts } from '../domain/diff';

const NOW = 1_758_000_000_000;

function setup() {
  const state = buildSampleState(NOW);
  const v1 = state.versions.find((v) => v.id === 'form-v1-2025')!;
  const v2 = state.versions.find((v) => v.id === 'form-v2-2026')!;
  const draft = (id: string) => state.drafts.find((d) => d.id === id)!;
  return { state, v1, v2, draft };
}

describe('条件分支与地区范围', () => {
  it('v1：追踪题只在“第三方广告”时展示', () => {
    const { v1, draft } = setup();
    const tracking = v1.questions.find((q) => q.key === 'q_tracking')!;
    expect(isQuestionVisible(tracking, draft('draft-android-us'), v1.questions)).toBe(true);
    expect(isQuestionVisible(tracking, draft('draft-android-cn'), v1.questions)).toBe(false);
  });

  it('v2：追踪条件放宽为收集数据即展示（条件调整的影响）', () => {
    const { v2, draft } = setup();
    const tracking = v2.questions.find((q) => q.key === 'q_tracking')!;
    // Android CN 旧草稿是自营广告、收集数据：v1 隐藏追踪，v2 需要作答
    expect(isQuestionVisible(tracking, draft('draft-android-cn'), v2.questions)).toBe(true);
  });

  it('拆分出的声明题受“收集数据”条件控制', () => {
    const { v2, draft } = setup();
    const cn = v2.questions.find((q) => q.key === 'q_region_cn')!;
    const row = v2.questions.find((q) => q.key === 'q_region_row')!;
    // iOS CN 草稿选择不收集 -> 声明题全部隐藏
    expect(isQuestionVisible(cn, draft('draft-ios-cn'), v2.questions)).toBe(false);
    // Android CN 草稿收集数据 -> CN 声明展示
    expect(isQuestionVisible(cn, draft('draft-android-cn'), v2.questions)).toBe(true);
    // ROW 声明题对 CN 地区范围外
    expect(scopeApplies(row.scope, 'android', 'CN')).toBe(false);
    expect(isQuestionVisible(row, draft('draft-android-cn'), v2.questions)).toBe(false);
    // 对 US 地区展示
    expect(isQuestionVisible(row, draft('draft-android-us'), v2.questions)).toBe(true);
  });

  it('平台/地区范围判断', () => {
    const { v2 } = setup();
    const cn = v2.questions.find((q) => q.key === 'q_region_cn')!;
    expect(scopeApplies(cn.scope, 'ios', 'CN')).toBe(true);
    expect(scopeApplies(cn.scope, 'ios', 'US')).toBe(false);
  });
});

describe('版本 diff', () => {
  it('识别题目拆分、选项新增与条件调整', () => {
    const { v1, v2, state } = setup();
    const diff = diffVersions(v1, v2);
    const kinds = new Map(diff.changes.map((c) => [c.previous?.key ?? c.question?.key, c.kind]));
    expect(kinds.get('q_region_statement')).toBe('split');
    expect(kinds.get('q_ads')).toBe('options-changed');
    expect(kinds.get('q_tracking')).toBe('condition-changed');
    expect(kinds.get('q_collect')).toBe('unchanged');

    const split = diff.changes.find((c) => c.kind === 'split')!;
    expect(split.splitInto?.map((q) => q.key).sort()).toEqual([
      'q_purpose',
      'q_region_cn',
      'q_region_row',
    ]);

    const impacts = impactedDrafts(diff, state.drafts);
    const impactedIds = new Set(impacts.map((i) => i.draftId));
    // Android CN 旧草稿有那段笼统声明文字，且追踪条件变化需要补答
    expect(impactedIds.has('draft-android-cn')).toBe(true);
    const cnImpact = impacts.find((i) => i.draftId === 'draft-android-cn')!;
    expect(cnImpact.items.some((i) => i.key === 'q_region_statement' && i.kind === 'split')).toBe(true);
    expect(cnImpact.items.some((i) => i.key === 'q_tracking' && i.kind === 'condition-changed')).toBe(true);
    // 新增的联盟广告选项没有删除任何旧选项，ads_self 草稿不报选项冲突
    expect(cnImpact.items.some((i) => i.key === 'q_ads')).toBe(false);
  });
});
