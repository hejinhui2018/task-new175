import { describe, expect, it } from 'vitest';
import { buildSampleState } from '../domain/seed';
import {
  applyDraftMigration,
  previewDraftMigration,
  resolvePreview,
} from '../domain/migration';
import type { Draft } from '../domain/types';

const NOW = 1_758_000_000_000;

function setup() {
  const state = buildSampleState(NOW);
  const v1 = state.versions.find((v) => v.id === 'form-v1-2025')!;
  const v2 = state.versions.find((v) => v.id === 'form-v2-2026')!;
  const draft = (id: string) => state.drafts.find((d) => d.id === id)!;
  return { state, v1, v2, draft };
}

function previewOf(d: Draft, v1: ReturnType<typeof setup>['v1'], v2: ReturnType<typeof setup>['v2'], plans: ReturnType<typeof setup>['state']['plans'], onlyKeys?: string[]) {
  return previewDraftMigration(d, v1, v2, plans, onlyKeys ? { onlyKeys } : {});
}

describe('迁移预览：答案去向与冲突', () => {
  it('一段旧声明被拆分：去向为 split 且必须人工逐题确认（ambiguous-split）', () => {
    const { v1, v2, state, draft } = setup();
    const pv = previewOf(draft('draft-android-cn'), v1, v2, state.plans);
    const split = pv.migrations.find((m) => m.fromKey === 'q_region_statement')!;
    expect(split.destination).toBe('split');
    expect(split.conflicts).toContain('ambiguous-split');
    expect(pv.blocked).toBe(true);
    // CN 草稿上 ROW 目标题范围外
    expect(split.conflicts).toContain('scope-excluded');
    // 未解决前拒绝写入
    expect(() => applyDraftMigration(draft('draft-android-cn'), v2, pv, NOW)).toThrow();
  });

  it('逐份人工确认拆分目标后冲突解除，其余未确认草稿保持原样', () => {
    const { v1, v2, state, draft } = setup();
    const d = draft('draft-android-cn');
    const pv = previewOf(d, v1, v2, state.plans);
    const resolved = resolvePreview(d, v2, pv, {
      q_region_statement: {
        // 范围外的 ROW 声明跳过
        skipKeys: ['q_region_row'],
        answers: [
          { questionKey: 'q_region_cn', optionIds: ['cn_declared'] },
          { questionKey: 'q_purpose', optionIds: ['p_analytics', 'p_func'] },
        ],
      },
    });
    expect(resolved.blocked).toBe(false);

    const migrated = applyDraftMigration(d, v2, resolved, NOW);
    expect(migrated.formVersionId).toBe(v2.id);
    const keys = new Set(migrated.answers.map((a) => a.questionKey));
    expect(keys.has('q_region_cn')).toBe(true);
    expect(keys.has('q_region_row')).toBe(false); // 范围外跳过
    expect(keys.has('q_purpose')).toBe(true);
    expect(keys.has('q_region_statement')).toBe(false); // 旧答案已消费
    // 保留回退快照
    expect(migrated.previousSnapshot?.formVersionId).toBe(v1.id);
    expect(migrated.previousSnapshot?.answers.some((a) => a.questionKey === 'q_region_statement')).toBe(true);
  });

  it('部分迁移：只迁移选中的旧题，未选中的答案保持原样且草稿仍停留在旧版', () => {
    const { v1, v2, state, draft } = setup();
    const d = draft('draft-android-us');
    // 只迁移 q_collect / q_ads / q_tracking，不处理拆分题
    const pv = previewOf(d, v1, v2, state.plans, ['q_collect', 'q_ads', 'q_tracking']);
    expect(pv.migrations.map((m) => m.fromKey).sort()).toEqual(['q_ads', 'q_collect', 'q_tracking']);
    expect(pv.blocked).toBe(false);

    const migrated = applyDraftMigration(d, v2, pv, NOW);
    // 未选中的旧答案原样保留（包括新版已不存在的孤儿题 key）
    const oldStmt = migrated.answers.find((a) => a.questionKey === 'q_region_statement');
    expect(oldStmt?.text).toContain('Analytics');
    // 被迁移的题更新到新版基准
    expect(migrated.answers.find((a) => a.questionKey === 'q_collect')?.basedOn).toContain(v2.id);
  });

  it('已删选项的答案给出警告并自动剔除，不阻断迁移', () => {
    const state0 = buildSampleState(NOW);
    const v1 = state0.versions.find((v) => v.id === 'form-v1-2025')!;
    const v2 = state0.versions.find((v) => v.id === 'form-v2-2026')!;
    // 构造：v2 删除 ads_self 选项
    const v2Hard: typeof v2 = {
      ...v2,
      questions: v2.questions.map((q) =>
        q.key === 'q_ads' ? { ...q, options: q.options.filter((o) => o.id !== 'ads_self') } : q,
      ),
    };
    const d = state0.drafts.find((x) => x.id === 'draft-android-cn')!;
    const plans = state0.plans;
    const pv = previewDraftMigration(d, v1, v2Hard, plans, { onlyKeys: ['q_ads'] });
    const m = pv.migrations.find((x) => x.fromKey === 'q_ads')!;
    expect(m.conflicts).toContain('option-removed');
    expect(pv.blocked).toBe(false);
    const migrated = applyDraftMigration(d, v2Hard, pv, NOW);
    expect(migrated.answers.find((a) => a.questionKey === 'q_ads')?.optionIds).toEqual([]);
  });

  it('版本回退恢复迁移前答案与版本', () => {
    const { v1, v2, state, draft } = setup();
    const d = draft('draft-ios-cn');
    const pv = previewOf(d, v1, v2, state.plans);
    const migrated = applyDraftMigration(d, v2, pv, NOW);
    expect(migrated.formVersionId).toBe(v2.id);
    const rolledBack: Draft = {
      ...migrated,
      formVersionId: migrated.previousSnapshot!.formVersionId,
      answers: migrated.previousSnapshot!.answers,
      previousSnapshot: undefined,
    };
    expect(rolledBack.formVersionId).toBe(v1.id);
    expect(rolledBack.answers.some((a) => a.questionKey === 'q_region_statement')).toBe(false);
    expect(rolledBack.answers.find((a) => a.questionKey === 'q_collect')?.optionIds).toEqual(['no']);
  });

  it('非旧版草稿迁移被阻断（版本不匹配）', () => {
    const { v1, v2, state, draft } = setup();
    const d: Draft = { ...draft('draft-android-cn'), formVersionId: 'form-other' };
    const pv = previewDraftMigration(d, v1, v2, state.plans);
    expect(pv.blocked).toBe(true);
  });
});
