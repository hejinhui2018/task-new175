import type { AssetKind } from './types'

export const PLATFORMS = [
  { id: 'android', label: 'Android' },
  { id: 'ios', label: 'iOS' },
] as const

export const REGIONS = [
  { id: 'US', label: '美国' },
  { id: 'EU', label: '欧盟' },
  { id: 'KR', label: '韩国' },
] as const

export function platformLabel(id: string): string {
  return PLATFORMS.find(p => p.id === id)?.label ?? id
}

export function regionLabel(id: string): string {
  return REGIONS.find(r => r.id === id)?.label ?? id
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  icon: '图标',
  screenshot: '截图',
  video: '视频',
}

/** 素材检查要求每份草稿至少具备的素材类型 */
export const REQUIRED_ASSET_KINDS: AssetKind[] = ['icon', 'screenshot']
