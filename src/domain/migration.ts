import { isEmptyValue, isQuestionVisible } from './forms'
import type {
  Answer,
  AnswerConflict,
  AnswerValue,
  CarriedAnswer,
  Draft,
  DroppedAnswer,
  FormVersion,
  MigrationReport,
  Question,
  RemappedAnswer,
} from './types'

/** 一道旧题的答案去向安排 */
export interface QuestionMapping {
  fromQuestionId: string
  /** carry：沿用（含替换题）；split：拆分，主答案进 targets[0]；drop：移除归档 */
  action: 'carry' | 'split' | 'drop'
  targets: string[]
  splitInto: string[]
  /** 旧选项/布尔值 -> 新选项 id（布尔目标用 'true'/'false'） */
  optionRemap: Record<string, string>
}

export interface MigrationPlan {
  id: string
  fromVersionId: string
  toVersionId: string
  createdAt: number
  mappings: QuestionMapping[]
}

function isChoice(t: Question['type']): boolean {
  return t === 'single' || t === 'multi'
}

/** 默认选项映射：同 id / 同文案优先；布尔与单选之间用常识启发式，用户可在界面上改 */
export function defaultRemap(source: Question, target: Question): Record<string, string> {
  const remap: Record<string, string> = {}
  if (isChoice(source.type) && isChoice(target.type)) {
    for (const o of source.options) {
      const byId = target.options.find(t => t.id === o.id)
      const byLabel = target.options.find(t => t.label === o.label)
      if (byId) remap[o.id] = byId.id
      else if (byLabel) remap[o.id] = byLabel.id
    }
  } else if (source.type === 'boolean' && isChoice(target.type)) {
    if (target.options.length > 0) remap['false'] = target.options[0].id
    if (target.options.length > 1) remap['true'] = target.options[1].id
  } else if (isChoice(source.type) && target.type === 'boolean') {
    for (const o of source.options) {
      // 精确匹配否定含义的 id（避免 anonymous 命中 no），或文案含否定词
      const negative = /^(none|never|no|off|false)$/i.test(o.id) || /不|无|否/.test(o.label)
      remap[o.id] = negative ? 'false' : 'true'
    }
  }
  return remap
}

/** 拆分后接收主答案的新题：优先布尔门槛题，其次同类型，最后第一题 */
function pickPrimary(source: Question, children: Question[]): Question | undefined {
  return (
    children.find(c => c.type === 'boolean') ??
    children.find(c => c.type === source.type) ??
    children[0]
  )
}

/** 根据两个版本自动推导迁移计划；界面可在此基础上调整映射 */
export function buildMigrationPlan(
  from: FormVersion,
  to: FormVersion,
  id: string,
  createdAt: number,
): MigrationPlan {
  const toById = new Map(to.questions.map(q => [q.id, q]))
  const mappings: QuestionMapping[] = []
  for (const sq of from.questions) {
    const splitChildren = to.questions.filter(q => q.splitFrom === sq.id)
    if (splitChildren.length > 0) {
      const primary = pickPrimary(sq, splitChildren)
      mappings.push({
        fromQuestionId: sq.id,
        action: 'split',
        targets: primary ? [primary.id] : [],
        splitInto: splitChildren.map(c => c.id),
        optionRemap: primary ? defaultRemap(sq, primary) : {},
      })
      continue
    }
    const replacer = to.questions.find(q => q.replaces === sq.id)
    if (replacer) {
      mappings.push({
        fromQuestionId: sq.id,
        action: 'carry',
        targets: [replacer.id],
        splitInto: [],
        optionRemap: defaultRemap(sq, replacer),
      })
      continue
    }
    const same = toById.get(sq.id)
    if (same) {
      mappings.push({
        fromQuestionId: sq.id,
        action: 'carry',
        targets: [same.id],
        splitInto: [],
        optionRemap: defaultRemap(sq, same),
      })
      continue
    }
    mappings.push({ fromQuestionId: sq.id, action: 'drop', targets: [], splitInto: [], optionRemap: {} })
  }
  return { id, fromVersionId: from.id, toVersionId: to.id, createdAt, mappings }
}

type MapResult = { ok: true; value: AnswerValue; changed: boolean } | { ok: false; reason: string }

