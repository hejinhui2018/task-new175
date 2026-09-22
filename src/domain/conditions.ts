import type {
  Answer,
  Condition,
  Draft,
  Platform,
  Question,
  RegionScope,
} from './types';

export function scopeApplies(scope: RegionScope, platform: Platform, region: string): boolean {
  const platformOk = scope.platforms.includes(platform);
  const regionOk =
    scope.regions.includes('*') || scope.regions.includes(region);
  return platformOk && regionOk;
}

/** 取草稿某题当前答案（按 questionKey） */
export function findAnswer(draft: Draft, questionKey: string): Answer | undefined {
  return draft.answers.find((a) => a.questionKey === questionKey);
}

/**
 * 判断条件是否满足：
 * - 被依赖题的答案 optionIds 中包含条件 optionId（单选等于 / 多选包含）
 * - 文本题无条件选项，条件恒不满足（题目配置错误时安全隐藏）
 */
export function conditionMet(
  condition: Condition,
  answers: Answer[],
  questions: Question[],
): boolean {
  const dep = questions.find((q) => q.key === condition.questionId);
  if (!dep) return false;
  const ans = answers.find((a) => a.questionKey === condition.questionId);
  if (!ans) return false;
  if (dep.type === 'text') return (ans.text ?? '').trim().length > 0;
  return ans.optionIds.includes(condition.optionId);
}

/** 题目对该草稿是否可见：范围适用且所有条件满足 */
export function isQuestionVisible(
  q: Question,
  draft: Draft,
  questions: Question[],
): boolean {
  if (!scopeApplies(q.scope, draft.platform, draft.region)) return false;
  return q.conditions.every((c) => conditionMet(c, draft.answers, questions));
}

/** 条件依赖的题 key 集合（用于 diff 判断条件调整） */
export function conditionSignature(q: Question): string {
  return q.conditions
    .map((c) => `${c.questionId}=${c.optionId}`)
    .sort()
    .join('&');
}

export function scopeSignature(s: RegionScope): string {
  return `${[...s.platforms].sort().join(',')}|${[...s.regions].sort().join(',')}`;
}

/** 选项签名：id 集合（选项增删影响答案有效性） */
export function optionsSignature(q: Question): string {
  return q.options.map((o) => o.id).sort().join(',');
}
