import {
  conditionSignature,
  optionsSignature,
  scopeApplies,
  scopeSignature,
} from './conditions';
import { questionFingerprint } from './hash';
import type {
  Draft,
  FormVersion,
  Question,
  QuestionChange,
  VersionDiff,
} from './types';

/**
 * 对比两个表单版本：
 * - 新题通过 splitFrom 声明由哪道旧题拆出（1 -> N 记为 split）
 * - 同 key 题目按 选项 / 条件 / 范围 / 文案 逐级归类
 */
export function diffVersions(from: FormVersion, to: FormVersion): VersionDiff {
  const oldByKey = new Map(from.questions.map((q) => [q.key, q]));
  const newByKey = new Map(to.questions.map((q) => [q.key, q]));
  const changes: QuestionChange[] = [];

  for (const oldQ of from.questions) {
    const splitKids = to.questions.filter((q) => q.splitFrom === oldQ.key);
    if (splitKids.length > 0) {
      changes.push({
        kind: 'split',
        previous: oldQ,
        splitInto: splitKids,
      });
      continue;
    }
    const newQ = newByKey.get(oldQ.key);
    if (!newQ) {
      changes.push({ kind: 'removed', previous: oldQ });
      continue;
    }
    changes.push(compareQuestion(oldQ, newQ));
  }

  // 新增题：同 key 不存在，且不是某道旧题的拆分子题
  for (const newQ of to.questions) {
    if (oldByKey.has(newQ.key)) continue;
    if (newQ.splitFrom && oldByKey.has(newQ.splitFrom)) continue;
    changes.push({ kind: 'added', question: newQ });
  }

  const affectedKeys = new Set<string>();
  for (const c of changes) {
    if (c.kind === 'unchanged') continue;
    if (c.previous) affectedKeys.add(c.previous.key);
    c.splitInto?.forEach((q) => affectedKeys.add(q.key));
    if (c.question) affectedKeys.add(c.question.key);
  }

  return {
    fromVersionId: from.id,
    toVersionId: to.id,
    changes,
    affectedKeys: [...affectedKeys],
  };
}

function compareQuestion(oldQ: Question, newQ: Question): QuestionChange {
  const oldOpt = optionsSignature(oldQ);
  const newOpt = optionsSignature(newQ);
  if (oldOpt !== newOpt) {
    const oldIds = new Set(oldQ.options.map((o) => o.id));
    const newIds = new Set(newQ.options.map((o) => o.id));
    return {
      kind: 'options-changed',
      previous: oldQ,
      question: newQ,
      options: {
        added: newQ.options.filter((o) => !oldIds.has(o.id)).map((o) => o.id),
        removed: oldQ.options.filter((o) => !newIds.has(o.id)).map((o) => o.id),
      },
    };
  }
  if (conditionSignature(oldQ) !== conditionSignature(newQ)) {
    return { kind: 'condition-changed', previous: oldQ, question: newQ };
  }
  if (scopeSignature(oldQ.scope) !== scopeSignature(newQ.scope)) {
    return { kind: 'scope-changed', previous: oldQ, question: newQ };
  }
  if (questionFingerprint(oldQ) !== questionFingerprint(newQ)) {
    return { kind: 'modified', previous: oldQ, question: newQ };
  }
  return { kind: 'unchanged', previous: oldQ, question: newQ };
}

export interface DraftImpact {
  draftId: string;
  items: { key: string; kind: QuestionChange['kind']; reason: string }[];
}

/**
 * 版本变化会影响哪些草稿：
 * 结合草稿平台/地区范围、现有答案与选项删除情况判断，而不是全量标红。
 */
export function impactedDrafts(
  diff: VersionDiff,
  drafts: Draft[],
): DraftImpact[] {
  const result: DraftImpact[] = [];
  for (const draft of drafts) {
    const items: DraftImpact['items'] = [];
    for (const c of diff.changes) {
      if (c.kind === 'unchanged') continue;
      const oldQ = c.previous;
      const newQ = c.question ?? c.splitInto?.[0];
      const ans = oldQ
        ? draft.answers.find((a) => a.questionKey === oldQ.key)
        : undefined;

      switch (c.kind) {
        case 'added':
          if (newQ && scopeApplies(newQ.scope, draft.platform, draft.region)) {
            items.push({ key: newQ.key, kind: c.kind, reason: '新增题，范围适用，需要作答' });
          }
          break;
        case 'removed':
        case 'split':
          if (ans) {
            items.push({
              key: oldQ!.key,
              kind: c.kind,
              reason: c.kind === 'split' ? '旧题已拆分为多道条件题，需指明答案去向' : '题目移除，旧答案需要处理',
            });
          }
          break;
        case 'options-changed':
          if (ans && c.options) {
            const hit = ans.optionIds.filter((id) => c.options!.removed.includes(id));
            if (hit.length) {
              items.push({ key: oldQ!.key, kind: c.kind, reason: `已选选项 ${hit.join(', ')} 在新版被删除` });
            }
          }
          break;
        case 'condition-changed':
          if (newQ && scopeApplies(newQ.scope, draft.platform, draft.region)) {
            items.push({ key: newQ.key, kind: c.kind, reason: '条件分支调整，可见性可能变化' });
          }
          break;
        case 'scope-changed':
          if (
            (oldQ && scopeApplies(oldQ.scope, draft.platform, draft.region)) ||
            (newQ && scopeApplies(newQ.scope, draft.platform, draft.region))
          ) {
            items.push({ key: oldQ!.key, kind: c.kind, reason: '平台/地区适用范围调整' });
          }
          break;
        case 'modified':
          if (ans) items.push({ key: oldQ!.key, kind: c.kind, reason: '题面文案变化，建议复核' });
          break;
      }
    }
    if (items.length) result.push({ draftId: draft.id, items });
  }
  return result;
}
