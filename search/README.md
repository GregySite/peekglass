# Peekglass — recherche d'images avec l'effet nothing-to-watch

Page de recherche construite sur le moteur `voroforce` de ce repo : on tape un ou
plusieurs mots, les images (Pixabay) remplissent le diagramme de Voronoï avec la
même loupe, les mêmes forces et le même shader que le site original.

## Lancer

```bash
bun install
bunx vite --config vite.search.config.ts          # dev → http://127.0.0.1:3100
bunx vite build --config vite.search.config.ts    # build statique → dist-search/
```

Paramètres d'URL utiles :

| Paramètre | Effet |
|-----------|-------|
| `?q=chat` | lance directement une recherche (les recherches mettent l'URL à jour) |
| `?mock=1` | images générées localement, sans réseau (tests) |
| `?cells=1500` | nombre de cellules (défaut = nombre de tuiles : 1000 desktop, 600 mobile) |
| `?size=5.5` | grandes cellules (% de l'écran) qui débordent de l'écran, au lieu du mur dense |
| `?ps=1` | réactive la « pixel search » du shader (plus lourd) |
| `?unsplash=…` `?pexels=…` `?key=…` | clés API Unsplash / Pexels / Pixabay (mémorisées dans le navigateur) |
| `?mt=0` | désactive la simulation multi-thread |
| `?nocoi=1` | n'enregistre pas le service worker d'isolation |
| `#dev` | panneau de réglages du moteur (tweakpane) |

## Sources d'images

Clés dans `search/src/keys.ts` (une source sans clé est ignorée) :

- **Unsplash** — photos les plus soignées, 2 pages = 60 photos par recherche
  (offre gratuite : 50 requêtes/heure ≈ 25 recherches).
- **Pexels** — jusqu'à 400 photos (5 pages ; 200 requêtes/heure, 20 000/mois).
- **Pixabay** — jusqu'à 500 photos (l'API n'en donne pas plus par recherche).

Jusqu'à ~1000 images par recherche sur ordinateur (600 sur mobile), une par
cellule, les meilleurs résultats au centre de l'écran (chargés en premier).

Unsplash et Pexels sont entremêlés et placés en premier (au centre du mur),
Pixabay vient ensuite. Si une source échoue (limite atteinte…), les autres
suffisent.

## Comment ça marche

- **Moteur** : `voroforce/` est utilisé tel quel, avec un seul ajout : un type de
  média `canvas-grid` (`voroforce/display/scene/utils/canvas-media-grid-array-texture.js`).
  Au lieu des atlas DDS précompilés du site original, les textures sont des
  `TEXTURE_2D_ARRAY` RGBA remplies à la volée depuis des canvas.
- **Atlas** (`search/src/atlas.ts`) : 1000 tuiles (25 × 20 × 2 couches ; 600 sur mobile) en 3
  résolutions (basse / moyenne / haute), comme les 3 versions du site original.
  La tuile `t` affiche l'image `t % nbRésultats`, donc même 12 résultats
  remplissent le mur.
- **Intégration** (`search/src/vf.ts`) : reprend la config et les modes du site
  (`app/vf/config`, presets `mobile`), les transitions d'uniforms et la logique
  preview / select, sans React ni store.
- **Fluidité** : sur ordinateur (Chrome, Edge, Firefox), `coi-serviceworker.js`
  rend la page « cross-origin isolated » sur GitHub Pages, ce qui débloque
  `SharedArrayBuffer` : la simulation tourne alors dans des Web Workers et le rendu
  en parallèle, comme sur le site original. Les images sont décodées en asynchrone
  et envoyées au GPU tuile par tuile (budget par frame), sans ré-upload d'atlas.
- **UI** (`search/src/main.ts`) : barre de recherche, légende de l'image survolée,
  fiche détaillée au clic (Échap pour fermer).

Images : [Pixabay](https://pixabay.com/) · Effet : [gnovotny/nothing-to-watch](https://github.com/gnovotny/nothing-to-watch) (MIT).
