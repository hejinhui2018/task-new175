import { stableStringify } from './hash'
import type {
  Answer,
  AnswerValue,
  Draft,
  FormVersion,
  Question,
  QuestionCondition,
  QuestionOption,
} from './types'

export interface VisibilityCtx {
  platform: string
  region: string
  answers: Record<string, AnswerValue | undefined>
}

export function isEmptyValue(v: AnswerValue | undefined | null): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

export function answerValues(answers: Record<string, Answer>): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {}
  for (const [k, a] of Object.entries(answers)) out[k] = a.value
  return out
}

/** 条件分支：平台、地区、父题答案三者同时满足时题目才生效 */
export function isQuestionVisible(q: Question, ctx: VisibilityCtx): boolean {
  const c = q.condition
  if (!c) return true
  if (c.platforms && c.platforms.length > 0 && !c.platforms.includes(ctx.platform)) return false
  if (c.regions && c.regions.length > 0 && !c.regions.includes(ctx.region)) return false
  if (c.dependsOn) {
    const v = ctx.answers[c.dependsOn.questionId]
    const want = c.dependsOn.equals
    if (Array.isArray(v)) return v.includes(want)
    if (typeof v === 'boolean') return String(v) === want
    return v === want
  }
  return true
}

export function visibleQuestions(version: FormVersion, ctx: VisibilityCtx): Question[] {
  return version.questions.filter(q => isQuestionVisible(q, ctx))
}

/** 可见且必填但尚未作答的题目 */
export function missingRequired(version: FormVersion, ctx: VisibilityCtx): Question[] {
  return version.questions.filter(
    q => q.required && isQuestionVisible(q, ctx) && isEmptyValue(ctx.answers[q.id]),
  )
}

// ---------- 版本对比 ----------

export type QuestionChange =
  | { kind: 'added'; question: Question }
  | { kind: 'removed'; question: Question }
  | { kind: 'split'; from: Question; into: Question[] }
  | { kind: 'replaced'; from: Question; to: Question; notes: string[] }
  | {
      kind: 'modified'
      before: Question
      after: Question
      optionsAdded: QuestionOption[]
      optionsRemoved: QuestionOption[]
      conditionChanged: boolean
      typeChanged: boolean
      requiredChanged: boolean
      retitled: boolean
    }

export interface VersionDiff {
  fromVersionId: string
  toVersionId: string
  changes: QuestionChange[]
}

function conditionChanged(a?: QuestionCondition, b?: QuestionCondition): boolean {
  return stableStringify(a ?? null) !== stableStringify(b ?? null)
}

interface QuestionModification {
  optionsAdded: QuestionOption[]
  optionsRemoved: QuestionOption[]
  conditionChanged: boolean
  typeChanged: boolean
  requiredChanged: boolean
  retitled: boolean
}

function compareQuestion(before: Question, after: Question): QuestionModification | null {
  const beforeIds = new Set(before.options.map(o => o.id))
  const afterIds = new Set(after.options.map(o => o.id))
  const mod: QuestionModification = {
    optionsAdded: after.options.filter(o => !beforeIds.has(o.id)),
    optionsRemoved: before.options.filter(o => !afterIds.has(o.id)),
    conditionChanged: conditionChanged(before.condition, after.condition),
    typeChanged: before.type !== after.type,
    requiredChanged: before.required !== after.required,
    retitled: before.title !== after.title,
  }
  const changed =
    mod.optionsAdded.length > 0 ||
    mod.optionsRemoved.length > 0 ||
    mod.conditionChanged ||
    mod.typeChanged ||
    mod.requiredChanged ||
    mod.retitled
  return changed ? mod : null
}

function replaceNotes(from: Question, to: Question): string[] {
  const notes: string[] = []
  if (from.title !== to.title) notes.push('标题调整')
  if (from.type !== to.type) notes.push('类型调整')
  if (conditionChanged(from.condition, to.condition)) notes.push('条件调整')
  const fromIds = new Set(from.options.map(o => o.id))
  const toIds = new Set(to.options.map(o => o.id))
  if (from.options.some(o => !toIds.has(o.id)) || to.options.some(o => !fromIds.has(o.id))) {
    notes.push('选项变化')
  }
  if (from.required !== to.required) notes.push('必填变化')
  return notes.length > 0 ? notes : ['标识替换']
}

