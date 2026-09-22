import { isQuestionVisible, scopeApplies } from './conditions';
import type {
  Answer,
  AnswerMapping,
  AnswerMigration,
  ConflictKind,
  Draft,
  DraftMigrationPreview,
  FormVersion,
  MigrationPlan,
  Question,
} from './types';

/** 硬冲突：不允许直接写入，必须先人工解决；option-removed 仅为警告（答案自动丢弃已删选项，保留其余） */
export const HARD_CONFLICTS: ConflictKind[] = [
  'ambiguous-split',
  'condition-hidden',
  'scope-excluded',
  'already-answered',
];

export function hasHardConflict(m: AnswerMigration): boolean {
  return m.conflicts.some((c) => HARD_CONFLICTS.includes(c));
}

function findPlan(plans: MigrationPlan[], fromId: string, toId: string): MigrationPlan | undefined {
  return plans.find((p) => p.fromVersionId === fromId && p.toVersionId === toId);
}

function basedOnFor(v: FormVersion, q: Question): string {
  return `${v.id}:${q.key}`;
}

export interface MigrationOptions {
  /** 仅迁移这些旧题 key（部分迁移）；缺省 = 全部 */
  onlyKeys?: string[];
}

/**
 * 为单份草稿生成迁移预览：不修改草稿，只给出每份旧答案的去向、
 * 预览值与冲突，供逐份确认。
 */
export function previewDraftMigration(
  draft: Draft,
  from: FormVersion,
  to: FormVersion,
  plans: MigrationPlan[],
  opts: MigrationOptions = {},
): DraftMigrationPreview {
  const empty: DraftMigrationPreview = {
    draftId: draft.id,
    migrations: [],
    untouched: [],
    missing: [],
    blocked: false,
  };
  if (draft.formVersionId === to.id) return empty;
  if (draft.formVersionId !== from.id) return { ...empty, blocked: true };

  const plan = findPlan(plans, from.id, to.id);
  const newByKey = new Map(to.questions.map((q) => [q.key, q]));

  // 投影：把“必然沿用(carry 且无冲突未知)”的答案先放进新表单答案集，
  // 用于判定条件可见性。未选中的旧题不参与投影。
  const projected: Answer[] = [];
  const migrations: AnswerMigration[] = [];
  const only = opts.onlyKeys ? new Set(opts.onlyKeys) : undefined;

  for (const mapping of plan?.mappings ?? []) {
    if (only && !only.has(mapping.fromKey)) continue;
    const oldAnswer = draft.answers.find((a) => a.questionKey === mapping.fromKey);
    if (!oldAnswer) continue;
    const migration = buildMigration(mapping, oldAnswer, newByKey);
    migrations.push(migration);
    for (const pv of migration.preview) {
      projected.push({
        questionKey: pv.questionKey,
        optionIds: pv.optionIds,
        text: pv.text,
        source: oldAnswer.source,
        basedOn: basedOnFor(to, newByKey.get(pv.questionKey)!),
      });
    }
  }

  // carry 的题 + 未参与迁移的旧答案也要参与条件投影
  for (const a of draft.answers) {
    if (!projected.some((p) => p.questionKey === a.questionKey)) {
      const stillExists = newByKey.has(a.questionKey);
      if (stillExists) {
        projected.push({ ...a, basedOn: basedOnFor(to, newByKey.get(a.questionKey)!) });
      }
    }
  }

  // 条件隐藏 / 范围冲突标注
  for (const m of migrations) {
    for (const pv of m.preview) {
      const q = newByKey.get(pv.questionKey);
      if (!q) continue;
      if (!scopeApplies(q.scope, draft.platform, draft.region)) {
        addConflict(m, 'scope-excluded');
      } else {
        const projectedDraft: Draft = { ...draft, answers: projected };
        if (!isQuestionVisible(q, projectedDraft, to.questions)) {
          addConflict(m, 'condition-hidden');
        }
      }
    }
    // 目标题已有人工答案（常见于二次部分迁移）
    for (const key of m.toKeys) {
      const existing = draft.answers.find((a) => a.questionKey === key);
      if (existing && existing.source.kind === 'manual' && existing.questionKey !== m.fromKey) {
        addConflict(m, 'already-answered');
      }
    }
  }

  const migratedKeys = new Set<string>();
  for (const m of migrations) {
    migratedKeys.add(m.fromKey);
    m.toKeys.forEach((k) => migratedKeys.add(k));
  }
  // 未迁移（未选择/无计划）但旧题在新版仍存在的答案保持原样
  const untouched = draft.answers
    .filter((a) => !migratedKeys.has(a.questionKey) && newByKey.has(a.questionKey))
    .map((a) => a.questionKey);

  // 新版可见但缺失答案的题
  const projectedDraft: Draft = { ...draft, answers: projected };
  const missing = to.questions
    .filter((q) => isQuestionVisible(q, projectedDraft, to.questions))
    .filter((q) => !projected.some((a) => a.questionKey === q.key))
    .map((q) => q.key);

  const blocked = migrations.some((m) => hasHardConflict(m));
  return { draftId: draft.id, migrations, untouched, missing, blocked };
}

