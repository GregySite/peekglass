// Voroforce integration for the search page.
// Mirrors app/vf/integrations (mode / controls / ticker) without the React store.
import voroforce, { mergeConfigs } from '√/index'
import { isTouchDevice } from '√/utils'
import { THEME } from '@/consts'
import baseConfig from '@/vf/config'
import { VOROFORCE_MODE } from '@/vf/consts'
import mobilePreset from '@/vf/presets/mobile'
import { getVoroforceConfigUniforms } from '@/vf/utils/config'
import {
  type ConfigUniforms,
  handleTransitioningUniforms,
  updateUniformsByMode,
} from '@/vf/utils/uniforms'
import type { VoroforceCell, VoroforceInstance } from '@/vf/types'
import type { AtlasVersion } from './atlas'

export const MEDIA_COLS = 10
export const MEDIA_ROWS = 10
export const MEDIA_LAYERS = 2
export const MEDIA_CAPACITY = MEDIA_COLS * MEDIA_ROWS * MEDIA_LAYERS // 200 tiles

const params = new URLSearchParams(window.location.search)
const mobile = isTouchDevice || window.innerWidth < 768

// low / mid / high resolution versions of the same atlas (the engine picks the
// version per cell depending on how close it is to the pointer)
export const ATLAS_VERSIONS: AtlasVersion[] = [
  { tileWidth: 40, tileHeight: 60 },
  { tileWidth: 100, tileHeight: 150 },
  // sharpest version, used around the pointer / for the selected cell
  mobile ? { tileWidth: 160, tileHeight: 240 } : { tileWidth: 200, tileHeight: 300 },
].map((t) => ({ ...t, cols: MEDIA_COLS, rows: MEDIA_ROWS, layers: MEDIA_LAYERS }))

const mediaConfig = {
  enabled: true,
  baseUrl: '',
  preload: false,
  versions: ATLAS_VERSIONS.map((v) => ({
    cols: v.cols,
    rows: v.rows,
    layers: v.layers,
    width: v.cols * v.tileWidth,
    height: v.rows * v.tileHeight,
    type: 'canvas-grid',
    // layers are uploaded by the app (see uploadLayer), never fetched by the loader
    // (empty string = nothing to load; must stay serialisable for the workers)
    layerSrcFormat: '',
  })),
}

type GridTexture = {
  prepareLayerUpdate: (layer: number, src: TexImageSource) => void
  prepareTileUpdate: (
    layer: number,
    x: number,
    y: number,
    w: number,
    h: number,
    src: TexImageSource,
  ) => void
}

export type Engine = {
  vf: VoroforceInstance
  uploadLayer: (versionIndex: number, layerIndex: number, src: TexImageSource) => void
  uploadTile: (
    versionIndex: number,
    layer: number,
    x: number,
    y: number,
    w: number,
    h: number,
    src: TexImageSource,
  ) => void
  setMode: (mode: VOROFORCE_MODE) => void
  getMode: () => VOROFORCE_MODE
  deselect: () => void
  onFocus: (cb: (cell?: VoroforceCell) => void) => void
  onSelect: (cb: (cell?: VoroforceCell) => void) => void
  shake: () => void
}