export function diffFormVersions(from: FormVersion, to: FormVersion): VersionDiff {
  const changes: QuestionChange[] = []
  const fromById = new Map(from.questions.map(q => [q.id, q]))
  const handled = new Set<string>()

  // 题目拆分：新版本中声明了 splitFrom 的题
  const splitGroups = new Map<string, Question[]>()
  for (const q of to.questions) {
    if (q.splitFrom && fromById.has(q.splitFrom)) {
      const group = splitGroups.get(q.splitFrom) ?? []
      group.push(q)
      splitGroups.set(q.splitFrom, group)
    }
  }
  for (const [fromId, into] of splitGroups) {
    changes.push({ kind: 'split', from: fromById.get(fromId)!, into })
    handled.add(fromId)
  }

  // 替换：新版本中声明了 replaces 的题（标题/条件/类型调整但答案沿用）
  for (const q of to.questions) {
    if (q.replaces && fromById.has(q.replaces) && !handled.has(q.replaces)) {
      const old = fromById.get(q.replaces)!
      changes.push({ kind: 'replaced', from: old, to: q, notes: replaceNotes(old, q) })
      handled.add(q.replaces)
    }
  }

  // 同 id 修改 / 新增
  for (const q of to.questions) {
    if (q.splitFrom && fromById.has(q.splitFrom)) continue
    if (q.replaces && fromById.has(q.replaces)) continue
    const old = fromById.get(q.id)
    if (!old) {
      changes.push({ kind: 'added', question: q })
      continue
    }
    handled.add(q.id)
    const mod = compareQuestion(old, q)
    if (mod) changes.push({ kind: 'modified', before: old, after: q, ...mod })
  }

  // 移除
  for (const q of from.questions) {
    if (handled.has(q.id)) continue
    if (to.questions.some(t => t.id === q.id)) continue
    changes.push({ kind: 'removed', question: q })
  }

  return { fromVersionId: from.id, toVersionId: to.id, changes }
}

// ---------- 影响分析 ----------

export interface DraftImpact {
  draftId: string
  reasons: string[]
}

/** 对比结果会波及哪些草稿：只看仍停留在 from 版本的草稿 */
export function analyzeImpact(diff: VersionDiff, drafts: Draft[]): DraftImpact[] {
  const impacts: DraftImpact[] = []
  for (const d of drafts) {
    if (d.formVersionId !== diff.fromVersionId) continue
    const ctx: VisibilityCtx = { platform: d.platform, region: d.region, answers: answerValues(d.answers) }
    const reasons: string[] = []
    for (const ch of diff.changes) {
      switch (ch.kind) {
        case 'split':
          if (!isEmptyValue(ctx.answers[ch.from.id])) {
            reasons.push(`「${ch.from.title}」拆分为 ${ch.into.length} 道新题，答案需重新分配`)
          }
          break
        case 'removed':
          if (!isEmptyValue(ctx.answers[ch.question.id])) {
            reasons.push(`「${ch.question.title}」被移除，答案将归档`)
          }
          break
        case 'replaced': {
          const had = !isEmptyValue(ctx.answers[ch.from.id])
          const wasVisible = isQuestionVisible(ch.from, ctx)
          const nowVisible = isQuestionVisible(ch.to, ctx)
          if (had) reasons.push(`「${ch.from.title}」调整为「${ch.to.title}」，答案沿用`)
          if (!wasVisible && nowVisible && ch.to.required) {
            reasons.push(`条件调整后「${ch.to.title}」对本资料变为必填`)
          }
          if (wasVisible && !nowVisible && had) {
            reasons.push(`条件调整后「${ch.to.title}」对本资料不再适用`)
          }
          break
        }
        case 'modified': {
          const ans = ctx.answers[ch.before.id]
          if (ch.optionsRemoved.length > 0 && !isEmptyValue(ans)) {
            const used = Array.isArray(ans) ? ans : [ans]
            const hit = ch.optionsRemoved.filter(o => used.includes(o.id))
            if (hit.length > 0) {
              reasons.push(`「${ch.before.title}」的已选选项被移除：${hit.map(o => o.label).join('、')}`)
            }
          }
          if (ch.conditionChanged) {
            const wasVisible = isQuestionVisible(ch.before, ctx)
            const nowVisible = isQuestionVisible(ch.after, ctx)
            if (!wasVisible && nowVisible && ch.after.required) {
              reasons.push(`条件调整后「${ch.after.title}」变为必填`)
            }
            if (wasVisible && !nowVisible) {
              reasons.push(`条件调整后「${ch.after.title}」不再适用`)
            }
          }
          if (!ch.before.required && ch.after.required && isQuestionVisible(ch.after, ctx) && isEmptyValue(ans)) {
            reasons.push(`「${ch.after.title}」变为必填`)
          }
          break
        }
        case 'added':
          if (ch.question.required && isQuestionVisible(ch.question, ctx)) {
            reasons.push(`新增必填「${ch.question.title}」`)
          }
          break
      }
    }
    if (reasons.length > 0) impacts.push({ draftId: d.id, reasons })
  }
  return impacts
}
