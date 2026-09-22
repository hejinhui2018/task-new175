// ─────────────────────────────────────────────────────────────
// StoreDraft 核心领域类型
// ─────────────────────────────────────────────────────────────

export type Platform = 'android' | 'ios';

/** 地区维度：草稿/题目可见性与批次冻结的范围 */
export interface RegionScope {
  platforms: Platform[];
  /** ISO 地区码，如 CN、US、EU-DE；'*' 表示全地区 */
  regions: string[];
}

export type QuestionType = 'single' | 'multi' | 'text';

/** 答案来源：手填 / 沿用旧版答案 / 素材派生 */
export type AnswerSourceKind = 'manual' | 'inherited' | 'asset';

export interface AnswerSource {
  kind: AnswerSourceKind;
  /** inherited: 来源旧题目 id；asset: 素材 id；manual: 空 */
  ref?: string;
  note?: string;
}

/** 条件：某题的答案包含（单选等于 / 多选包含）指定选项 */
export interface Condition {
  questionId: string;
  optionId: string;
}

export interface QuestionOption {
  id: string;
  label: string;
}

export interface Question {
  id: string;
  /** 稳定标识，跨版本相同表示同一道题；id 也可复用但 key 用于映射 */
  key: string;
  title: string;
  type: QuestionType;
  options: QuestionOption[];
  /** 显示条件；全部满足才展示（AND）。空数组 = 无条件展示 */
  conditions: Condition[];
  /** 生效范围；不在草稿平台/地区内的题不要求作答 */
  scope: RegionScope;
  source?: AnswerSource;
  /** 本题由旧版哪道题拆出（题目拆分时，多个新题指向同一个旧题 key） */
  splitFrom?: string;
}

export interface FormVersion {
  id: string;
  name: string;
  createdAt: number;
  note?: string;
  questions: Question[];
}

/** 单题答案：single -> [optionId]；multi -> optionId[]；text -> 自由文本 */
export interface Answer {
  questionKey: string;
  optionIds: string[];
  text?: string;
  source: AnswerSource;
  /** 答案最后所依据的题目内容版本（题目 id#内容指纹），用于判断答案是否过期 */
  basedOn: string;
}

export interface AssetRef {
  id: string;
  name: string;
  kind: 'image' | 'doc' | 'video';
  /** 内容指纹：素材替换后指纹变化，旧批次证据仍保留旧指纹 */
  fingerprint: string;
  uri: string;
}

export type DraftStatus = 'draft' | 'in_review' | 'approved' | 'rejected';

export interface Draft {
  id: string;
  appName: string;
  platform: Platform;
  region: string;
  /** 当前作答所依据的表单版本 id */
  formVersionId: string;
  answers: Answer[];
  assets: AssetRef[];
  status: DraftStatus;
  updatedAt: number;
  /** 迁移换版前的快照，用于版本回退 */
  previousSnapshot?: {
    formVersionId: string;
    answers: Answer[];
    migratedAt: number;
  };
}

// ── 版本 diff ────────────────────────────────────────────────

export type QuestionChangeKind =
  | 'added'
  | 'removed'
  | 'split'
  | 'options-changed'
  | 'condition-changed'
  | 'scope-changed'
  | 'modified' // 文案等轻微变化
  | 'unchanged';

export interface OptionChange {
  added: string[];
  removed: string[];
}

export interface QuestionChange {
  kind: QuestionChangeKind;
  /** 当前版本题目（added/变化后存在） */
  question?: Question;
  /** 旧版本题目（removed/变化前存在） */
  previous?: Question;
  /** split: 新表单中由旧题拆出的新题集合 */
  splitInto?: Question[];
  options?: OptionChange;
}

export interface VersionDiff {
  fromVersionId: string;
  toVersionId: string;
  changes: QuestionChange[];
  /** 受影响（需要关注/迁移）的题目 key 集合 */
  affectedKeys: string[];
}

// ── 迁移 ─────────────────────────────────────────────────────

