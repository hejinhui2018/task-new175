import type { Answer, AssetRef, Draft, Question } from './types';

// 轻量稳定哈希（FNV-1a 32 位 + 两段种子），无需 crypto 即可在浏览器/测试里运行。
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1e35a7bd;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 5) | (c >> 11)), 0x85ebca77) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/** 题目内容指纹：结构 + 文案 + 选项 + 条件 + 范围 */
export function questionFingerprint(q: Question): string {
  return hashString(
    JSON.stringify({
      key: q.key,
      title: q.title,
      type: q.type,
      options: q.options.map((o) => `${o.id}:${o.label}`),
      conditions: q.conditions.map((c) => `${c.questionId}:${c.optionId}`),
      scope: q.scope,
    }),
  );
}

/** 单题作答证据：题目指纹 + 答案值 + 该题引用素材的指纹 */
export function answerEvidence(q: Question | undefined, a: Answer | undefined, assets: AssetRef[]): string {
  const referencedAssetIds = new Set(
    a && a.source.kind === 'asset' && a.source.ref ? [a.source.ref] : [],
  );
  const assetFps = assets
    .filter((asset) => referencedAssetIds.has(asset.id))
    .map((asset) => asset.fingerprint)
    .sort()
    .join(',');
  return hashString(
    JSON.stringify({
      q: q ? questionFingerprint(q) : null,
      a: a
        ? { o: [...a.optionIds].sort(), t: a.text ?? '', s: a.source }
        : null,
      assets: assetFps,
    }),
  );
}

/** 草稿整包当前证据（题 key -> 证据哈希），用于与冻结批次对照 */
export function draftEvidenceMap(
  draft: Draft,
  questions: Question[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const q of questions) {
    const a = draft.answers.find((ans) => ans.questionKey === q.key);
    if (a) map[q.key] = answerEvidence(q, a, draft.assets);
  }
  return map;
}

export function assetFingerprintMap(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of draft.assets) out[a.id] = a.fingerprint;
  return out;
}
