import type { SearchImage } from './sources'

export type AtlasVersion = {
  cols: number
  rows: number
  layers: number
  tileWidth: number
  tileHeight: number
}

type Layer = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

const loadBitmap = async (src: string, signal?: AbortSignal) => {
  if (src.startsWith('data:')) {
    const img = new Image()
    img.src = src
    await img.decode()
    return img
  }
  const res = await fetch(src, { signal, mode: 'cors' })
  if (!res.ok) throw new Error(`image ${res.status}`)
  return createImageBitmap(await res.blob())
}

/**
 * Builds the texture atlases (one canvas per media version and layer) from a
 * list of search images. Tile t shows image t % images.length, so a small
 * result set still fills the whole grid.
 */
export class Atlas {
  layers: Layer[][]
  capacity: number

  constructor(public versions: AtlasVersion[]) {
    this.layers = versions.map((v) =>
      Array.from({ length: v.layers }, () => {
        const canvas = document.createElement('canvas')
        canvas.width = v.cols * v.tileWidth
        canvas.height = v.rows * v.tileHeight
        const ctx = canvas.getContext('2d', { alpha: false })!
        ctx.imageSmoothingQuality = 'high'
        return { canvas, ctx }
      }),
    )
    const v0 = versions[0]
    this.capacity = v0.cols * v0.rows * v0.layers
  }

  clear(color = '#0b0b0b') {
    this.layers.flat().forEach(({ canvas, ctx }) => {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    })
  }

  private drawTile(
    image: CanvasImageSource & { width: number; height: number },
    tile: number,
  ) {
    this.versions.forEach((v, vi) => {
      const perLayer = v.cols * v.rows
      const layer = Math.floor(tile / perLayer) % v.layers
      const idx = tile % perLayer
      const col = idx % v.cols
      const row = Math.floor(idx / v.cols)
      const { ctx } = this.layers[vi][layer]
      // cover crop
      const iw = image.width
      const ih = image.height
      const target = v.tileWidth / v.tileHeight
      let sw = iw
      let sh = ih
      if (iw / ih > target) sw = ih * target
      else sh = iw / target
      const sx = (iw - sw) / 2
      const sy = (ih - sh) / 2
      ctx.drawImage(
        image,
        sx,
        sy,
        sw,
        sh,
        col * v.tileWidth,
        row * v.tileHeight,
        v.tileWidth,
        v.tileHeight,
      )
    })
  }

  /**
   * Loads every image and draws it in all of its tiles. Calls onUpdate (throttled)
   * whenever the canvases changed so they can be uploaded to the GPU.
   */
  async fill(
    images: SearchImage[],
    {
      signal,
      onUpdate,
      concurrency = 10,
    }: {
      signal?: AbortSignal
      onUpdate?: (loaded: number, total: number) => void
      concurrency?: number
    } = {},
  ) {
    const n = images.length
    if (!n) return 0
    let next = 0
    let loaded = 0
    let dirty = false
    const flush = () => {
      if (!dirty || signal?.aborted) return
      dirty = false
      onUpdate?.(loaded, n)
    }
    const timer = setInterval(flush, 250)

    const worker = async () => {
      while (next < n && !signal?.aborted) {
        const i = next++
        try {
          const img = images[i]
          const bmp = await loadBitmap(img.thumb, signal).catch((e) => {
            if (!img.fallback || signal?.aborted) throw e
            return loadBitmap(img.fallback, signal)
          })
          if (signal?.aborted) return
          for (let t = i; t < this.capacity; t += n) this.drawTile(bmp, t)
          if ('close' in bmp) bmp.close()
          loaded++
          dirty = true
        } catch (e) {
          if (signal?.aborted) return
          console.warn('image failed', images[i].thumb, e)
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: concurrency }, worker))
    } finally {
      clearInterval(timer)
    }
    flush()
    return loaded
  }
}
