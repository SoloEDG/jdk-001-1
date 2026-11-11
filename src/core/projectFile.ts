import {
  CANVAS_SIZES,
  DEFAULT_FRAME_DELAY_MS,
  MAX_FRAMES,
  MAX_LAYERS,
  MAX_RECENT_COLORS,
} from './constants'
import { createProjectId } from './projectFactory'
import type { CanvasSize, Frame, Layer, Pixel, PixelProject } from './types'

/**
 * 项目文件格式
 * ----------
 * v1：首版导出格式，project 中没有 frameDelayMs / recentColors / customColors。
 * v2：当前格式，补齐帧间隔与调色板数据。
 */
export const PROJECT_FILE_TYPE = 'jdk-001-pixel-project'
export const PROJECT_FILE_VERSION = 2
export const PROJECT_FILE_EXTENSION = '.pixel.json'

interface ProjectFileV2 {
  type: typeof PROJECT_FILE_TYPE
  version: typeof PROJECT_FILE_VERSION
  exportedAt: number
  project: PixelProject
}

export type ParseProjectFileResult =
  | { ok: true; project: PixelProject }
  | { ok: false; error: string }

class ProjectFileError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------- 导出 ----------

export function serializeProjectFile(project: PixelProject): string {
  const file: ProjectFileV2 = {
    type: PROJECT_FILE_TYPE,
    version: PROJECT_FILE_VERSION,
    exportedAt: Date.now(),
    project,
  }
  return JSON.stringify(file, null, 2)
}

export function projectFileName(projectName: string): string {
  const safe = projectName.replace(/[^\w一-龥-]+/g, '_').replace(/^_+|_+$/g, '') || '像素项目'
  return `${safe}${PROJECT_FILE_EXTENSION}`
}

export function downloadProjectFile(project: PixelProject): void {
  const blob = new Blob([serializeProjectFile(project)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = projectFileName(project.name)
  a.click()
  URL.revokeObjectURL(url)
}

// ---------- 导入：解析 + 校验 + 迁移 ----------

export function parseProjectFile(text: string): ParseProjectFileResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件已损坏：不是有效的 JSON 内容' }
  }

  if (!isRecord(raw)) {
    return { ok: false, error: '文件已损坏：缺少项目数据' }
  }
  if (raw.type !== PROJECT_FILE_TYPE) {
    return { ok: false, error: '这不是像素编辑器导出的项目文件' }
  }

  const version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: '文件已损坏：缺少有效的格式版本号' }
  }
  if (version > PROJECT_FILE_VERSION) {
    return {
      ok: false,
      error: `文件由更新版本的应用导出（文件版本 v${version}，当前最高支持 v${PROJECT_FILE_VERSION}），请升级后再导入`,
    }
  }

  const migrated = version === 1 ? migrateV1toV2(raw.project) : raw.project

  try {
    return { ok: true, project: normalizeProject(migrated) }
  } catch (e) {
    if (e instanceof ProjectFileError) {
      return { ok: false, error: `文件内容损坏：${e.message}` }
    }
    return { ok: false, error: '文件内容损坏：无法识别的项目数据' }
  }
}

/** v1 没有帧间隔与调色板数据，迁移时补上默认值（文件中已有的字段优先）。 */
function migrateV1toV2(project: unknown): unknown {
  if (!isRecord(project)) return project
  return {
    frameDelayMs: DEFAULT_FRAME_DELAY_MS,
    recentColors: [],
    customColors: [],
    ...project,
  }
}

// ---------- 字段级校验 / 规范化 ----------

let importIdCounter = 0

function takeId(raw: unknown, prefix: string, used: Set<string>): string {
  if (typeof raw === 'string' && raw && !used.has(raw)) {
    used.add(raw)
    return raw
  }
  importIdCounter += 1
  let id = `${prefix}-import-${Date.now()}-${importIdCounter}`
  while (used.has(id)) {
    importIdCounter += 1
    id = `${prefix}-import-${Date.now()}-${importIdCounter}`
  }
  used.add(id)
  return id
}

function normalizeName(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
}

