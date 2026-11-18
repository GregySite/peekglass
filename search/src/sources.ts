import { KEYS } from './keys'

export type SourceName = 'Unsplash' | 'Pexels' | 'Pixabay' | 'Démo'

export type SearchImage = {
  id: string
  source: SourceName
  thumb: string // image used for the atlas tiles (already ~tile sized)
  fallback?: string // smaller variant, used if thumb can't be loaded
  full: string // bigger image for the detail panel
  page: string // photo page on the source site
  title: string
  author: string
  authorUrl?: string
  /** Unsplash: endpoint to ping when the user opens / downloads the photo */
  downloadPing?: string
}

export type SearchResult = {
  images: SearchImage[]
  sources: SourceName[] // sources that answered with at least one image
  failures: { source: SourceName; message: string }[]
}

/** Size requested from the image CDNs for the atlas tiles (2:3, a bit above the
 * largest tile, 120×180). Small = fast to load 1000 of them. */
const THUMB_W = 180
const THUMB_H = 270
const APP = 'peekglass'

const params = new URLSearchParams(window.location.search)

/** key from ?unsplash= / ?pexels= / ?key= (remembered in this browser), else keys.ts */
const getKey = (name: 'unsplash' | 'pexels' | 'pixabay', param: string) => {
  const storageKey = `peekglass:${name}Key`
  const fromUrl = params.get(param)
  try {
    if (fromUrl) localStorage.setItem(storageKey, fromUrl)
    return fromUrl || localStorage.getItem(storageKey) || KEYS[name]
  } catch {
    return fromUrl || KEYS[name]
  }
}

const capitalize = (s = '') => s.charAt(0).toUpperCase() + s.slice(1)

const utm = (url: string) =>
  `${url}${url.includes('?') ? '&' : '?'}utm_source=${APP}&utm_medium=referral`

const httpError = (source: SourceName, status: number) => {
  if (status === 429 || status === 403)
    return new Error(`${source} : limite de recherches atteinte pour l'heure`)
  if (status === 401) return new Error(`${source} : clé API invalide`)
  return new Error(`${source} a répondu ${status}`)
}

// ---------- Unsplash ----------
type UnsplashPhoto = {
  id: string
  alt_description: string | null
  description: string | null
  urls: { raw: string; regular: string; small: string }
  links: { html: string; download_location: string }
  user: { name: string; links: { html: string } }
}

async function searchUnsplash(query: string, signal?: AbortSignal) {
  const key = getKey('unsplash', 'unsplash')
  if (!key) return []
  const page = async (n: number) => {
    const url = new URL('https://api.unsplash.com/search/photos')
    url.searchParams.set('query', query)
    url.searchParams.set('per_page', '30')
    url.searchParams.set('page', String(n))
    url.searchParams.set('content_filter', 'high')
    url.searchParams.set('lang', 'fr')
    const res = await fetch(url, {
      signal,
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
    })
    if (!res.ok) throw httpError('Unsplash', res.status)
    return ((await res.json()) as { results: UnsplashPhoto[] }).results
  }
  // 2 pages = 60 photos (the free plan allows 50 requests / hour → ~25 searches)
  const [p1, p2] = await Promise.allSettled([page(1), page(2)])
  if (p1.status === 'rejected') throw p1.reason
  const photos = [...p1.value, ...(p2.status === 'fulfilled' ? p2.value : [])]
  return photos.map(
    (p): SearchImage => ({
      id: `u-${p.id}`,
      source: 'Unsplash',
      // imgix: smart crop to the tile ratio, right size
      thumb: `${p.urls.raw}&w=${THUMB_W}&h=${THUMB_H}&fit=crop&crop=entropy&q=80&fm=jpg`,
      fallback: p.urls.small,
      full: p.urls.regular,
      page: utm(p.links.html),
      title: capitalize(p.alt_description || p.description || ''),
      author: p.user.name,
      authorUrl: utm(p.user.links.html),
      downloadPing: `${p.links.download_location}${p.links.download_location.includes('?') ? '&' : '?'}client_id=${key}`,
    }),
  )
}

// ---------- Pexels ----------
type PexelsPhoto = {
  id: number
  url: string
  alt: string
  photographer: string
  photographer_url: string
  src: { original: string; large2x: string; large: string; medium: string }
}