/** 把一份旧答案按映射表换算到新题；无法换算时返回冲突原因 */
export function mapValue(
  source: Question,
  target: Question,
  value: AnswerValue,
  remap: Record<string, string>,
): MapResult {
  const fail = (reason: string): MapResult => ({ ok: false, reason })
  if (target.type === 'text') {
    return typeof value === 'string' ? { ok: true, value, changed: false } : fail('目标为文本题，原答案类型不兼容')
  }
  if (target.type === 'boolean') {
    if (typeof value === 'boolean') return { ok: true, value, changed: false }
    if (typeof value === 'string') {
      const to = remap[value]
      if (to === 'true' || to === 'false') return { ok: true, value: to === 'true', changed: true }
      return fail(`选项「${value}」没有映射到 是/否`)
    }
    return fail('原答案类型不兼容')
  }
  const mapOne = (v: string): MapResult => {
    if (Object.prototype.hasOwnProperty.call(remap, v)) {
      const to = remap[v]
      if (target.options.some(o => o.id === to)) return { ok: true, value: to, changed: to !== v }
      return fail(`选项「${v}」映射的目标「${to}」不存在`)
    }
    if (target.options.some(o => o.id === v)) return { ok: true, value: v, changed: false }
    return fail(`选项「${v}」在新版本中已不存在`)
  }
  if (target.type === 'single') {
    const s = typeof value === 'boolean' ? String(value) : typeof value === 'string' ? value : undefined
    if (s === undefined) return fail('原答案类型不兼容')
    return mapOne(s)
  }
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : undefined
  if (!arr) return fail('原答案类型不兼容')
  const out: string[] = []
  let changed = false
  for (const v of arr) {
    const r = mapOne(v)
    if (!r.ok) return r
    out.push(r.value as string)
    if (r.changed) changed = true
  }
  return { ok: true, value: out, changed }
}

export interface DraftMigrationPreview {
  draftId: string
  carried: CarriedAnswer[]
  remapped: RemappedAnswer[]
  conflicts: AnswerConflict[]
  dropped: DroppedAnswer[]
  missing: string[]
}

interface MigrationComputation {
  preview: DraftMigrationPreview
  newAnswers: Record<string, AnswerValue>
}

function computeMigration(
  plan: MigrationPlan,
  draft: Draft,
  from: FormVersion,
  to: FormVersion,
): MigrationComputation {
  const fromById = new Map(from.questions.map(q => [q.id, q]))
  const toById = new Map(to.questions.map(q => [q.id, q]))
  const carried: CarriedAnswer[] = []
  const remapped: RemappedAnswer[] = []
  const conflicts: AnswerConflict[] = []
  const dropped: DroppedAnswer[] = []
  const newAnswers: Record<string, AnswerValue> = {}

  for (const m of plan.mappings) {
    const source = fromById.get(m.fromQuestionId)
    if (!source) continue
    const ans: Answer | undefined = draft.answers[m.fromQuestionId]
    const value = ans?.value
    const has = value !== undefined && !isEmptyValue(value)

    if (m.action === 'drop') {
      if (has) dropped.push({ questionId: source.id, value: value!, reason: '新版本已移除该问题，答案归档保留' })
      continue
    }
    const target = m.targets.length > 0 ? toById.get(m.targets[0]) : undefined
    if (!target) {
      if (has) {
        dropped.push({
          questionId: source.id,
          value: value!,
          reason: m.action === 'split' ? '拆分后未指定接收答案的新题' : '没有可用的目标问题',
        })
      }
      continue
    }
    if (!has) continue
    const mapped = mapValue(source, target, value!, m.optionRemap)
    if (!mapped.ok) {
      conflicts.push({ questionId: source.id, value: value!, reason: mapped.reason })
      continue
    }
    newAnswers[target.id] = mapped.value
    if (mapped.changed) {
      remapped.push({ fromQuestionId: source.id, toQuestionId: target.id, fromValue: value!, toValue: mapped.value })
    } else {
      carried.push({ fromQuestionId: source.id, toQuestionId: target.id, value: mapped.value })
    }
  }

  const ctx = { platform: draft.platform, region: draft.region, answers: newAnswers }
  const missing = to.questions
    .filter(q => q.required && isQuestionVisible(q, ctx) && isEmptyValue(newAnswers[q.id]))
    .map(q => q.id)
  return { preview: { draftId: draft.id, carried, remapped, conflicts, dropped, missing }, newAnswers }
}

/** 迁移预览：不动草稿，只说明这份草稿的答案会去哪里、哪里有冲突、哪里要补 */
export function previewMigration(
  plan: MigrationPlan,
  draft: Draft,
  from: FormVersion,
  to: FormVersion,
): DraftMigrationPreview {
  return computeMigration(plan, draft, from, to).preview
}

/** 应用迁移：生成新版本草稿，旧答案全部归档进迁移记录 */
export function applyMigrationToDraft(
  plan: MigrationPlan,
  draft: Draft,
  from: FormVersion,
  to: FormVersion,
  at: number,
): Draft {
  const { preview, newAnswers } = computeMigration(plan, draft, from, to)
  const answers: Record<string, Answer> = {}
  for (const [qid, value] of Object.entries(newAnswers)) {
    answers[qid] = { questionId: qid, value, source: 'migrated', updatedAt: at }
  }
  const report: MigrationReport = {
    fromVersionId: plan.fromVersionId,
    toVersionId: plan.toVersionId,
    at,
    carried: preview.carried,
    remapped: preview.remapped,
    conflicts: preview.conflicts,
    dropped: preview.dropped,
    missing: preview.missing,
    archived: { ...draft.answers },
  }
  return { ...draft, formVersionId: plan.toVersionId, answers, updatedAt: at, lastMigration: report }
}
