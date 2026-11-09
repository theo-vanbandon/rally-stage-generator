# 🔧 Rally Stage Generator - Backend

API REST qui génère des spéciales de rallye sur les petites routes hors agglomération.

## 📋 Fonctionnement

1. **Géocodage** de la commune via l'API officielle [geo.api.gouv.fr](https://geo.api.gouv.fr) (secours : Nominatim), ou coordonnées fournies directement.
2. **Réseau routier** : téléchargement des tronçons de la **BD TOPO® de l'IGN** (service WFS de la Géoplateforme, pages téléchargées en parallèle). Chaque tronçon fournit sa nature (route, route empierrée, chemin), son importance, sa largeur, son accès, son sens de circulation, un indicateur `urbain` et l'altitude de chaque point.
3. **Exclusion des villes** : l'IGN marque « urbain » toute route bordée de maisons, ce qui dans le Nord couvre presque tout le réseau. On mesure donc la densité de rues urbaines autour de chaque tronçon (km de rues dans une fenêtre de 750 m × 750 m) : au-delà de 4,5 (centre-bourg, ville ; Lille ≥ 7,5, centre de Laventie 6,9), le tronçon est exclu. Les hameaux et l'habitat en ruban le long des routes de campagne restent utilisables, comme sur les rallyes du Nord, mais pénalisés (2 km d'affilée max, 40 % de la spéciale max).
4. **Graphe** : chaque tronçon est caractérisé (sinuosité en °/km, lignes droites, cap d'entrée/sortie, revêtement, gabarit). Les impasses de moins de 1,5 km (accès de ferme) sont élaguées, et la « portée » de chaque tronçon orienté est précalculée pour ne jamais s'engager dans une branche trop courte.
5. **Génération** : jusqu'à 6 000 marches aléatoires pondérées (petites routes sinueuses favorisées, demi-tours pénalisés, jamais deux fois le même carrefour) produisent des tracés candidats, notés sur la sinuosité, les lignes droites, le gabarit, le revêtement, la traversée de hameaux et les repassages à proximité. La spéciale principale est tirée parmi les meilleures, avec 2 alternatives distinctes.
6. **Accès et sortie** : une marche ne s'arrête que sur un carrefour d'où l'on peut repartir sans emprunter la spéciale, et le départ doit être accessible de la même façon. La vérification parcourt le réseau de liaison (toutes routes publiques, villes et grands axes compris, hors chemins de terre) en évitant les nœuds de la spéciale, jusqu'à un grand axe (importance 1 à 3), une agglomération ou le bord de la zone. Une arrivée enfermée (cul-de-sac, poche entourée par le tracé) est rejetée.
7. **Pas de répétition** : le client envoie les identifiants des tracés déjà vus (`avoid`). Les tracés qui les recouvrent sont écartés, avec une tolérance relâchée par paliers (30 % → 90 %) sur les petites zones. Les 3 spéciales proposées doivent pouvoir se courir le même jour, toutes fermées en même temps :
   - aucun tronçon ni carrefour en commun ;
   - au moins 500 m d'écart entre deux spéciales (250 m sur une petite zone), pour l'accès des secours ;
   - chaque départ reste accessible et chaque arrivée garde une sortie, sans emprunter aucune des spéciales.

   Faute d'alternatives qui respectent ces règles, on en propose moins. Si plus rien de nouveau n'existe, la réponse porte `exhausted: true` et les variantes déjà vues sont reproposées, la plus ancienne d'abord.
8. **Roadbook d'organisation** : une case par point utile, numérotée, avec kilométrage total et partiel :
   - **CH — Départ ES**, puis une case par **carrefour** avec sa **tulipe** : chaque route est une **courbe continue** reconstruite à partir des points IGN ([utils/curve.js](utils/curve.js) : spline de Catmull-Rom centripète passant par les points, tangente par cercle osculateur), jamais une suite de segments droits. Le sens d'arrivée est la tangente exacte au carrefour, quelle que soit la densité des points IGN ; les artefacts de numérisation (décroché, crochet de jonction, détectés par un virage isolé de moins de 3,5 m de rayon) sont écartés ; un carrefour que l'IGN découpe en deux nœuds proches (< 25 m) devient une seule case. Les demi-tours sont dessinés en V ouvert ;
   - observations : route empruntée, **dangers** (`!` épingle, prise ou croisement d'une route principale, `!!` épingle très serrée), **changements de revêtement** (« Début terre », « Retour asphalte ») ;
   - **arrivée lancée**, puis **point stop** 300 m à 1 km plus loin sur la route de sortie.
   Les notes de virages ne sont pas générées : en rallye, c'est l'équipage qui les prend en reconnaissance.
9. **Boucle** (option `loop`), deux types :
   - `"junction"`, **par un carrefour** : la spéciale arrive à un carrefour pivot, fait le tour d'une boucle qui y ramène, puis repart par une autre route. On passe deux fois au pivot, jamais deux fois sur la même route. Le pivot est un carrefour d'au moins 4 routes, ou un carrefour décalé (deux nœuds IGN de 3 routes reliés par un tronçon de moins de 25 m : 1er passage par l'un, 2e par l'autre).
   - `"shared"`, **avec portion commune** : bras d'entrée → A → portion A→B → boucle de B jusqu'à A → même portion A→B → bras de sortie depuis B. La portion (0,3–1,5 km en courte, 0,4–2,5 km en moyenne, 0,5–3 km en longue) est le seul tronçon parcouru deux fois, toujours dans le même sens : jamais de face-à-face. Deux carrefours en T suffisent, d'où beaucoup plus de possibilités qu'avec un carrefour en croix. Au roadbook, A et B apparaissent deux fois (entrée sur la portion, départ de la boucle, retour sur la portion, sortie), et les carrefours intermédiaires de la portion portent « 2e passage » au second passage.

   Pour les deux types :
   - La boucle mesure 1,5–4 km (courte), 2–6 km (moyenne) ou 3–8 km (longue). Elle est construite par un aller pondéré (petites routes sinueuses) puis un retour au plus court vers le pivot, sans recroiser l'aller.
   - Une boucle trop allongée (deux routes parallèles) est rejetée : sa compacité (4π·surface/périmètre², mesurée sur le tracé lissé) doit dépasser 0,2.
   - Il y a au moins 1 km avant et après la boucle. Les bras d'entrée et de sortie partent vers l'extérieur de la boucle et ne la recoupent jamais.
   - Au roadbook, un carrefour de boucle porte le danger `!`. En mode carrefour, le pivot apparaît deux fois (« 1er passage — entrée dans la boucle », « 2e passage — sortie de la boucle »).
   - Le générateur transmet au roadbook les étapes exactes des passages (`loopSteps`), y compris en sens inverse : aucune détection après coup.
   - Si la zone n'offre aucune boucle (massif sans carrefour de 4 routes, par exemple), la zone est élargie, puis la réponse est une 404 explicite.

La **graine** (`seed`) rend la génération reproductible : même zone + mêmes options + même graine = même spéciale.

### Performances

| Étape | Première demande sur une zone | Demandes suivantes |
|-------|-------------------------------|--------------------|
| Téléchargement IGN | ~2 s (Gap, 12 km) à ~7 s (Lille, 15 km) | cache |
| Construction du graphe | 0,3 à 1 s | cache |
| Génération | 0,1 à 0,4 s | 0,1 à 0,4 s |

- Graphes construits gardés en mémoire (4 zones, 2 h).
- Tronçons bruts gardés **sur disque** (7 jours, gzip) dans `CACHE_DIR` : survivent à un redémarrage.
- Le dossier se nettoie seul (au démarrage, après chaque nouvelle zone et toutes les 6 h) : fichiers expirés ou d'une ancienne version supprimés, puis les zones les plus anciennes au-delà de `CACHE_MAX_MB`.
- Deux demandes simultanées sur la même zone ne déclenchent qu'un seul téléchargement.
- Les échecs et résultats vides ne sont jamais mis en cache.

## 🏗️ Structure
```
backend/
├── index.js                    # Point d'entrée Express
├── routes/
│   └── generate.js             # POST /api/generate (validation, cache, orchestration)
├── services/
│   ├── geocoder.js             # Communes françaises (geo.api.gouv.fr + Nominatim)
│   ├── bdtopo.js               # Téléchargement du réseau IGN BD TOPO
│   ├── roadNetwork.js          # Graphe routier + caractérisation des tronçons
│   ├── stageGenerator.js       # Marches aléatoires, notation, roadbook, altitude
│   └── cache.js                # Cache LRU mémoire/disque
├── utils/
│   └── geometry.js             # Distances, caps, rééchantillonnage, RNG
└── __tests__/                  # Tests (réseaux synthétiques, aucun appel réseau)
```

## ⚙️ Configuration

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | 4000 | Port du serveur |
| `CACHE_DIR` | `<tmp>/rally-stage-generator-cache` | Dossier du cache disque |
| `CACHE_MAX_MB` | 300 | Taille max du cache disque |

## 🏃 Démarrage
```bash
npm install
npm start        # ou npm run dev (rechargement automatique)
```

## 🧪 Tests
```bash
npm test
npm run test:coverage
```

Les tests n'appellent aucun service externe (axios mocké, réseaux routiers synthétiques dans `__tests__/fixtures`).

### Validation sur données réelles
```bash
npm run validate                  # 33 communes de profils variés (≈ 6 min, internet requis)
npm run validate -- Gap Mende     # seulement certaines communes
npm run validate -- --boucle      # boucle par un carrefour (pivot unique, longueur de boucle, 2 cases au roadbook)
npm run validate -- --boucle=portion  # boucle avec portion commune (même sens, pas de face-à-face, 4 cases)
```

Le script [scripts/validate-france.js](scripts/validate-france.js) génère des spéciales (3 revêtements × 3 longueurs × 2 graines) autour de communes de montagne, de plaine, de terres de rallye, du littoral, d'outre-mer et de grandes villes, et vérifie sur chaque tracé : longueur, carrefour jamais repris, départ accessible et arrivée ouverte, part habitée, part de terre, alternatives réalisables le même jour (ni chevauchement ni croisement, 250 m d'écart, aucun accès bloqué par une autre spéciale), cohérence du roadbook, non-répétition et temps de génération. Les tulipes y sont aussi contrôlées (formes dans le cadre, arrivée par le bas, flèche du côté annoncé). Code de sortie non nul au moindre écart : à relancer après chaque modification du générateur.

Les carrefours types (croix, T, fourches ouvertes et fermées, virage arrondi, arrivée en courbe, épingles, approche en épingle ou à angle droit, branche très courte, patte d'oie, départ et arrivée en pleine route, passage 360°/0°, routes principales et pistes) sont testés sur des géométries exactes dans [__tests__/services/roadbook.test.js](__tests__/services/roadbook.test.js).

## 📡 API

### `POST /api/generate`

**Body (JSON)** — `place` ou `lat`/`lon` obligatoire
```json
{
  "place": "Gap",
  "postal": "05000",
  "lat": 44.5797,
  "lon": 6.0616,
  "radiusKm": 10,
  "surface": "asphalt",
  "length": "medium",
  "seed": 42,
  "avoid": ["1vk3h2k", "15esog"],
  "loop": false
}
```

| Champ | Valeurs | Défaut |
|-------|---------|--------|
| `radiusKm` | 3 à 20 | 10 |
| `surface` | `asphalt`, `gravel` (terre : ≥ 60 % de terre), `mixed` (25 à 75 % de terre) | `asphalt` |
| `length` | `short` (5–9 km), `medium` (9–16 km), `long` (16–25 km) | `medium` |
| `seed` | entier | aléatoire |
| `avoid` | identifiants de tracés déjà vus (60 max) | `[]` |
| `loop` | `"junction"` (boucle par un carrefour, `true` accepté), `"shared"` (portion commune) | `false` |

**Réponse**
```json
{
  "ok": true,
  "center": { "lat": 44.5797, "lon": 6.0616, "name": "Gap", "population": 41293 },
  "radiusKm": 10,
  "surface": "asphalt",
  "length": "medium",
  "seed": 42,
  "relaxed": false,
  "exhausted": false,
  "stage": {
    "id": "1a8laii",
    "geometry": { "type": "LineString", "coordinates": [[6.11, 44.51, 980.4], "..."] },
    "start": [6.11, 44.51],
    "finish": [6.05, 44.55],
    "roads": ["D211", "Route de Rambaud"],
    "stop": { "coord": [6.05, 44.55], "path": [[6.05, 44.551], [6.05, 44.55]], "distanceKm": 0.42 },
    "roadbook": [
      {
        "n": 2, "type": "junction", "km": 0.73, "partial": 0.73, "coord": [6.01, 44.59],
        "direction": "À gauche", "angle": -60, "road": "D503",
        "notes": ["Croisement route principale"], "danger": 1,
        "tulip": { "entry": "road", "exit": -60, "exitKind": "road", "others": [{ "angle": 85, "kind": "major" }] }
      }
    ],
    "stats": {
      "lengthKm": 12.22,
      "twistDegPerKm": 658,
      "straightSharePct": 0,
      "longestStraightKm": 0.22,
      "junctions": 30,
      "urbanPct": 0,
      "loop": null,
      "surfacePct": { "paved": 100, "gravel": 0, "dirt": 0 },
      "elevation": { "min": 848, "max": 1096, "gain": 348, "loss": 388, "maxSlopePct": 11.4, "profile": [[0, 980], "..."] }
    }
  },
  "alternatives": ["… même format que stage …"],
  "meta": { "segments": 21814, "drivableSegments": 12473, "candidates": 532, "dataSource": "fresh", "timings": { "totalMs": 4500 } }
}
```

Chaque spéciale (principale et alternatives) contient `reverse` : le même tracé parcouru dans l'autre sens, au même format (géométrie, roadbook, point stop et statistiques recalculés, D+ et D- échangés). Les réponses sont compressées (gzip).

`relaxed: true` signifie que le réseau rural était trop morcelé pour la longueur demandée : la spéciale est plus courte.
`surfaceRelaxed: true` signifie que la zone n'a pas assez de pistes reliées : la part de terre exigée a été abaissée (35 % en terre, 10 % en mixte).
`stage.surfaces` découpe le tracé en portions de revêtement homogène (indices dans `geometry.coordinates`).
`exhausted: true` signifie que la zone ne contient plus de tracé vraiment différent de ceux listés dans `avoid`.
`stats.loop` vaut `null` sans boucle. Sinon :
- carrefour : `{ "kind": "junction", "fromKm": 2.85, "lengthKm": 3.32, "coord": [2.8, 50.6] }`, soit le kilomètre du 1er passage au pivot, la longueur de la boucle et la position du pivot ;
- portion commune : `{ "kind": "shared", "sharedFromKm": 2.1, "sharedKm": 0.82, "fromKm": 2.92, "lengthKm": 3.4, "coord": [...] }`. La portion débute au km `sharedFromKm`, la boucle part de sa fin (B, au km `fromKm`), et la portion est reparcourue à partir de `fromKm + lengthKm`.

Si le rayon demandé ne permet aucune spéciale (vallée urbanisée, massif fermé à la circulation…), le serveur réessaie à +5 puis +10 km (20 km max) ; la réponse indique alors `radiusKm` (rayon utilisé) et `expandedFrom` (rayon demandé).

**Erreurs** : `400` paramètre invalide, `404` commune inconnue ou aucune spéciale possible même élargie, `422` zone trop dense pour être analysée (plus de 150 000 tronçons, typiquement le cœur d'une métropole), `502` service IGN indisponible.

### `GET /api/ping`

Health check (utilisé par le front pour réveiller le serveur).

## 📦 Dépendances

- `express`, `cors`, `axios`
- Dev : `jest`, `supertest`, `nodemon`

## 📜 Données

Réseau routier et altitudes : IGN BD TOPO® — Licence Ouverte Etalab 2.0. Communes : API Découpage administratif (geo.api.gouv.fr).
