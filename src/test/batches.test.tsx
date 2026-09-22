import { describe, expect, it } from 'vitest';
import { buildSampleState } from '../domain/seed';
import {
  deriveStatus,
  freezeBatch,
  recomputeStale,
  recordReviewResult,
  releaseBatch,
  resetIdSequenceForTest,
} from '../domain/batches';
import type { CheckType, Draft, FormVersion, SubmissionBatch } from '../domain/types';

const NOW = 1_758_000_000_000;

function setup() {
  resetIdSequenceForTest();
  const state = buildSampleState(NOW);
  const versionsById = new Map(state.versions.map((v) => [v.id, v]));
  const draftsById = new Map(state.drafts.map((d) => [d.id, d]));
  return { state, versionsById, draftsById };
}

const CHECKS: CheckType[] = ['completeness', 'content-review', 'asset-check'];

function passAll(
  batches: SubmissionBatch[],
  draftsById: Map<string, Draft>,
  versionsById: Map<string, FormVersion>,
  batch: SubmissionBatch,
  receivedAt: number,
): SubmissionBatch[] {
  let cur = batches;
  for (const item of batch.items) {
    for (const type of CHECKS) {
      const out = recordReviewResult(cur, draftsById, versionsById, {
        batchId: batch.id,
        draftId: item.draftId,
        type,
        result: 'pass',
        reviewer: 'r',
        submittedAt: receivedAt - 1000,
        receivedAt,
      });
      expect(out.event.accepted).toBe(true);
      cur = out.batches;
    }
  }
  return cur;
}

describe('提交批次冻结', () => {
  it('冻结时快照表单版本、逐题答案证据与素材指纹', () => {
    const { state, versionsById } = setup();
    const d = state.drafts[0];
    const batch = freezeBatch('批次1', [d], versionsById, NOW);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].formVersionId).toBe(d.formVersionId);
    expect(Object.keys(batch.items[0].answerEvidence).length).toBeGreaterThan(0);
    expect(Object.keys(batch.items[0].assetFingerprints).sort()).toEqual(
      d.assets.map((a) => a.id).sort(),
    );
    expect(batch.status).toBe('frozen');
  });
});

describe('检查过期：只让相关检查过期，旧批次保留证据', () => {
  it('答案变化只使完整性/内容复核过期，素材检查仍有效', () => {
    const { state, versionsById, draftsById } = setup();
    const d = state.drafts[0];
    let batch = freezeBatch('批次1', [d], versionsById, NOW);
    let batches = passAll([batch], draftsById, versionsById, batch, NOW + 1000);
    batch = batches[0];
    expect(deriveStatus(batch)).toBe('releasable');

    // 改答案
    const changedDraft: Draft = {
      ...d,
      answers: d.answers.map((a) =>
        a.questionKey === 'q_ads' ? { ...a, optionIds: ['ads_thirdparty'] } : a,
      ),
    };
    draftsById.set(d.id, changedDraft);
    const refreshed = recomputeStale(batch, draftsById, versionsById);
    const staleTypes = refreshed.checks[d.id].filter((c) => c.stale).map((c) => c.type).sort();
    expect(staleTypes).toEqual(['completeness', 'content-review']);
    expect(deriveStatus(refreshed)).toBe('frozen');
    // 旧证据仍保留在冻结项里
    expect(Object.keys(refreshed.items[0].answerEvidence).length).toBeGreaterThan(0);
  });

  it('素材替换只使素材检查过期', () => {
    const { state, versionsById, draftsById } = setup();
    const d = state.drafts[0];
    const batch0 = freezeBatch('批次1', [d], versionsById, NOW);
    let batches = passAll([batch0], draftsById, versionsById, batch0, NOW + 1000);

    const changedDraft: Draft = {
      ...d,
      assets: d.assets.map((a) => (a.id === d.assets[0].id ? { ...a, fingerprint: `${a.fingerprint}~new` } : a)),
    };
    draftsById.set(d.id, changedDraft);
    const refreshed = recomputeStale(batches[0], draftsById, versionsById);
    const staleTypes = refreshed.checks[d.id].filter((c) => c.stale).map((c) => c.type);
    expect(staleTypes).toEqual(['asset-check']);
    expect(deriveStatus(refreshed)).toBe('frozen');
  });
});

