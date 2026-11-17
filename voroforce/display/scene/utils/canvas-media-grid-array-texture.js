import { Texture } from 'ogl'

/**
 * Uncompressed RGBA8 grid texture array, filled at runtime from any
 * TexImageSource (canvas, ImageBitmap, image...). Used for dynamic media
 * (e.g. search results) instead of the precompiled DDS/KTX atlases.
 * Same layout contract as CompressedMediaGridArrayTexture: one layer = one
 * grid of cols x rows tiles.
 */
export class CanvasMediaGridArrayTexture extends Texture {
  constructor(gl, args) {
    super(gl, {
      ...args,
      target: gl.TEXTURE_2D_ARRAY,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      flipY: false,
      premultiplyAlpha: false,
      generateMipmaps: false,
    })

    this.bind()
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      1,
      gl.RGBA8,
      this.width,
      this.height,
      this.length,
    )
  }

  bind() {
    if (this.glState.textureUnits[this.glState.activeTextureUnit] === this.id)
      return
    this.gl.bindTexture(this.target, this.texture)
    this.glState.textureUnits[this.glState.activeTextureUnit] = this.id
  }

  pendingLayerUpdates = []

  update(textureUnit = 0) {
    if (
      this.pendingLayerUpdates.length > 0 ||
      this.glState.textureUnits[textureUnit] !== this.id
    ) {
      this.gl.renderer.activeTexture(textureUnit)
      this.bind()

      if (this.minFilter !== this.state.minFilter) {
        this.gl.texParameteri(
          this.target,
          this.gl.TEXTURE_MIN_FILTER,
          this.minFilter,
        )
        this.state.minFilter = this.minFilter
      }
      if (this.magFilter !== this.state.magFilter) {
        this.gl.texParameteri(
          this.target,
          this.gl.TEXTURE_MAG_FILTER,
          this.magFilter,
        )
        this.state.magFilter = this.magFilter
      }
      if (this.wrapS !== this.state.wrapS) {
        this.gl.texParameteri(this.target, this.gl.TEXTURE_WRAP_S, this.wrapS)
        this.state.wrapS = this.wrapS
      }
      if (this.wrapT !== this.state.wrapT) {
        this.gl.texParameteri(this.target, this.gl.TEXTURE_WRAP_T, this.wrapT)
        this.state.wrapT = this.wrapT
      }
    }

    if (this.pendingLayerUpdates.length === 0) return

    const gl = this.gl
    if (this.glState.flipY !== false) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      this.glState.flipY = false
    }
    if (this.glState.premultiplyAlpha !== false) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      this.glState.premultiplyAlpha = false
    }

    // FIFO, with a per-frame budget so big batches never cause a hitch
    let budget = this.maxUploadsPerFrame
    while (this.pendingLayerUpdates.length && budget-- > 0) {
      const u = this.pendingLayerUpdates.shift()
      if (u.layer >= this.length) continue
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        u.x,
        u.y,
        u.layer,
        u.width,
        u.height,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        u.source,
      )
    }
  }

  maxUploadsPerFrame = 48

  /** Whole layer (e.g. a cleared canvas) */
  prepareLayerUpdate(layer, source) {
    // a full-layer upload supersedes everything queued before it for that layer
    this.pendingLayerUpdates = this.pendingLayerUpdates.filter(
      (u) => u.layer !== layer,
    )
    this.pendingLayerUpdates.push({
      layer,
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
      source,
    })
  }

  /** Single tile region */
  prepareTileUpdate(layer, x, y, width, height, source) {
    this.pendingLayerUpdates.push({ layer, x, y, width, height, source })
  }
}