export type AnswerDestination =
  | 'carry' // 原样沿用
  | 'map-option' // 选项映射到新选项
  | 'split' // 拆分到多道新题
  | 'text' // 转成文本题答案
  | 'drop' // 无对应去向，丢弃
  | 'blocked'; // 条件/范围不适用，暂不迁移

export interface AnswerMapping {
  /** 旧题 key */
  fromKey: string;
  destination: AnswerDestination;
  /** 目标题 key（split 时多个） */
  toKeys?: string[];
  /** 选项级映射：旧选项 -> 新题/新选项 */
  optionMap?: Record<string, { questionKey: string; optionId: string }[]>;
  /** split 时每个目标题固定取的选项 */
  fixedAssignments?: Record<string, string[]>;
  note?: string;
}

/** 迁移计划：版本级别的答案去向声明 */
export interface MigrationPlan {
  id: string;
  fromVersionId: string;
  toVersionId: string;
  mappings: AnswerMapping[];
  createdAt: number;
  note?: string;
}

export type ConflictKind =
  | 'option-removed' // 已选选项在新版被删除
  | 'ambiguous-split' // 拆分目标题存在多个候选，无法自动决定
  | 'condition-hidden' // 迁移后答案落在被条件隐藏的题上
  | 'scope-excluded' // 新题不在本草稿平台/地区范围
  | 'already-answered' // 目标题已有人工答案，不能覆盖
  | 'none';

export interface AnswerMigration {
  fromKey: string;
  toKeys: string[];
  destination: AnswerDestination;
  /** 实际要写入目标题的答案预览 */
  preview: { questionKey: string; optionIds: string[]; text?: string }[];
  conflicts: ConflictKind[];
  source: AnswerSource;
  note?: string;
}

export interface DraftMigrationPreview {
  draftId: string;
  migrations: AnswerMigration[];
  /** 因条件不适用而保持原样的旧答案（题目在新版仍存在） */
  untouched: string[];
  /** 新版必填但草稿缺失的题 key */
  missing: string[];
  blocked: boolean;
}

// ── 提交批次 / 审核 ──────────────────────────────────────────

export type CheckType = 'completeness' | 'content-review' | 'asset-check';
export type CheckResultValue = 'pass' | 'fail' | 'pending';

export interface CheckRecord {
  type: CheckType;
  result: CheckResultValue;
  /** 检查时所依据的证据指纹：表单题目内容 + 答案 + 素材指纹的快照哈希 */
  evidenceHash: string;
  checkedAt: number;
  reviewer?: string;
  note?: string;
  /** 动态计算：冻结后表单/答案/素材变化导致该检查证据过期 */
  stale?: boolean;
}

export interface BatchItem {
  draftId: string;
  platform: Platform;
  region: string;
  /** 冻结时的表单版本 id */
  formVersionId: string;
  /** 冻结时逐题证据（questionKey -> 题目内容/答案/素材指纹哈希） */
  answerEvidence: Record<string, string>;
  /** 冻结时的素材指纹快照 */
  assetFingerprints: Record<string, string>;
}

export type BatchStatus = 'frozen' | 'releasable' | 'released' | 'expired';

export interface SubmissionBatch {
  id: string;
  label: string;
  createdAt: number;
  items: BatchItem[];
  checks: Record<string, CheckRecord[]>; // draftId -> checks
  status: BatchStatus;
  /** 发布/拒绝时间 */
  decidedAt?: number;
}

/** 迟到的审核结果：到达时对应批次已决策或证据已过期 */
export interface ReviewResultEvent {
  id: string;
  batchId: string;
  draftId: string;
  type: CheckType;
  result: Exclude<CheckResultValue, 'pending'>;
  reviewer: string;
  submittedAt: number;
  receivedAt: number;
  /** 处理结论 */
  accepted: boolean;
  reason?: string;
}

// ── 撤销重做 ────────────────────────────────────────────────

export interface AppState {
  versions: FormVersion[];
  activeVersionId: string;
  drafts: Draft[];
  plans: MigrationPlan[];
  batches: SubmissionBatch[];
  reviewLog: ReviewResultEvent[];
}