function normalizePixels(raw: unknown, size: CanvasSize, label: string): Pixel[] {
  if (!Array.isArray(raw)) {
    throw new ProjectFileError(`${label}缺少像素数据`)
  }
  const expected = size * size
  if (raw.length !== expected) {
    throw new ProjectFileError(`${label}的像素数量与画布尺寸 ${size}×${size} 不符`)
  }
  return raw.map((p): Pixel => {
    if (p === null) return null
    if (typeof p === 'string') return p || null
    throw new ProjectFileError(`${label}包含无效的像素值`)
  })
}

function normalizeLayer(
  raw: unknown,
  index: number,
  size: CanvasSize,
  usedIds: Set<string>,
): Layer {
  const label = `第 ${index + 1} 个图层`
  if (!isRecord(raw)) throw new ProjectFileError(`${label}数据无效`)
  return {
    id: takeId(raw.id, 'layer', usedIds),
    name: normalizeName(raw.name, `图层 ${index + 1}`),
    visible: raw.visible !== false,
    pixels: normalizePixels(raw.pixels, size, label),
  }
}

function normalizeFrame(
  raw: unknown,
  index: number,
  size: CanvasSize,
  usedIds: Set<string>,
): Frame {
  const label = `第 ${index + 1} 帧`
  if (!isRecord(raw)) throw new ProjectFileError(`${label}数据无效`)
  if (!Array.isArray(raw.layers) || raw.layers.length === 0) {
    throw new ProjectFileError(`${label}缺少图层数据`)
  }
  if (raw.layers.length > MAX_LAYERS) {
    throw new ProjectFileError(`${label}的图层数量超出上限（最多 ${MAX_LAYERS} 层）`)
  }
  return {
    id: takeId(raw.id, 'frame', usedIds),
    name: normalizeName(raw.name, `帧 ${index + 1}`),
    layers: raw.layers.map((l, i) => normalizeLayer(l, i, size, usedIds)),
  }
}

function normalizeColorList(raw: unknown, max?: number): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of raw) {
    if (typeof c !== 'string' || !c.trim()) continue
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
    if (max !== undefined && out.length >= max) break
  }
  return out
}

function clampIndex(raw: unknown, length: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.min(Math.max(Math.trunc(raw), 0), length - 1)
}

function normalizeFrameDelay(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_FRAME_DELAY_MS
  return Math.max(50, Math.min(5000, Math.round(raw)))
}

function normalizeProject(raw: unknown): PixelProject {
  if (!isRecord(raw)) throw new ProjectFileError('缺少项目数据')

  const canvasSize = raw.canvasSize as CanvasSize
  if (!CANVAS_SIZES.includes(canvasSize)) {
    throw new ProjectFileError('画布尺寸无效')
  }

  if (!Array.isArray(raw.frames) || raw.frames.length === 0) {
    throw new ProjectFileError('缺少动画帧数据')
  }
  if (raw.frames.length > MAX_FRAMES) {
    throw new ProjectFileError(`帧数量超出上限（最多 ${MAX_FRAMES} 帧）`)
  }

  const usedIds = new Set<string>()
  const frames = raw.frames.map((f, i) => normalizeFrame(f, i, canvasSize, usedIds))
  const activeFrameIndex = clampIndex(raw.activeFrameIndex, frames.length)
  const activeLayerCount = frames[activeFrameIndex]!.layers.length

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createProjectId(),
    name: normalizeName(raw.name, '导入项目'),
    canvasSize,
    frames,
    activeFrameIndex,
    activeLayerIndex: clampIndex(raw.activeLayerIndex, activeLayerCount),
    frameDelayMs: normalizeFrameDelay(raw.frameDelayMs),
    recentColors: normalizeColorList(raw.recentColors, MAX_RECENT_COLORS),
    customColors: normalizeColorList(raw.customColors),
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
  }
}

// ---------- 导入策略 ----------

/** 与现有项目同名时生成「名称 (2)」「名称 (3)」……，避免覆盖旧数据。 */
export function dedupeProjectName(name: string, existingNames: string[]): string {
  const taken = new Set(existingNames)
  if (!taken.has(name)) return name
  let i = 2
  while (taken.has(`${name} (${i})`)) i += 1
  return `${name} (${i})`
}
