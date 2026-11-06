# 🎨 Rally Stage Generator - Frontend

Interface React du générateur de spéciales de rallye.

## 📋 Fonctionnalités

- Recherche de commune avec autocomplétion (nom ou code postal, via geo.api.gouv.fr)
- Choix de la zone (5–20 km), du revêtement (asphalte / terre / mixte) et de la longueur
- 3 tracés proposés par génération, cliquables sur la carte
- Sens inverse en un clic : même tracé à l'envers, avec son propre roadbook, profil et point stop
- Carte avec fonds **Plan IGN**, **photo aérienne IGN** et OpenStreetMap
- Statistiques : longueur, sinuosité, lignes droites, dénivelé, pente max, revêtement
- Profil d'altitude interactif (le survol positionne un repère sur la carte)
- Roadbook d'organisation : cases numérotées (total / partiel), tulipes, dangers, CH/départ, arrivée lancée, point stop ; un clic centre la carte sur la case
- Impression du roadbook en A5 ou A4 (ou PDF via « Enregistrer en PDF »), avec n° et nom de l'ES
- Export **GPX** (avec altitudes et waypoints PK), **KML** (3D) et **GeoJSON**
- Mentions légales (éditeur, hébergeur, sources des données, avertissement, données personnelles), accessibles depuis le pied de page ou par l'adresse `#mentions-legales`
- Lien partageable : l'URL contient la zone, les options, la graine, le tracé affiché et le sens, et régénère exactement la même spéciale

## 🏗️ Structure
```
frontend/src/
├── components/
│   ├── RouteGenerator/   # Page principale : formulaire, résultats, état, URL partageable
│   ├── CommuneSearch/    # Champ commune avec suggestions
│   ├── MapView/          # Carte Leaflet (tracés, PK, départ/arrivée, zone de recherche)
│   ├── SpecialeStats/    # Tuiles de statistiques
│   ├── ElevationProfile/ # Profil altimétrique SVG
│   ├── LegalNotice/      # Mentions légales
│   ├── Roadbook/         # Roadbook à l'écran (cases + symboles)
│   ├── RoadbookPrint/    # Roadbook imprimable A5
│   └── Tulip/            # Dessin SVG d'une tulipe
├── services/
│   ├── api.js            # Backend + API des communes
│   └── exportService.js  # Export GPX / KML / GeoJSON
├── utils/
│   └── geometry.js       # Distances, interpolation le long du tracé
└── tests/                # Tests (Jest + React Testing Library)
```

## ⚙️ Configuration

URL du backend : variable `REACT_APP_API_URL` (défaut `http://localhost:4000/api`). En production elle est définie dans `.env.production`.

## 🏃 Démarrage
```bash
npm install
npm start        # http://localhost:3000
```

## 🧪 Tests
```bash
npm test -- --watchAll=false
npm test -- --coverage --watchAll=false
```
