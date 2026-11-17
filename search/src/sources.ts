export type SearchImage = {
  id: string
  thumb: string // small image used for the atlas tiles
  fallback?: string // tiny CDN preview, used if thumb can't be loaded
  full: string // bigger image for the detail panel
  page: string // source page
  title: string
  author: string
  width: number
  height: number
}

const DEFAULT_PIXABAY_KEY = '56097629-273982d2666f273ddb23221c6'
const KEY_STORAGE = 'peekglass:pixabayKey'

export const getPixabayKey = () => {
  const param = new URLSearchParams(window.location.search).get('key')
  if (param) {
    try {
      localStorage.setItem(KEY_STORAGE, param)
    } catch {}
    return param
  }
  try {
    return localStorage.getItem(KEY_STORAGE) || DEFAULT_PIXABAY_KEY
  } catch {
    return DEFAULT_PIXABAY_KEY
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type PixabayHit = {
  id: number
  pageURL: string
  tags: string
  previewURL: string
  webformatURL: string
  largeImageURL: string
  user: string
  imageWidth: number
  imageHeight: number
}

export async function searchPixabay(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchImage[]> {
  const url = new URL('https://pixabay.com/api/')
  url.searchParams.set('key', getPixabayKey())
  url.searchParams.set('q', query.slice(0, 100))
  url.searchParams.set('image_type', 'photo')
  url.searchParams.set('per_page', String(Math.min(200, limit)))
  url.searchParams.set('safesearch', 'true')
  url.searchParams.set('lang', 'fr')
  const res = await fetch(url, { signal })
  if (res.status === 429) throw new Error('Trop de recherches, réessaie dans une minute.')
  if (!res.ok) throw new Error(`Pixabay a répondu ${res.status}`)
  const data = (await res.json()) as { hits: PixabayHit[] }
  return data.hits.map((h) => ({
    id: String(h.id),
    // Pixabay sizes: replace _640 by _340 for a lighter version
    thumb: h.webformatURL.replace('_640', '_340'),
    fallback: h.previewURL,
    full: h.webformatURL,
    page: h.pageURL,
    title: capitalize(h.tags.split(',').slice(0, 3).join(' · ').trim()),
    author: h.user,
    width: h.imageWidth,
    height: h.imageHeight,
  }))
}

/** Offline generator, for testing without network (?mock=1) */
export async function searchMock(query: string, limit: number) {
  await new Promise((r) => setTimeout(r, 300))
  const seed = [...query].reduce((a, c) => a + c.charCodeAt(0), 0)
  const n = Math.min(limit, 37 + (seed % 120))
  return Array.from({ length: n }, (_, i) => {
    const hue = (seed * 7 + i * 23) % 360
    const c = document.createElement('canvas')
    c.width = 240
    c.height = 360
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 240, 360)
    g.addColorStop(0, `hsl(${hue} 70% 55%)`)
    g.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 20%)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 240, 360)
    ctx.fillStyle = 'rgba(255,255,255,.9)'
    ctx.font = 'bold 64px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), 120, 160)
    ctx.font = '28px sans-serif'
    ctx.fillText(query.slice(0, 14), 120, 230)
    ctx.beginPath()
    ctx.arc(120, 300, 30, 0, Math.PI * 2)
    ctx.fill()
    const src = c.toDataURL('image/jpeg', 0.85)
    return {
      id: `mock-${i}`,
      thumb: src,
      full: src,
      page: '#',
      title: `${capitalize(query)} n°${i + 1}`,
      author: 'mock',
      width: 240,
      height: 360,
    } satisfies SearchImage
  })
}

export const isMock = () =>
  new URLSearchParams(window.location.search).has('mock')

export const search = (query: string, limit: number, signal?: AbortSignal) =>
  isMock() ? searchMock(query, limit) : searchPixabay(query, limit, signal)
