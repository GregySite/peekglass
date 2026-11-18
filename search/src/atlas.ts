import type { SearchImage } from './sources'

export type AtlasVersion = {
  cols: number
  rows: number
  layers: number
  tileWidth: number
  tileHeight: number
}

export type TileSink = {
  /** replace a whole layer (used to clear) */
  layer: (versionIndex: number, layer: number, source: TexImageSource) => void
  /** replace one tile region */
  tile: (
    versionIndex: number,
    layer: number,
    x: number,
    y: number,
    width: number,
    height: number,
    source: TexImageSource,
  ) => void
}

const decode = (src: string, signal?: AbortSignal) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const abort = () => {
      img.src = ''
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    img.onload = () => {
      signal?.removeEventListener('abort', abort)
      img.decode().then(() => resolve(img), () => resolve(img))
    }
    img.onerror = () => {
      signal?.removeEventListener('abort', abort)
      reject(new Error(`image failed: ${src.slice(0, 80)}`))
    }
    img.src = src
  })

/**
 * Feeds the GPU texture arrays tile by tile: each image is decoded once
 * (async), cropped/resized into one small canvas per resolution, then uploaded
 * only into its own tile regions (no full-atlas re-uploads). Tile t shows image t % n, so a small
 * result set still fills the whole wall.
 */
export class Atlas {
  capacity: number
  private blanks: HTMLCanvasElement[] = []

  constructor(
    public versions: AtlasVersion[],
    private sink: TileSink,
  ) {
    const v0 = versions[0]
    this.capacity = v0.cols * v0.rows * v0.layers
  }

  clear(color = '#0b0b0b') {
    this.versions.forEach((v, vi) => {
      let blank = this.blanks[vi]
      if (!blank) {
        blank = document.createElement('canvas')
        blank.width = v.cols * v.tileWidth
        blank.height = v.rows * v.tileHeight
        const ctx = blank.getContext('2d')!
        ctx.fillStyle = color
        ctx.fillRect(0, 0, blank.width, blank.height)
        this.blanks[vi] = blank
      }
      for (let l = 0; l < v.layers; l++) this.sink.layer(vi, l, blank)
    })
  }

  private tilesFor(img: HTMLImageElement) {
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    return this.versions.map((v) => {
      const target = v.tileWidth / v.tileHeight
      let sw = iw
      let sh = ih
      if (iw / ih > target) sw = ih * target
      else sh = iw / target
      const c = document.createElement('canvas')
      c.width = v.tileWidth
      c.height = v.tileHeight
      const ctx = c.getContext('2d', { alpha: false })!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(
        img,
        (iw - sw) / 2,
        (ih - sh) / 2,
        sw,
        sh,
        0,
        0,
        v.tileWidth,
        v.tileHeight,
      )
      return c
    })
  }

  private place(tiles: HTMLCanvasElement[], tile: number) {
    this.versions.forEach((v, vi) => {
      const perLayer = v.cols * v.rows
      const layer = Math.floor(tile / perLayer) % v.layers
      const idx = tile % perLayer
      this.sink.tile(
        vi,
        layer,
        (idx % v.cols) * v.tileWidth,
        Math.floor(idx / v.cols) * v.tileHeight,
        v.tileWidth,
        v.tileHeight,
        tiles[vi],
      )
    })
  }

  /**
   * Which image goes in which tile: results in rank order fill the tiles from
   * the centre of the screen outward (the centre subgrid = first layer), and
   * repeat if there are fewer images than tiles.
   */
  arrange(images: SearchImage[]): SearchImage[] {
    const n = images.length
    const v = this.versions[0]
    const perLayer = v.cols * v.rows
    const cx = (v.cols - 1) / 2
    const cy = (v.rows - 1) / 2
    const order = Array.from({ length: this.capacity }, (_, t) => t).sort(
      (a, b) => this.tileRank(a, perLayer, cx, cy) - this.tileRank(b, perLayer, cx, cy),
    )
    const tiles: SearchImage[] = new Array(this.capacity)
    order.forEach((t, k) => {
      tiles[t] = images[k % n]
    })
    return tiles
  }

  private tileRank(t: number, perLayer: number, cx: number, cy: number) {
    const v = this.versions[0]
    const layer = Math.floor(t / perLayer)
    const idx = t % perLayer
    // cells are 2:3, so a row step is 1.5× a column step
    const dx = (idx % v.cols) - cx
    const dy = (Math.floor(idx / v.cols) - cy) * 1.5
    return layer * 1e6 + dx * dx + dy * dy
  }

  /**
   * Loads every image of `tiles` (as returned by arrange) once, in rank order
   * (centre first), and uploads it into all of its tiles.
   */
  async fill(
    tiles: SearchImage[],
    {
      signal,
      onProgress,
      concurrency = 16,
    }: {
      signal?: AbortSignal
      onProgress?: (loaded: number, total: number) => void
      concurrency?: number
    } = {},
  ) {
    // unique images, each with its tiles, ordered by their best tile rank
    const byImage = new Map<SearchImage, number[]>()
    const v = this.versions[0]
    const perLayer = v.cols * v.rows
    const cx = (v.cols - 1) / 2
    const cy = (v.rows - 1) / 2
    tiles
      .map((img, t) => ({ img, t, r: this.tileRank(t, perLayer, cx, cy) }))
      .sort((a, b) => a.r - b.r)
      .forEach(({ img, t }) => {
        if (!img) return
        const list = byImage.get(img)
        if (list) list.push(t)
        else byImage.set(img, [t])
      })
    const queue = [...byImage.entries()]
    const n = queue.length
    if (!n) return 0
    let next = 0
    let loaded = 0

    const worker = async () => {
      while (next < n && !signal?.aborted) {
        const [img, tileList] = queue[next++]
        try {
          const bmp = await decode(img.thumb, signal).catch((e) => {
            if (!img.fallback || signal?.aborted) throw e
            return decode(img.fallback, signal)
          })
          if (signal?.aborted) return
          const tileCanvases = this.tilesFor(bmp)
          tileList.forEach((t) => this.place(tileCanvases, t))
          loaded++
          onProgress?.(loaded, n)
        } catch (e) {
          if (signal?.aborted) return
          console.warn('image failed', img.thumb, e)
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    return loaded
  }
}
