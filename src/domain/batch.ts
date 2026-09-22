import { REQUIRED_ASSET_KINDS, platformLabel, regionLabel } from './constants'
import { answerValues, missingRequired } from './forms'
import { stableHash } from './hash'
import { clone } from './util'
import type {
  Batch,
  BatchItem,
  CheckKind,
  CheckRecord,
  Draft,
  FormVersion,
  ReviewIngestion,
  ReviewResult,
} from './types'

export const CHECK_KINDS: CheckKind[] = ['completeness', 'content-review', 'asset-check']

export const CHECK_LABELS: Record<CheckKind, string> = {
  completeness: '完整性',
  'content-review': '内容复核',
  'asset-check': '素材检查',
}

function liveDraft(drafts: Draft[], id: string): Draft | undefined {
  return drafts.find(d => d.id === id)
}

/**
 * 每类检查只对与自己相关的输入留证据哈希：
 * 完整性 = 表单题目 + 各草稿答案；内容复核 = 各草稿答案；素材检查 = 各草稿素材。
 * 因此改答案只会让完整性与内容复核过期，改素材只会让素材检查过期。
 */
export function checkInputHash(
  kind: CheckKind,
  batch: Batch,
  drafts: Draft[],
  formVersion: FormVersion,
): string {
  const items = batch.items.map(i => {
    const d = liveDraft(drafts, i.draftId)
    if (kind === 'asset-check') return { draftId: i.draftId, assets: d?.assets ?? null }
    return { draftId: i.draftId, answers: d?.answers ?? null, formVersionId: d?.formVersionId ?? null }
  })
  const payload = kind === 'completeness' ? { form: formVersion.questions, items } : { items }
  return stableHash(payload)
}

export function runCheck(
  kind: CheckKind,
  batch: Batch,
  drafts: Draft[],
  formVersion: FormVersion,
  at: number,
): CheckRecord {
  const evidenceHash = checkInputHash(kind, batch, drafts, formVersion)
  const problems: string[] = []
  if (kind === 'completeness') {
    for (const i of batch.items) {
      const d = liveDraft(drafts, i.draftId)
      if (!d) {
        problems.push(`${platformLabel(i.platform)}/${regionLabel(i.region)} 草稿不存在`)
        continue
      }
      const where = `${d.appName} ${platformLabel(d.platform)}/${regionLabel(d.region)}`
      if (d.formVersionId !== formVersion.id) {
        problems.push(`${where} 的表单版本已变化，与批次不一致`)
      }
      const missing = missingRequired(formVersion, {
        platform: d.platform,
        region: d.region,
        answers: answerValues(d.answers),
      })
      for (const q of missing) problems.push(`${where} 缺少必填「${q.title}」`)
    }
  } else if (kind === 'content-review') {
    for (const i of batch.items) {
      const d = liveDraft(drafts, i.draftId)
      if (!d) continue
      const where = `${d.appName} ${platformLabel(d.platform)}/${regionLabel(d.region)}`
      for (const q of formVersion.questions) {
        const a = d.answers[q.id]
        if (a && typeof a.value === 'string' && /TODO|TBD|待定|占位|placeholder/i.test(a.value)) {
          problems.push(`${where}「${q.title}」含有占位文本`)
        }
      }
    }
  } else {
    for (const i of batch.items) {
      const d = liveDraft(drafts, i.draftId)
      if (!d) continue
      const where = `${d.appName} ${platformLabel(d.platform)}/${regionLabel(d.region)}`
      for (const need of REQUIRED_ASSET_KINDS) {
        if (!d.assets.some(a => a.kind === need && a.checksum)) problems.push(`${where} 缺少素材「${need}」`)
      }
    }
  }
  return {
    kind,
    status: problems.length > 0 ? 'failed' : 'passed',
    ranAt: at,
    evidenceHash,
    detail: problems.length > 0 ? problems.join('；') : '通过',
  }
}

/** 批次当前指纹：标识"现在这批内容是什么"，审核结果凭它认内容 */
export function currentFingerprint(batch: Batch, drafts: Draft[]): string {
  return stableHash({
    formVersionId: batch.formVersionId,
    items: batch.items.map(i => {
      const d = liveDraft(drafts, i.draftId)
      return d ? { answers: d.answers, assets: d.assets, formVersionId: d.formVersionId } : null
    }),
  })
}