function addConflict(m: AnswerMigration, c: ConflictKind): void {
  if (!m.conflicts.includes(c)) m.conflicts.push(c);
}

function buildMigration(
  mapping: AnswerMapping,
  oldAnswer: Answer,
  newByKey: Map<string, Question>,
): AnswerMigration {
  const base: AnswerMigration = {
    fromKey: mapping.fromKey,
    toKeys: mapping.toKeys ?? [mapping.fromKey],
    destination: mapping.destination,
    preview: [],
    conflicts: [],
    source: oldAnswer.source,
    note: mapping.note,
  };

  const addBaseConflict = (c: ConflictKind): void => {
    if (!base.conflicts.includes(c)) base.conflicts.push(c);
  };

  switch (mapping.destination) {
    case 'carry': {
      const q = newByKey.get(mapping.fromKey);
      if (!q) {
        addBaseConflict('option-removed');
        break;
      }
      const valid = new Set(q.options.map((o) => o.id));
      const kept = oldAnswer.optionIds.filter((id) => valid.has(id));
      const lost = oldAnswer.optionIds.filter((id) => !valid.has(id));
      if (lost.length) addBaseConflict('option-removed');
      base.preview = [{ questionKey: mapping.fromKey, optionIds: kept, text: oldAnswer.text }];
      break;
    }
    case 'map-option': {
      const kept: Record<string, Set<string>> = {};
      for (const oldOpt of oldAnswer.optionIds) {
        const targets = mapping.optionMap?.[oldOpt];
        if (!targets || targets.length === 0) {
          addBaseConflict('option-removed');
          continue;
        }
        for (const t of targets) {
          const q = newByKey.get(t.questionKey);
          if (q && !q.options.some((o) => o.id === t.optionId)) {
            addBaseConflict('option-removed');
            continue;
          }
          (kept[t.questionKey] ??= new Set()).add(t.optionId);
        }
      }
      base.preview = Object.entries(kept).map(([questionKey, ids]) => ({
        questionKey,
        optionIds: [...ids],
      }));
      break;
    }
    case 'split': {
      // 1) 选项级映射优先
      if (oldAnswer.optionIds.length && mapping.optionMap) {
        for (const oldOpt of oldAnswer.optionIds) {
          const targets = mapping.optionMap[oldOpt];
          if (!targets) {
            addBaseConflict('option-removed');
            continue;
          }
          if (targets.length > 1) addBaseConflict('ambiguous-split');
          for (const t of targets) {
            base.preview.push({ questionKey: t.questionKey, optionIds: [t.optionId] });
          }
        }
      }
      // 2) 文本题拆到多个地区条件题：文本进文本题，是/否题不预选，
      //    单一声明无法判定各地区选项 → ambiguous-split，需逐份人工确认
      if (oldAnswer.text !== undefined && mapping.toKeys) {
        for (const key of mapping.toKeys) {
          const q = newByKey.get(key);
          if (!q) continue;
          if (q.type === 'text') {
            base.preview.push({ questionKey: key, optionIds: [], text: oldAnswer.text });
          } else {
            // 单一声明无法替用户决定各地区/目的选项：不预选，要求逐题人工确认
            base.preview.push({ questionKey: key, optionIds: mapping.fixedAssignments?.[key] ?? [] });
            addBaseConflict('ambiguous-split');
          }
        }
      }
      // 合并同题预览
      base.preview = mergePreview(base.preview);
      break;
    }
    case 'text': {
      const key = mapping.toKeys?.[0] ?? mapping.fromKey;
      base.preview = [{ questionKey: key, optionIds: [], text: oldAnswer.text ?? '' }];
      break;
    }
    case 'drop':
      base.toKeys = [];
      base.preview = [];
      break;
    case 'blocked':
      base.toKeys = [];
      base.preview = [];
      base.conflicts.push('scope-excluded');
      break;
  }
  if (base.preview.length > 0) {
    base.toKeys = [...new Set(base.preview.map((p) => p.questionKey))];
  }
  return base;
}

