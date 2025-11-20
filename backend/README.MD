# 🔧 Rally Stage Generator - Backend

API REST pour la génération de spéciales de rallye.

## 📋 Description

Le backend est une API Node.js/Express qui :
- Géocode les villes françaises via Nominatim
- Récupère les routes depuis OpenStreetMap via Overpass API
- Filtre les routes adaptées au rallye
- Génère un tracé optimisé avec détection des intersections

## 🏗️ Structure du projet
```
backend/
├── index.js                    # Point d'entrée Express
├── routes/
│   └── generate.js             # Route /api/generate
├── services/
│   ├── geocoder.js             # Service de géocodage Nominatim
│   ├── overpass.js             # Service Overpass API
│   ├── geojsonConverter.js     # Conversion OSM → GeoJSON
│   ├── rallyFilter.js          # Filtrage des routes rallye
│   └── specialeGenerator.js    # Génération de spéciale
├── utils/
│   └── geometry.js             # Fonctions géométriques
├── package.json
└── README.md
```

## 🚀 Installation
```bash
cd backend
npm install
```

## ⚙️ Configuration

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | 4000 | Port du serveur |

## 🏃 Démarrage
```bash
# Mode développement
npm start

# Ou avec nodemon (si installé)
npm run dev
```

Le serveur démarre sur http://localhost:4000

## 📡 API Endpoints

### `POST /api/generate`

Génère une spéciale de rallye.

**Body (JSON)**
```json
{
  "place": "Gap",
  "postal": "05000",
  "radiusKm": 10
}
```

**Réponse**
```json
{
  "ok": true,
  "center": { "lat": 44.5594, "lon": 6.0789 },
  "radiusMeters": 10000,
  "stats": { "waysCount": 150, "totalKm": 89.5 },
  "geojson": { "type": "FeatureCollection", "features": [...] },
  "intersections": [7, 23, 41, 64, ...],
  "speciales": [[...]]
}
```

### `GET /api/ping`

Health check du serveur.

**Réponse**
```json
{
  "ok": true,
  "version": "backend v4"
}
```

## 🔍 Services

### geocoder.js
Géocode une ville française via l'API Nominatim d'OpenStreetMap.

### overpass.js
Interroge l'API Overpass pour récupérer les routes dans un rayon donné.

### rallyFilter.js
Filtre les routes pour ne garder que celles adaptées au rallye :
- Types autorisés : track, unclassified, road, secondary, tertiary, residential
- Surfaces autorisées : asphalt, gravel, dirt, etc.
- Exclusions : autoroutes, chemins piétons, zones commerciales, etc.

### specialeGenerator.js
Génère le tracé de la spéciale en utilisant un algorithme de graphe et détecte les intersections.

## 📦 Dépendances

- `express` - Framework web
- `axios` - Client HTTP
- `cors` - Middleware CORS
- `osmtogeojson` - Conversion OSM → GeoJSON
- `@turf/turf` - Calculs géospatiaux
- `graphlib` - Algorithmes de graphe

## 🐛 Débogage

Les logs dans la console affichent :
- Les requêtes Overpass envoyées
- Le nombre d'éléments reçus
- Les intersections détectées (indices et nombre de voisins)
