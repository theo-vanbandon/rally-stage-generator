# 🎨 Rally Stage Generator - Frontend

Interface utilisateur React pour le générateur de spéciales de rallye.

## 📋 Description

Le frontend est une application React qui permet de :
- Saisir les paramètres de génération (ville, code postal, rayon)
- Visualiser le tracé sur une carte interactive
- Afficher les Points Kilométriques (PK) aux intersections
- Consulter les statistiques de la spéciale
- Exporter le tracé en différents formats

## 🏗️ Structure du projet
```
frontend/
├── public/
├── src/
│   ├── components/
│   │   ├── MapView/
│   │   │   ├── MapView.jsx       # Carte Leaflet
│   │   │   ├── MapView.css
│   │   │   └── index.js
│   │   ├── RouteGenerator/
│   │   │   ├── RouteGenerator.jsx # Composant principal
│   │   │   ├── RouteGenerator.css
│   │   │   └── index.js
│   │   └── SpecialeStats/
│   │       ├── SpecialeStats.jsx  # Affichage des stats
│   │       ├── SpecialeStats.css
│   │       └── index.js
│   ├── services/
│   │   ├── api.js                 # Appels API backend
│   │   ├── elevationService.js    # Service d'altitude
│   │   └── exportService.js       # Export GeoJSON/KML/GPX
│   ├── utils/
│   │   ├── specialeStats.js       # Calcul des statistiques
│   │   └── geometry.js            # Fonctions géométriques
│   ├── tests/                     # Tests unitaires
│   │   ├── components/
│   │   │   └── SpecialeStats.test.js
│   │   ├── services/
│   │   │   └── exportService.test.js
│   │   └── utils/
│   │       └── geometry.test.js
│   ├── App.js
│   ├── App.test.js
│   └── index.js
├── package.json
└── README.md
```

## 🚀 Installation
```bash
cd frontend
npm install
```

## ⚙️ Configuration

L'URL du backend est configurée dans `src/services/api.js` :
```javascript
const API_BASE_URL = "http://localhost:4000/api";
```

## 🏃 Démarrage
```bash
npm start
```

L'application démarre sur http://localhost:3000

## 🧪 Tests

Le frontend utilise **Jest** et **React Testing Library** pour les tests.
```bash
# Lancer les tests (mode watch)
npm test

# Lancer les tests avec couverture
npm test -- --coverage

# Lancer les tests une seule fois
npm test -- --watchAll=false
```

### Couverture actuelle

| Fichier | Statements | Lignes |
|---------|------------|--------|
| `App.js` | 100% | 100% |
| `geometry.js` | 100% | 100% |
| `exportService.js` | 90% | 100% |
| **Total** | **92.68%** | **100%** |

## 🧩 Composants

### RouteGenerator
Composant principal avec le formulaire de saisie et l'orchestration des autres composants.

### MapView
Carte interactive Leaflet affichant :
- Le tracé de la spéciale (ligne rouge)
- Le marqueur de départ (rouge)
- Le marqueur d'arrivée (bleu)
- Les Points Kilométriques (badges bleus)

### SpecialeStats
Affiche les statistiques de la spéciale :
- Longueur totale
- Nombre d'intersections
- Distance moyenne entre PK
- Altitude min/max
- Dénivelé positif/négatif
- Pente moyenne

## 🔧 Services

### api.js
Gère les appels API vers le backend.

### elevationService.js
Récupère les données d'altitude via l'API Open-Elevation.

### exportService.js
Exporte le tracé en :
- **GeoJSON** : Format standard géospatial
- **KML** : Compatible Google Earth
- **GPX** : Compatible GPS et applications de navigation

## 📦 Dépendances

### Production
- `react` - Framework UI
- `react-leaflet` / `leaflet` - Carte interactive
- `@turf/turf` - Calculs géospatiaux
- `axios` - Client HTTP

### Développement
- `@testing-library/react` - Tests de composants React
- `@testing-library/jest-dom` - Matchers Jest pour le DOM

## 🎨 Personnalisation

### Couleurs des marqueurs
Les icônes sont définies dans `MapView.jsx` :
- Départ : marqueur rouge
- Arrivée : marqueur bleu
- PK : badge bleu avec texte blanc

### Style de la carte
Le style CSS est dans `MapView.css` et `RouteGenerator.css`.

## 🐛 Débogage

Ouvrir la console du navigateur (F12) pour voir :
- Les données GeoJSON reçues
- Les intersections détectées
- Les PK calculés avec leur distance
