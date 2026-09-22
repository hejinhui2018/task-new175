import { assetFingerprintMap, draftEvidenceMap, hashString } from './hash';
import type {
  BatchItem,
  CheckRecord,
  CheckType,
  Draft,
  FormVersion,
  ReviewResultEvent,
  SubmissionBatch,
} from './types';

let seq = 0;
export function resetIdSequenceForTest(n = 0): void {
  seq = n;
}
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}_${(seq * 2654435761 >>> 0).toString(16)}`;
}

export function newBatchId(): string {
  return uid('batch');
}
export function newEventId(): string {
  return uid('rev');
}

const ALL_CHECKS: CheckType[] = ['completeness', 'content-review', 'asset-check'];

export function checkEvidence(
  type: CheckType,
  answerEvidence: Record<string, string>,
  assetFingerprints: Record<string, string>,
): string {
  return type === 'asset-check'
    ? hashString(JSON.stringify(assetFingerprints))
    : hashString(JSON.stringify(answerEvidence));
}

/**
 * 冻结一组平台/地区资料为提交批次：快照每份草稿当时的表单版本、
 * 逐题答案证据与素材指纹。之后草稿再变也不影响批次证据。
 */
export function freezeBatch(
  label: string,
  drafts: Draft[],
  versionsById: Map<string, FormVersion>,
  now: number,
): SubmissionBatch {
  const items: BatchItem[] = drafts.map((d) => {
    const v = versionsById.get(d.formVersionId);
    const questions = v?.questions ?? [];
    return {
      draftId: d.id,
      platform: d.platform,
      region: d.region,
      formVersionId: d.formVersionId,
      answerEvidence: draftEvidenceMap(d, questions),
      assetFingerprints: assetFingerprintMap(d),
    };
  });
  return {
    id: newBatchId(),
    label,
    createdAt: now,
    items,
    checks: Object.fromEntries(drafts.map((d) => [d.id, []])),
    status: 'frozen',
  };
}

/**
 * 重算批次内所有检查的过期状态（不改变证据本身）：
 * 表单题目/答案变化只让 completeness、content-review 过期；
 * 素材替换只让 asset-check 过期。
 */
export function recomputeStale(
  batch: SubmissionBatch,
  draftsById: Map<string, Draft>,
  versionsById: Map<string, FormVersion>,
): SubmissionBatch {
  const checks: Record<string, CheckRecord[]> = {};
  for (const item of batch.items) {
    const draft = draftsById.get(item.draftId);
    const list = batch.checks[item.draftId] ?? [];
    if (!draft) {
      checks[item.draftId] = list.map((c) => ({ ...c, stale: true }));
      continue;
    }
    const v = versionsById.get(draft.formVersionId);
    const liveAnswers = draftEvidenceMap(draft, v?.questions ?? []);
    const liveAssets = assetFingerprintMap(draft);
    checks[item.draftId] = list.map((c) => {
      const liveHash = checkEvidence(c.type, liveAnswers, liveAssets);
      const frozenHash = checkEvidence(c.type, item.answerEvidence, item.assetFingerprints);
      return { ...c, stale: liveHash !== frozenHash };
    });
  }
  return { ...batch, checks, status: deriveStatus({ ...batch, checks }) };
}

export function isCheckLive(check: CheckRecord): boolean {
  return !check.stale;
}

/** 只有每份草稿的三类检查全部 pass 且未过期，批次才可放行 */
export function deriveStatus(batch: SubmissionBatch): SubmissionBatch['status'] {
  if (batch.status === 'released') return 'released';
  for (const item of batch.items) {
    const list = batch.checks[item.draftId] ?? [];
    const livePass = new Set(
      list.filter((c) => c.result === 'pass' && isCheckLive(c)).map((c) => c.type),
    );
    if (!ALL_CHECKS.every((t) => livePass.has(t))) return 'frozen';
  }
  return 'releasable';
}

export interface RecordReviewInput {
  batchId: string;
  draftId: string;
  type: CheckType;
  result: Exclude<CheckRecord['result'], 'pending'>;
  reviewer: string;
  submittedAt: number;
  receivedAt: number;
}

export interface RecordReviewOutcome {
  batches: SubmissionBatch[];
  event: ReviewResultEvent;
}

/**
 * 登记一条审核结果：
 * - 批次已发布        → 迟到，拒收（不能翻案/影响新批次）
 * - 批次证据已过期    → 迟到于旧证据，仅记录为过期，不计入放行
 * - 同类型同结论重复 → 重复，拒收
 * 只有命中冻结中批次、且与当前证据一致的新结果才计入检查。
 */
export function recordReviewResult(
  batches: SubmissionBatch[],
  draftsById: Map<string, Draft>,
  versionsById: Map<string, FormVersion>,
  input: RecordReviewInput,
): RecordReviewOutcome {
  const eventBase = {
    id: newEventId(),
    batchId: input.batchId,
    draftId: input.draftId,
    type: input.type,
    result: input.result,
    reviewer: input.reviewer,
    submittedAt: input.submittedAt,
    receivedAt: input.receivedAt,
  };

  const batch = batches.find((b) => b.id === input.batchId);
  const reject = (reason: string): RecordReviewOutcome => ({
    batches,
    event: { ...eventBase, accepted: false, reason },
  });

  if (!batch) return reject('批次不存在');
  const item = batch.items.find((i) => i.draftId === input.draftId);
  if (!item) return reject('草稿不在该批次中');

  if (batch.status === 'released') return reject('迟到结果：批次已发布，拒绝放行');

  const draft = draftsById.get(input.draftId);
  const v = draft ? versionsById.get(draft.formVersionId) : undefined;
  const liveAnswers = draft ? draftEvidenceMap(draft, v?.questions ?? []) : {};
  const liveAssets = draft ? assetFingerprintMap(draft) : {};
  const liveHash = checkEvidence(input.type, liveAnswers, liveAssets);
  const frozenHash = checkEvidence(input.type, item.answerEvidence, item.assetFingerprints);
  if (liveHash !== frozenHash) {
    return reject('迟到结果：资料在审核期间已变化，证据过期，请冻结新批次');
  }

  const list = batch.checks[input.draftId] ?? [];
  const existing = list.find((c) => c.type === input.type && isCheckLive(c));
  if (existing && existing.result === input.result) {
    return reject(`重复结果：${input.type} 已存在相同结论`);
  }

  const record: CheckRecord = {
    type: input.type,
    result: input.result,
    evidenceHash: frozenHash,
    checkedAt: input.receivedAt,
    reviewer: input.reviewer,
    stale: false,
  };
  const nextList = existing
    ? list.map((c) => (c === existing ? record : c)) // 不同结论视为更正，覆盖
    : [...list, record];
  const nextBatch: SubmissionBatch = {
    ...batch,
    checks: { ...batch.checks, [input.draftId]: nextList },
  };
  nextBatch.status = deriveStatus(nextBatch);

  return {
    batches: batches.map((b) => (b.id === batch.id ? nextBatch : b)),
    event: { ...eventBase, accepted: true },
  };
}

/** 放行批次（幂等：已发布直接返回） */
export function releaseBatch(batches: SubmissionBatch[], batchId: string, now: number): SubmissionBatch[] {
  return batches.map((b) =>
    b.id === batchId && b.status === 'releasable'
      ? { ...b, status: 'released', decidedAt: now }
      : b,
  );
}
