export type PlatformId = string
export type RegionId = string

export type QuestionType = 'single' | 'multi' | 'boolean' | 'text'

export type AnswerValue = string | string[] | boolean

export type AnswerSource = 'manual' | 'imported' | 'migrated' | 'inherited'

export interface QuestionOption {
  id: string
  label: string
}

/** 题目生效条件：平台 / 地区 / 依赖另一题的答案 */
export interface QuestionCondition {
  platforms?: PlatformId[]
  regions?: RegionId[]
  dependsOn?: {
    questionId: string
    /** 选项 id；布尔父题用 'true' / 'false' */
    equals: string
  }
}

export interface Question {
  id: string
  title: string
  type: QuestionType
  required: boolean
  options: QuestionOption[]
  condition?: QuestionCondition
  /** 本题由上一版本的哪道题拆分而来 */
  splitFrom?: string
  /** 本题替换了上一版本的哪道题（改标题 / 改条件 / 改类型但沿用答案） */
  replaces?: string
}

export interface FormVersion {
  id: string
  label: string
  note?: string
  createdAt: number
  questions: Question[]
}

export interface Answer {
  questionId: string
  value: AnswerValue
  source: AnswerSource
  updatedAt: number
}

export type AssetKind = 'icon' | 'screenshot' | 'video'

export interface AssetRef {
  id: string
  kind: AssetKind
  label: string
  checksum: string
}

export interface CarriedAnswer {
  fromQuestionId: string
  toQuestionId: string
  value: AnswerValue
}

export interface RemappedAnswer {
  fromQuestionId: string
  toQuestionId: string
  fromValue: AnswerValue
  toValue: AnswerValue
}

export interface AnswerConflict {
  questionId: string
  value: AnswerValue
  reason: string
}

export interface DroppedAnswer {
  questionId: string
  value: AnswerValue
  reason: string
}

/** 一次迁移在某份草稿上留下的完整记录（答案去向的证据） */
export interface MigrationReport {
  fromVersionId: string
  toVersionId: string
  at: number
  carried: CarriedAnswer[]
  remapped: RemappedAnswer[]
  conflicts: AnswerConflict[]
  dropped: DroppedAnswer[]
  /** 迁移后仍缺答案的可见必填题 */
  missing: string[]
  /** 迁移前的全部旧答案，归档保留 */
  archived: Record<string, Answer>
}

export interface Draft {
  id: string
  appId: string
  appName: string
  platform: PlatformId
  region: RegionId
  formVersionId: string
  answers: Record<string, Answer>
  assets: AssetRef[]
  updatedAt: number
  lastMigration?: MigrationReport
}

export type CheckKind = 'completeness' | 'content-review' | 'asset-check'

export type CheckStatus = 'passed' | 'failed'

/** 一条检查记录：结果 + 当时输入的证据哈希。记录本身永不被改写，只会被新记录替换 */
export interface CheckRecord {
  kind: CheckKind
  status: CheckStatus
  ranAt: number
  evidenceHash: string
  detail: string
}

export interface BatchItem {
  draftId: string
  platform: PlatformId
  region: RegionId
}

export interface AppliedReview {
  resultId: string
  kind: CheckKind
  verdict: 'approved' | 'rejected'
  appliedAt: number
}

/** 冻结的提交批次：保留冻结瞬间的草稿快照作为证据 */
export interface Batch {
  id: string
  label: string
  createdAt: number
  formVersionId: string
  items: BatchItem[]
  snapshot: Record<string, Draft>
  /** 冻结瞬间的指纹，用于识别"迟到"的审核结果 */
  snapshotFingerprint: string
  checks: CheckRecord[]
  appliedReviews: AppliedReview[]
}

/** 外部送达的审核结果；fingerprint 标识它实际复核的是哪一份内容 */
export interface ReviewResult {
  id: string
  batchId: string
  kind: CheckKind
  verdict: 'approved' | 'rejected'
  fingerprint: string
  receivedAt: number
  note?: string
}

export type IngestOutcome = 'applied' | 'late' | 'duplicate' | 'unknown-batch'

export interface ReviewIngestion {
  result: ReviewResult
  outcome: IngestOutcome
  at: number
}

export interface AppState {
  formVersions: FormVersion[]
  currentFormVersionId: string
  drafts: Draft[]
  batches: Batch[]
  reviewLog: ReviewIngestion[]
}