/** 冻结一组平台/地区资料为提交批次，并立即运行三类检查 */
export function freezeBatch(
  id: string,
  label: string,
  draftIds: string[],
  drafts: Draft[],
  formVersion: FormVersion,
  at: number,
): Batch {
  const items: BatchItem[] = draftIds.map(did => {
    const d = drafts.find(x => x.id === did)
    return { draftId: did, platform: d?.platform ?? '?', region: d?.region ?? '?' }
  })
  const snapshot: Record<string, Draft> = {}
  for (const did of draftIds) {
    const d = drafts.find(x => x.id === did)
    if (d) snapshot[did] = clone(d)
  }
  const batch: Batch = {
    id,
    label,
    createdAt: at,
    formVersionId: formVersion.id,
    items,
    snapshot,
    snapshotFingerprint: '',
    checks: [],
    appliedReviews: [],
  }
  batch.snapshotFingerprint = currentFingerprint(batch, drafts)
  batch.checks = CHECK_KINDS.map(k => runCheck(k, batch, drafts, formVersion, at))
  return batch
}

export interface CheckState extends CheckRecord {
  /** 证据哈希与当前输入不一致 => 该检查已过期（旧记录仍保留为证据） */
  stale: boolean
}

export function checkStates(batch: Batch, drafts: Draft[], formVersion: FormVersion): CheckState[] {
  return batch.checks.map(c => ({
    ...c,
    stale: c.evidenceHash !== checkInputHash(c.kind, batch, drafts, formVersion),
  }))
}

/** 可发布 = 三类检查都通过且都没有过期 */
export function isReleasable(batch: Batch, drafts: Draft[], formVersion: FormVersion): boolean {
  const states = checkStates(batch, drafts, formVersion)
  return CHECK_KINDS.every(k => states.some(s => s.kind === k && s.status === 'passed' && !s.stale))
}

/** 针对当前内容重新运行某类检查，新记录替换旧记录 */
export function rerunCheck(
  batch: Batch,
  kind: CheckKind,
  drafts: Draft[],
  formVersion: FormVersion,
  at: number,
): Batch {
  const rec = runCheck(kind, batch, drafts, formVersion, at)
  return { ...batch, checks: [...batch.checks.filter(c => c.kind !== kind), rec] }
}

/**
 * 接收审核结果。迟到（指纹与当前内容不符）或重复的结果只记录不采纳，
 * 绝不会因此放行批次；结果按 batchId 寻址，不会误伤其他批次。
 */
export function ingestReviewResult(
  batches: Batch[],
  result: ReviewResult,
  drafts: Draft[],
  formVersions: FormVersion[],
  log: ReviewIngestion[],
  at: number,
): { batches: Batch[]; entry: ReviewIngestion } {
  const batch = batches.find(b => b.id === result.batchId)
  if (!batch) return { batches, entry: { result, outcome: 'unknown-batch', at } }

  if (log.some(l => l.result.id === result.id) || batch.appliedReviews.some(r => r.kind === result.kind)) {
    return { batches, entry: { result, outcome: 'duplicate', at } }
  }

  if (result.fingerprint !== currentFingerprint(batch, drafts)) {
    return { batches, entry: { result, outcome: 'late', at } }
  }

  const version = formVersions.find(v => v.id === batch.formVersionId)
  const rec: CheckRecord = {
    kind: result.kind,
    status: result.verdict === 'approved' ? 'passed' : 'failed',
    ranAt: result.receivedAt,
    evidenceHash: version
      ? checkInputHash(result.kind, batch, drafts, version)
      : result.fingerprint,
    detail: `审核${result.verdict === 'approved' ? '通过' : '驳回'}（结果 ${result.id}）`,
  }
  const nextBatch: Batch = {
    ...batch,
    checks: [...batch.checks.filter(c => c.kind !== result.kind), rec],
    appliedReviews: [
      ...batch.appliedReviews,
      { resultId: result.id, kind: result.kind, verdict: result.verdict, appliedAt: at },
    ],
  }
  return { batches: batches.map(b => (b.id === batch.id ? nextBatch : b)), entry: { result, outcome: 'applied', at } }
}