function mergePreview(
  previews: AnswerMigration['preview'],
): AnswerMigration['preview'] {
  const map = new Map<string, { questionKey: string; optionIds: string[]; text?: string }>();
  for (const p of previews) {
    const cur = map.get(p.questionKey);
    if (!cur) {
      map.set(p.questionKey, { ...p, optionIds: [...p.optionIds] });
    } else {
      cur.optionIds = [...new Set([...cur.optionIds, ...p.optionIds])];
      if (p.text !== undefined) cur.text = p.text;
    }
  }
  return [...map.values()];
}

export interface MigrationResolutionEntry {
  /** 跳过目标题（范围外或不适用），不写入该题 */
  skipKeys?: string[];
  /** 人工指定目标题答案（解决 ambiguous-split / already-answered / condition-hidden） */
  answers?: { questionKey: string; optionIds?: string[]; text?: string }[];
}
export type MigrationResolutions = Record<string, MigrationResolutionEntry>;

/**
 * 人工解决迁移冲突：逐份草稿确认拆分目标题的选项、跳过范围外题目。
 * 解决后重算范围冲突与缺失题；硬冲突全部消除才可写入。
 */
export function resolvePreview(
  draft: Draft,
  to: FormVersion,
  preview: DraftMigrationPreview,
  resolutions: MigrationResolutions,
): DraftMigrationPreview {
  const newByKey = new Map(to.questions.map((q) => [q.key, q]));
  const migrations = preview.migrations.map((m) => {
    const res = resolutions[m.fromKey];
    if (!res) return m;
    const skip = new Set(res.skipKeys ?? []);
    const overrides = new Map((res.answers ?? []).map((a) => [a.questionKey, a]));
    const nextPreview = m.preview
      .filter((p) => !skip.has(p.questionKey))
      .map((p) => {
        const ov = overrides.get(p.questionKey);
        return ov
          ? {
              questionKey: p.questionKey,
              optionIds: ov.optionIds ?? p.optionIds,
              text: ov.text ?? p.text,
            }
          : p;
      });
    // 覆盖项中原本没有预览的题（例如之前因映射缺失未生成）也加入
    for (const [key, ov] of overrides) {
      if (!skip.has(key) && !nextPreview.some((p) => p.questionKey === key)) {
        nextPreview.push({ questionKey: key, optionIds: ov.optionIds ?? [], text: ov.text });
      }
    }
    const overrideKeys = new Set((res.answers ?? []).map((a) => a.questionKey));
    let conflicts: ConflictKind[] = m.conflicts.filter(
      // 选项删除始终只是警告；其余硬冲突按下面的覆盖情况重新判定
      (c) => c === 'option-removed',
    );
    // 仍按默认建议值落地、未被人工显式确认的选择题目标：歧义未解决
    const unresolvedOptionTargets = nextPreview.filter(
      (p) => !overrideKeys.has(p.questionKey) && newByKey.get(p.questionKey)?.type !== 'text',
    );
    if (m.conflicts.includes('ambiguous-split') && unresolvedOptionTargets.length > 0) {
      conflicts.push('ambiguous-split');
    }
    if (m.conflicts.includes('already-answered') && unresolvedOptionTargets.length > 0) {
      conflicts.push('already-answered');
    }
    for (const pv of nextPreview) {
      const q = newByKey.get(pv.questionKey);
      if (q && !scopeApplies(q.scope, draft.platform, draft.region)) {
        conflicts.push('scope-excluded');
      }
    }
    conflicts = [...new Set(conflicts)];
    return { ...m, preview: nextPreview, toKeys: nextPreview.map((p) => p.questionKey), conflicts };
  });

  // 重算条件可见性冲突 + 缺失题
  const projected: Answer[] = draft.answers
    .filter((a) => !newByKey.has(a.questionKey))
    .map((a) => ({ ...a }));
  for (const m of migrations) {
    for (const a of draft.answers) {
      if (newByKey.has(a.questionKey)) projected.push({ ...a });
    }
    for (const pv of m.preview) {
      projected.push({
        questionKey: pv.questionKey,
        optionIds: pv.optionIds,
        text: pv.text,
        source: m.source,
        basedOn: `${to.id}:${pv.questionKey}`,
      });
    }
  }
  const projectedDraft: Draft = { ...draft, answers: projected };
  for (const m of migrations) {
    for (const pv of m.preview) {
      const q = newByKey.get(pv.questionKey);
      if (q && scopeApplies(q.scope, draft.platform, draft.region) &&
          !isQuestionVisible(q, projectedDraft, to.questions)) {
        if (!m.conflicts.includes('condition-hidden')) m.conflicts.push('condition-hidden');
      }
    }
  }
  const targetKeys = new Set(migrations.flatMap((m) => m.toKeys));
  const consumedOld = new Set(migrations.map((m) => m.fromKey));
  const untouched = draft.answers
    .filter((a) => !consumedOld.has(a.questionKey) && !targetKeys.has(a.questionKey) && newByKey.has(a.questionKey))
    .map((a) => a.questionKey);
  const missing = to.questions
    .filter((q) => isQuestionVisible(q, projectedDraft, to.questions))
    .filter((q) => !projected.some((a) => a.questionKey === q.key))
    .map((q) => q.key);
  const blocked = migrations.some((m) => hasHardConflict(m));
  return { draftId: preview.draftId, migrations, untouched, missing, blocked };
}