export function createEngine(container: HTMLElement): Engine {
  let config = mergeConfigs(baseConfig, mobile ? mobilePreset : {})
  const cellsParam = Number.parseInt(params.get('cells') ?? '')
  config.cells = Number.isFinite(cellsParam)
    ? Math.max(MEDIA_CAPACITY, cellsParam)
    : mobile
      ? 600
      : 1000
  config.media = mediaConfig
  // big cells like the original site after its intro (≈7.5% of the viewport)
  const sizeParam = Number.parseFloat(params.get('size') ?? '')
  config.lattice = {
    ...config.lattice,
    targetCellSizeViewportPercentage: Number.isFinite(sizeParam)
      ? sizeParam / 100
      : mobile
        ? 0.085
        : 0.055,
    autoTargetMediaVersion1SubgridCount: 100,
  }
  // Simulation in Web Workers (like the original site) needs SharedArrayBuffer,
  // i.e. a cross-origin isolated page: coi-serviceworker.js provides it on GitHub Pages.
  // Kept off on mobile, as in the original mobile preset.
  const mt =
    !mobile && self.crossOriginIsolated === true && params.get('mt') !== '0'
  config.multiThreading = {
    enabled: mt,
    renderInParallel: mt,
  }
  config.devTools = { ...config.devTools, enabled: params.has('dev') }
  config.modes = {}

  let mode = VOROFORCE_MODE.preview

  const vf = voroforce(container, config) as VoroforceInstance

  // every layer is "loaded" from the engine's point of view: we upload them ourselves
  const loaded = (
    vf as unknown as {
      sharedLoadedMediaVersionLayersData?: {
        sharedLoadedMediaVersionLayersData?: { data: Uint8Array }[]
      }
    }
  ).sharedLoadedMediaVersionLayersData?.sharedLoadedMediaVersionLayersData
  loaded?.forEach((v) => v.data.fill(2))

  const uniforms = getVoroforceConfigUniforms(config, mode, THEME.dark)
  const mainUniforms: ConfigUniforms = uniforms.main
  const postUniforms: ConfigUniforms = uniforms.post
  const transitioning: ConfigUniforms = uniforms.transitioning

  vf.ticker.listen('tick', (() => {
    handleTransitioningUniforms(transitioning)
  }) as unknown as EventListener)

  const forceStepModeConfigs = config.simulation.forceStepModeConfigs
  const controlsConfig = config.controls
  let afterModeChangeTimeout: ReturnType<typeof setTimeout>

  const setMode = (newMode: VOROFORCE_MODE) => {
    if (newMode === mode) return
    mode = newMode
    vf.controls.updateConfig(
      mergeConfigs(controlsConfig.default, controlsConfig.modes?.[mode]),
    )
    updateUniformsByMode(mainUniforms, mode, transitioning)
    updateUniformsByMode(postUniforms, mode, transitioning)

    const forceStepConfig = forceStepModeConfigs[mode]
    if (forceStepConfig.parameters.velocityDecayTransitionEnterMode) {
      forceStepConfig.parameters.velocityDecay =
        forceStepConfig.parameters.velocityDecayTransitionEnterMode
      vf.simulation.updateForceStepConfig(forceStepConfig)
      clearTimeout(afterModeChangeTimeout)
      afterModeChangeTimeout = setTimeout(() => {
        forceStepConfig.parameters.velocityDecay =
          forceStepConfig.parameters.velocityDecayBase
        vf.simulation.updateForceStepConfigParameters(forceStepConfig.parameters)
      }, forceStepConfig.parameters.transitionEnterModeDuration ?? 2000)
    } else {
      vf.simulation.updateForceStepConfig(forceStepConfig)
    }
  }

  const focusCbs: ((cell?: VoroforceCell) => void)[] = []
  const selectCbs: ((cell?: VoroforceCell) => void)[] = []

  vf.controls.listen('focused', (({ cell }: { cell?: VoroforceCell }) => {
    focusCbs.forEach((cb) => cb(cell))
  }) as unknown as EventListener)

  vf.controls.listen('selected', (({ cell }: { cell?: VoroforceCell }) => {
    setMode(cell ? VOROFORCE_MODE.select : VOROFORCE_MODE.preview)
    selectCbs.forEach((cb) => cb(cell))
  }) as unknown as EventListener)

  vf.controls.listen('pointerFrozenChange', (({ frozen }: { frozen: boolean }) => {
    const key = 'fUnweightedEffectMod'
    const uniform = mainUniforms.get(key)
    if (!uniform) return
    const value =
      [VOROFORCE_MODE.preview, VOROFORCE_MODE.select].includes(mode) && frozen ? 1 : 0
    if (uniform.transition) {
      if (uniform.value !== value) {
        uniform.targetValue = value
        transitioning.set(key, uniform)
      }
    } else {
      uniform.value = value
    }
  }) as unknown as EventListener)

  const textures = () =>
    (vf.display as unknown as { scene: { compressedMediaGridTextures: GridTexture[] } })
      .scene.compressedMediaGridTextures

  return {
    vf,
    uploadLayer: (versionIndex, layerIndex, src) => {
      textures()[versionIndex]?.prepareLayerUpdate(layerIndex, src)
    },
    uploadTile: (versionIndex, layer, x, y, w, h, src) => {
      textures()[versionIndex]?.prepareTileUpdate(layer, x, y, w, h, src)
    },
    setMode,
    getMode: () => mode,
    deselect: () => {
      if (vf.controls.hasSelection?.()) vf.controls.deselect()
    },
    onFocus: (cb) => focusCbs.push(cb),
    onSelect: (cb) => selectCbs.push(cb),
    shake: () => {
      // nudge the pointer toward a random spot near the centre so the
      // diagram re-organises around fresh results
      const width = vf.dimensions.get('width') as number
      const height = vf.dimensions.get('height') as number
      ;(vf.controls as unknown as { targetPointer: { x: number; y: number } }).targetPointer = {
        x: width / 2 + (Math.random() - 0.5) * 0.1 * width,
        y: height / 2 + (Math.random() - 0.5) * 0.1 * height,
      }
    },
  }
}