async function searchPexels(query: string, limit: number, signal?: AbortSignal) {
  const key = getKey('pexels', 'pexels')
  if (!key) return []
  const PER_PAGE = 80
  const page = async (n: number) => {
    const url = new URL('https://api.pexels.com/v1/search')
    url.searchParams.set('query', query)
    url.searchParams.set('per_page', String(PER_PAGE))
    url.searchParams.set('page', String(n))
    url.searchParams.set('locale', 'fr-FR')
    const res = await fetch(url, { signal, headers: { Authorization: key } })
    if (!res.ok) throw httpError('Pexels', res.status)
    return (await res.json()) as { photos: PexelsPhoto[]; total_results: number }
  }
  const first = await page(1)
  // more pages only if they exist (200 requests / hour on the free plan)
  const pages = Math.min(
    Math.ceil(first.total_results / PER_PAGE),
    Math.ceil(limit / PER_PAGE),
  )
  const rest = await Promise.allSettled(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 2)),
  )
  const photos = [
    ...first.photos,
    ...rest.flatMap((r) => (r.status === 'fulfilled' ? r.value.photos : [])),
  ]
  return photos.map(
    (p): SearchImage => ({
      id: `p-${p.id}`,
      source: 'Pexels',
      thumb: `${p.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=${THUMB_W}&h=${THUMB_H}`,
      fallback: p.src.medium,
      full: p.src.large2x,
      page: p.url,
      title: capitalize(p.alt),
      author: p.photographer,
      authorUrl: p.photographer_url,
    }),
  )
}

// ---------- Pixabay ----------
type PixabayHit = {
  id: number
  pageURL: string
  tags: string
  previewURL: string
  webformatURL: string
  user: string
  user_id: number
}

async function searchPixabay(query: string, limit: number, signal?: AbortSignal) {
  const key = getKey('pixabay', 'key')
  if (!key) return []
  const PER_PAGE = 200
  const page = async (n: number) => {
    const url = new URL('https://pixabay.com/api/')
    url.searchParams.set('key', key)
    url.searchParams.set('q', query.slice(0, 100))
    url.searchParams.set('image_type', 'photo')
    url.searchParams.set('per_page', String(PER_PAGE))
    url.searchParams.set('page', String(n))
    url.searchParams.set('safesearch', 'true')
    url.searchParams.set('order', 'popular')
    url.searchParams.set('lang', 'fr')
    const res = await fetch(url, { signal })
    if (!res.ok) throw httpError('Pixabay', res.status)
    return (await res.json()) as { hits: PixabayHit[]; totalHits: number }
  }
  const first = await page(1)
  const pages = Math.min(
    Math.ceil(Math.min(first.totalHits, 500) / PER_PAGE),
    Math.ceil(limit / PER_PAGE),
  )
  const rest = await Promise.allSettled(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 2)),
  )
  const hits = [
    ...first.hits,
    ...rest.flatMap((r) => (r.status === 'fulfilled' ? r.value.hits : [])),
  ]
  return hits.map(
    (h): SearchImage => ({
      id: `x-${h.id}`,
      source: 'Pixabay',
      thumb: h.webformatURL.replace('_640', '_340'), // light, enough for the tiles
      fallback: h.previewURL,
      full: h.webformatURL.replace('_640', '_960'),
      page: h.pageURL,
      title: capitalize(h.tags.split(',').slice(0, 3).join(' · ').trim()),
      author: h.user,
      authorUrl: `https://pixabay.com/users/${h.user}-${h.user_id}/`,
    }),
  )
}

/** a, b, a, b… keeps the best results of both sources at the top */
const interleave = <T>(a: T[], b: T[]) => {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

/**
 * Unsplash (60) + Pexels (up to 400), interleaved and placed first (centre of the
 * wall), then Pixabay (up to 500) to fill up to `limit` (1000 desktop / 600 mobile). Any source can fail without breaking the search.
 */
export async function searchAll(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const q = query.trim()
  const settled = await Promise.allSettled([
    searchUnsplash(q, signal),
    searchPexels(q, Math.min(400, limit), signal),
    searchPixabay(q, Math.min(500, limit), signal),
  ])
  const names: SourceName[] = ['Unsplash', 'Pexels', 'Pixabay']
  const failures: SearchResult['failures'] = []
  const lists = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value
    if (!signal?.aborted)
      failures.push({ source: names[i], message: (s.reason as Error)?.message })
    return []
  })
  const [unsplash, pexels, pixabay] = lists
  const images = [...interleave(unsplash, pexels), ...pixabay].slice(0, limit)
  const sources = names.filter((_, i) => lists[i].length > 0)
  return { images, sources, failures }
}

/** Offline generator, for testing without network (?mock=1) */
export async function searchMock(query: string, limit: number): Promise<SearchResult> {
  await new Promise((r) => setTimeout(r, 300))
  const seed = [...query].reduce((a, c) => a + c.charCodeAt(0), 0)
  const n = Math.min(limit, 37 + (seed % 120))
  const images = Array.from({ length: n }, (_, i) => {
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
    const src = c.toDataURL('image/jpeg', 0.85)
    return {
      id: `mock-${i}`,
      source: 'Démo',
      thumb: src,
      full: src,
      page: '#',
      title: `${capitalize(query)} n°${i + 1}`,
      author: 'mock',
    } satisfies SearchImage
  })
  return { images, sources: ['Démo'], failures: [] }
}

export const isMock = () => params.has('mock')

export const search = (query: string, limit: number, signal?: AbortSignal) =>
  isMock() ? searchMock(query, limit) : searchAll(query, limit, signal)
