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
| `?cells=1500` | nombre de cellules (défaut 1000 desktop, 600 mobile) |
| `?size=7` | taille des cellules en % de l'écran (défaut 5.5 desktop, 8.5 mobile) |
| `?key=…` | autre clé API Pixabay (mémorisée dans le navigateur) |
| `#dev` | panneau de réglages du moteur (tweakpane) |

## Comment ça marche

- **Moteur** : `voroforce/` est utilisé tel quel, avec un seul ajout : un type de
  média `canvas-grid` (`voroforce/display/scene/utils/canvas-media-grid-array-texture.js`).
  Au lieu des atlas DDS précompilés du site original, les textures sont des
  `TEXTURE_2D_ARRAY` RGBA remplies à la volée depuis des canvas.
- **Atlas** (`search/src/atlas.ts`) : 200 tuiles (10 × 10 × 2 couches) en 3
  résolutions (basse / moyenne / haute), comme les 3 versions du site original.
  La tuile `t` affiche l'image `t % nbRésultats`, donc même 12 résultats
  remplissent le mur.
- **Intégration** (`search/src/vf.ts`) : reprend la config et les modes du site
  (`app/vf/config`, presets `mobile`), les transitions d'uniforms et la logique
  preview / select, sans React ni store.
- **UI** (`search/src/main.ts`) : barre de recherche, légende de l'image survolée,
  fiche détaillée au clic (Échap pour fermer).

Images : [Pixabay](https://pixabay.com/) · Effet : [gnovotny/nothing-to-watch](https://github.com/gnovotny/nothing-to-watch) (MIT).
