# 🎨 Rally Stage Generator - Frontend

Interface React du générateur de spéciales de rallye.

## 📋 Fonctionnalités

- Recherche de commune avec autocomplétion (nom ou code postal, via geo.api.gouv.fr)
- Choix de la zone (5–20 km), du revêtement (asphalte / terre / mixte) et de la longueur
- 3 tracés proposés par génération, cliquables sur la carte. Leurs onglets donnent l'ordre du rallye (ES1, ES2, ES3) : on le change en faisant glisser un onglet sur sa barre (rail horizontal, l'onglet n'en sort pas), ou avec Alt + ← / →. L'ordre est retenu dans le lien partagé (`o=2,3,1`).
- Liaisons entre les ES, dessinées en violet sur la carte : du point stop d'une spéciale au départ de la suivante, sens interdits respectés ; distance et temps estimé de chaque liaison et total, recalculés à chaque changement d'ordre ou de sens. Une liaison est toujours proposée : quand elle ne peut pas éviter toutes les spéciales (demi-tour au stop, traversée, portion empruntée), elle est en pointillés et le compromis est indiqué (⚠). Un badge « ES n » marque le départ de chaque spéciale.
- Les tracés sont réalisables le même jour : ils ne se croisent pas, sont écartés d'au moins 500 m (250 m sur une petite zone) et aucun ne bloque l'accès au départ ou à l'arrivée d'un autre
- Sens inverse en un clic, propre à chaque tracé : même tracé à l'envers, avec son propre roadbook, profil et point stop ; le sens choisi vaut aussi pour l'impression et les exports
- Option **boucle**, deux types :
  - **carrefour** : on repasse une fois par un même carrefour, entouré sur la carte (badge « 2× ») ;
  - **portion commune** : un tronçon est parcouru deux fois dans le même sens ; il est surligné en bleu, avec un badge « 2× ».
  Le roadbook signale chaque passage, et une tuile donne les longueurs de la boucle et de la portion.
- Grosses flèches de sens de la boucle, dessinées à côté du tracé, côté extérieur :
  - elles changent de côté ou disparaissent si elles toucheraient un autre morceau de la spéciale ;
  - elles sont recalculées à chaque zoom.
- Carte avec fonds **Plan IGN**, **photo aérienne IGN** et OpenStreetMap
- Statistiques : longueur, sinuosité, lignes droites, dénivelé, pente max, revêtement
- Profil d'altitude interactif (le survol positionne un repère sur la carte)
- Roadbook d'organisation : cases numérotées (total / partiel), tulipes, dangers, CH/départ, arrivée lancée, point stop ; un clic centre la carte sur la case, dont le point grossit (avec une onde) et affiche son étiquette ; à l'inverse, cliquer un point de la carte surligne sa case dans le roadbook
- Impression du roadbook en A5 ou A4 (ou PDF via « Enregistrer en PDF »), avec n° et nom de l'ES
- Export **GPX**, **KML** et **GeoJSON** :
  - on coche les tracés à exporter (le tracé affiché par défaut, jusqu'aux 3), chacun dans son sens ; KML et GeoJSON : un seul fichier ; GPX : un fichier par spéciale, regroupés dans une archive `.zip` s'il y en a plusieurs ;
  - waypoints : départ, arrivée, point stop, et un waypoint par carrefour de boucle, qui décrit ses deux passages (« 1er passage, km 2.85 : à gauche vers R DES FRENES (entrée dans la boucle) », puis le 2e) ;
  - GPX : une seule trace par fichier, avec altitudes, sans liaison. Chaque lecteur (gpx.studio, Garmin, Strava…) marque le départ et l'arrivée à sa façon, souvent une seule fois par fichier : avec une spéciale par fichier, ces marques tombent toujours sur le vrai départ et la vraie arrivée ; symboles Garmin (drapeaux vert, rouge, bleu) et « Crossing » pour les boucles, que gpx.studio affiche ;
  - KML : un dossier et une couleur par spéciale, la liaison vers le point stop, des icônes Google Earth, les données de chaque point ;
  - GeoJSON : propriétés détaillées et styles simplestyle (couleurs de traces et de marqueurs, pour geojson.io, uMap ou GitHub).
- Mentions légales (éditeur, hébergeur, sources des données, avertissement, données personnelles), accessibles depuis le pied de page ou par l'adresse `#mentions-legales`
- Lien partageable : l'URL contient la zone, les options (dont `b=1` boucle par un carrefour, `b=2` portion commune), la graine, le tracé affiché et les tracés inversés (`sens=1,3`), et régénère exactement la même spéciale

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
