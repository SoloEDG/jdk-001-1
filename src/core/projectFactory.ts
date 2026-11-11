import { DEFAULT_FRAME_DELAY_MS, PRESET_COLORS } from './constants'
import { defaultFrames } from './frameFactory'
import type { CanvasSize, PixelProject } from './types'

let projectCounter = 0

export function createProjectId(): string {
  projectCounter += 1
  return `project-${Date.now()}-${projectCounter}`
}

export function createProject(name: string, canvasSize: CanvasSize = 16): PixelProject {
  const now = Date.now()
  return {
    id: createProjectId(),
    name,
    canvasSize,
    frames: defaultFrames(canvasSize),
    activeFrameIndex: 0,
    activeLayerIndex: 0,
    frameDelayMs: DEFAULT_FRAME_DELAY_MS,
    recentColors: [],
    customColors: [],
    updatedAt: now,
  }
}

export function defaultActiveColor(): string {
  return PRESET_COLORS[0]!
}