describe('迟到与重复审核结果不能放行', () => {
  it('批次发布后迟到的结果被拒收，批次保持已发布', () => {
    const { state, versionsById, draftsById } = setup();
    const d = state.drafts[0];
    const batch0 = freezeBatch('批次1', [d], versionsById, NOW);
    let batches = passAll([batch0], draftsById, versionsById, batch0, NOW + 1000);
    batches = releaseBatch(batches, batch0.id, NOW + 2000);
    expect(batches[0].status).toBe('released');

    const out = recordReviewResult(batches, draftsById, versionsById, {
      batchId: batch0.id,
      draftId: d.id,
      type: 'content-review',
      result: 'pass',
      reviewer: 'late',
      submittedAt: NOW + 500,
      receivedAt: NOW + 3000,
    });
    expect(out.event.accepted).toBe(false);
    expect(out.event.reason).toContain('迟到');
    expect(out.batches[0].status).toBe('released');
  });

  it('素材替换后到达的旧素材检查结果按证据过期拒收，不会让批次可发布', () => {
    const { state, versionsById, draftsById } = setup();
    const d = state.drafts[0];
    const batch = freezeBatch('批次1', [d], versionsById, NOW);
    // 完整性、内容复核已通过，只差素材检查
    let batches = recordReviewResult([batch], draftsById, versionsById, {
      batchId: batch.id, draftId: d.id, type: 'completeness', result: 'pass', reviewer: 'r',
      submittedAt: NOW + 100, receivedAt: NOW + 200,
    }).batches;
    batches = recordReviewResult(batches, draftsById, versionsById, {
      batchId: batch.id, draftId: d.id, type: 'content-review', result: 'pass', reviewer: 'r',
      submittedAt: NOW + 100, receivedAt: NOW + 200,
    }).batches;

    // 资料包刚改过：素材被替换（模拟“刚改过的资料包显示成可发布”的风险）
    draftsById.set(d.id, {
      ...d,
      assets: d.assets.map((a) => ({ ...a, fingerprint: `${a.fingerprint}~replaced` })),
    });
    // 更早提交、现在才到的素材检查 pass —— 针对旧素材，不得放行
    const late = recordReviewResult(batches, draftsById, versionsById, {
      batchId: batch.id, draftId: d.id, type: 'asset-check', result: 'pass', reviewer: 'slow',
      submittedAt: NOW + 150, receivedAt: NOW + 5000,
    });
    expect(late.event.accepted).toBe(false);
    expect(late.event.reason).toContain('过期');
    const refreshed = recomputeStale(late.batches[0], draftsById, versionsById);
    expect(deriveStatus(refreshed)).toBe('frozen');
  });

  it('同类型同结论的重复结果被拒收', () => {
    const { state, versionsById, draftsById } = setup();
    const d = state.drafts[0];
    const batch = freezeBatch('批次1', [d], versionsById, NOW);
    const first = recordReviewResult([batch], draftsById, versionsById, {
      batchId: batch.id, draftId: d.id, type: 'completeness', result: 'pass', reviewer: 'r',
      submittedAt: NOW, receivedAt: NOW + 10,
    });
    expect(first.event.accepted).toBe(true);
    const dup = recordReviewResult(first.batches, draftsById, versionsById, {
      batchId: batch.id, draftId: d.id, type: 'completeness', result: 'pass', reviewer: 'r2',
      submittedAt: NOW + 20, receivedAt: NOW + 30,
    });
    expect(dup.event.accepted).toBe(false);
    expect(dup.event.reason).toContain('重复');
    // 不通过的更正结果可以覆盖
    const correction = recordReviewResult(dup.batches, draftsById, versionsById, {
      batchId: batch.id, draftId: d.id, type: 'completeness', result: 'fail', reviewer: 'r3',
      submittedAt: NOW + 40, receivedAt: NOW + 50,
    });
    expect(correction.event.accepted).toBe(true);
    expect(correction.batches[0].checks[d.id].find((c) => c.type === 'completeness')?.result).toBe('fail');
  });

  it('多份草稿必须三类检查全部通过才可放行', () => {
    const { state, versionsById, draftsById } = setup();
    const [d1, d2] = state.drafts;
    const batch0 = freezeBatch('多地区批次', [d1, d2], versionsById, NOW);
    let batches = passAll([batch0], draftsById, versionsById, batch0, NOW + 100);
    // passAll 覆盖两份草稿
    expect(deriveStatus(batches[0])).toBe('releasable');
    batches = releaseBatch(batches, batch0.id, NOW + 200);
    expect(batches[0].status).toBe('released');
    expect(batches[0].decidedAt).toBe(NOW + 200);
  });
});
