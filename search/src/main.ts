import './style.css'
import type { VoroforceCell } from '@/vf/types'
import { Atlas } from './atlas'
import { type SearchImage, search } from './sources'
import { ATLAS_VERSIONS, MEDIA_CAPACITY, createEngine } from './vf'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const container = $('voroforce')
const form = $<HTMLFormElement>('search-form')
const input = $<HTMLInputElement>('q')
const statusEl = $('status')
const progress = $('progress')
const chips = $('chips')
const caption = $('caption')
const card = $('card')
const hint = $('hint')

const SUGGESTIONS = [
  'Jérusalem',
  'océan',
  'forêt',
  'architecture',
  'chat',
  'espace',
  'montagne',
  'cuisine',
  'fleurs',
  'néon',
]

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

if (!hasWebGL2()) {
  const fatal = $('fatal')
  fatal.hidden = false
  fatal.textContent =
    "Ton navigateur ne supporte pas WebGL 2 — essaie avec Chrome, Firefox ou Safari récent."
  throw new Error('WebGL2 not supported')
}

const engine = createEngine(container)
const atlas = new Atlas(ATLAS_VERSIONS)
atlas.clear()

let results: SearchImage[] = []
let controller: AbortController | undefined
let currentQuery = ''

const uploadAll = () => {
  atlas.layers.forEach((layers, v) =>
    layers.forEach(({ canvas }, l) => engine.uploadLayer(v, l, canvas)),
  )
}
uploadAll()

const imageForCell = (cell?: VoroforceCell): SearchImage | undefined => {
  if (!cell || !results.length) return
  const id = (cell as unknown as { id: number }).id ?? 0
  return results[(id % MEDIA_CAPACITY) % results.length]
}

const setStatus = (text: string, error = false) => {
  statusEl.textContent = text
  statusEl.classList.toggle('error', error)
}

const setProgress = (ratio: number | null) => {
  if (ratio === null) {
    progress.classList.remove('on')
    setTimeout(() => {
      if (!progress.classList.contains('on')) progress.style.width = '0'
    }, 400)
    return
  }
  progress.classList.add('on')
  progress.style.width = `${Math.round(ratio * 100)}%`
}

// ---------- detail card ----------
const openCard = (img: SearchImage) => {
  $<HTMLImageElement>('card-img').src = img.full
  $<HTMLImageElement>('card-img').alt = img.title
  $('card-title').textContent = img.title || 'Sans titre'
  $('card-author').textContent = `par ${img.author}`
  $<HTMLAnchorElement>('card-link').href = img.page
  $<HTMLAnchorElement>('card-full').href = img.full
  card.classList.add('on')
  card.setAttribute('aria-hidden', 'false')
  caption.classList.remove('on')
}
const closeCard = () => {
  card.classList.remove('on')
  card.setAttribute('aria-hidden', 'true')
}

engine.onSelect((cell) => {
  const img = imageForCell(cell)
  if (img) openCard(img)
  else closeCard()
})

engine.onFocus((cell) => {
  const img = imageForCell(cell)
  if (!img || card.classList.contains('on')) {
    caption.classList.remove('on')
    return
  }
  caption.innerHTML = ''
  caption.append(img.title || '')
  const small = document.createElement('small')
  small.textContent = img.author
  caption.append(small)
  caption.classList.add('on')
})

$('card-close').addEventListener('click', () => {
  engine.deselect()
  closeCard()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    engine.deselect()
    closeCard()
  }
})

// keystrokes in the search field must not reach the engine (space / enter / arrows)
input.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key === 'Escape') input.blur()
})

// hide the hint after a first real interaction
const hideHint = () => hint.classList.add('hidden')
container.addEventListener('click', hideHint, { once: true })
container.addEventListener('touchstart', hideHint, { once: true, passive: true })
window.addEventListener('wheel', hideHint, { once: true, passive: true })
setTimeout(hideHint, 12000)

// ---------- search ----------
async function runSearch(query: string, { push = true } = {}) {
  const q = query.trim()
  if (!q) return
  controller?.abort()
  const ctrl = new AbortController()
  controller = ctrl
  currentQuery = q
  input.value = q
  input.blur()
  setStatus(`Recherche de « ${q} »…`)
  setProgress(0.08)

  if (push) {
    const url = new URL(window.location.href)
    url.searchParams.set('q', q)
    window.history.pushState({ q }, '', url)
  }
  document.title = `${q} — Peekglass`

  let found: SearchImage[]
  try {
    found = await search(q, MEDIA_CAPACITY, ctrl.signal)
  } catch (e) {
    if (ctrl.signal.aborted) return
    setProgress(null)
    setStatus((e as Error).message || 'Erreur pendant la recherche', true)
    return
  }
  if (ctrl.signal.aborted) return

  if (!found.length) {
    setProgress(null)
    setStatus(`Aucune image pour « ${q} » — essaie un autre mot`, true)
    return
  }

  engine.deselect()
  closeCard()
  caption.classList.remove('on')
  results = found
  atlas.clear()
  uploadAll()
  engine.shake()

  const loaded = await atlas.fill(found, {
    signal: ctrl.signal,
    onUpdate: (n, total) => {
      uploadAll()
      setProgress(0.1 + 0.9 * (n / total))
      container.classList.add('ready')
    },
  })
  if (ctrl.signal.aborted) return
  setProgress(null)
  container.classList.add('ready')
  if (!loaded) {
    setStatus("Les images n'ont pas pu être chargées", true)
    return
  }
  setStatus(`${found.length} image${found.length > 1 ? 's' : ''} pour « ${q} »`)
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  chips.classList.add('hidden')
  void runSearch(input.value)
})

SUGGESTIONS.forEach((s) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = s
  b.addEventListener('click', () => {
    chips.classList.add('hidden')
    void runSearch(s)
  })
  chips.append(b)
})

window.addEventListener('popstate', () => {
  const q = new URLSearchParams(window.location.search).get('q')
  if (q && q !== currentQuery) void runSearch(q, { push: false })
})

// first search: ?q=… or a random suggestion so the wall is alive from the start
const initial =
  new URLSearchParams(window.location.search).get('q') ??
  SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)]
if (new URLSearchParams(window.location.search).has('q')) chips.classList.add('hidden')
void runSearch(initial, { push: false }).then(() => {
  if (!new URLSearchParams(window.location.search).has('q')) input.value = ''
})

if (import.meta.env.DEV) {
  ;(window as unknown as { __pg: unknown }).__pg = { engine, atlas, getResults: () => results }
}
