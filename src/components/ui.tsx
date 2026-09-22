import type { ReactNode } from 'react'
import { platformLabel, regionLabel } from '../domain/constants'
import type { AnswerValue, FormVersion, Question, QuestionType } from '../domain/types'

export { platformLabel, regionLabel }

export const TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选',
  multi: '多选',
  boolean: '是否',
  text: '文本',
}

export const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  imported: '导入',
  migrated: '迁移',
  inherited: '继承',
}

type TagTone = 'green' | 'red' | 'amber' | 'grey' | 'blue' | 'purple'

export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}

export function conditionSummary(q: Question, version?: FormVersion): string {
  const parts: string[] = []
  if (q.condition?.platforms?.length) parts.push(`平台：${q.condition.platforms.map(platformLabel).join('/')}`)
  if (q.condition?.regions?.length) parts.push(`地区：${q.condition.regions.map(regionLabel).join('/')}`)
  if (q.condition?.dependsOn) {
    const dep = q.condition.dependsOn
    const parent = version?.questions.find(p => p.id === dep.questionId)
    parts.push(`依赖：${parent?.title ?? dep.questionId} = ${valueLabel(parent, dep.equals)}`)
  }
  return parts.length > 0 ? parts.join(' · ') : '全部平台与地区'
}

export function valueLabel(q: Question | undefined, v: AnswerValue): string {
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (Array.isArray(v)) return v.map(x => optionLabel(q, x)).join('、')
  return optionLabel(q, v)
}

function optionLabel(q: Question | undefined, id: string): string {
  if (id === 'true') return '是'
  if (id === 'false') return '否'
  return q?.options.find(o => o.id === id)?.label ?? id
}

export function shortHash(h: string): string {
  return h.slice(0, 8)
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