export interface AppliedMigration {
  draft: Draft;
  /** 实际写入/更新的题 key */
  appliedKeys: string[];
  /** 未迁移而保留下来的旧版答案 key */
  staleKeys: string[];
}

/**
 * 应用迁移（部分迁移）：只动选中的旧题；未选中的答案与未确认草稿保持原样。
 * 存在硬冲突时拒绝写入，由调用方引导用户先解决冲突。
 */
export function applyDraftMigration(
  draft: Draft,
  to: FormVersion,
  preview: DraftMigrationPreview,
  now: number,
): Draft {
  if (preview.draftId !== draft.id) throw new Error('preview 与草稿不匹配');
  if (preview.blocked) throw new Error('存在未解决的迁移冲突，不能写入该草稿');

  const newByKey = new Map(to.questions.map((q) => [q.key, q]));
  const consumedOldKeys = new Set(preview.migrations.map((m) => m.fromKey));
  const targetKeys = new Set(preview.migrations.flatMap((m) => m.toKeys));

  const snapshot = {
    formVersionId: draft.formVersionId,
    answers: draft.answers.map((a) => ({ ...a, optionIds: [...a.optionIds] })),
    migratedAt: now,
  };

  const answers: Answer[] = [];
  // 保留未参与迁移的答案（包括旧版孤儿答案，UI 标为“未迁移”）
  for (const a of draft.answers) {
    if (consumedOldKeys.has(a.questionKey)) continue;
    if (targetKeys.has(a.questionKey)) continue;
    const q = newByKey.get(a.questionKey);
    answers.push(q
      ? { ...a, basedOn: `${to.id}:${q.key}` }
      : { ...a });
  }
  // 写入迁移结果
  for (const m of preview.migrations) {
    for (const pv of m.preview) {
      const q = newByKey.get(pv.questionKey);
      answers.push({
        questionKey: pv.questionKey,
        optionIds: pv.optionIds,
        text: pv.text,
        source: { ...m.source, kind: m.source.kind === 'manual' ? 'manual' : 'inherited', note: m.source.note ?? m.note },
        basedOn: q ? `${to.id}:${q.key}` : to.id,
      });
    }
  }

  return {
    ...draft,
    previousSnapshot: snapshot,
    formVersionId: to.id,
    answers,
    updatedAt: now,
  };
}
