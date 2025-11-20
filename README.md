# 🏁 Rally Stage Generator

Générateur automatique de spéciales de rallye basé sur les données OpenStreetMap.

![Rally Stage Generator](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## 📋 Description

Rally Stage Generator est une application web qui permet de générer automatiquement des tracés de spéciales de rallye autour d'une ville française. L'application utilise les données cartographiques d'OpenStreetMap pour identifier les routes adaptées aux spéciales de rallye et génère un parcours optimisé avec détection automatique des intersections (Points Kilométriques).

## ✨ Fonctionnalités

- 🗺️ Génération automatique de spéciales de rallye
- 📍 Détection automatique des intersections (PK)
- 📊 Statistiques détaillées (longueur, dénivelé, pente moyenne)
- 🏔️ Récupération des données d'altitude réelles
- 📤 Export en GeoJSON, KML et GPX
- 🎨 Visualisation interactive sur carte Leaflet

## 🏗️ Architecture

Le projet est composé de deux parties :
```
rally-stage-generator/
├── backend/          # API Node.js/Express
├── frontend/         # Application React
└── README.md         # Ce fichier
```

- **[Backend](./backend/README.md)** : API REST qui gère la génération des spéciales
- **[Frontend](./frontend/README.md)** : Interface utilisateur React avec carte interactive

## 🚀 Démarrage rapide

### Prérequis

- Node.js (v22 ou supérieur)
- npm ou yarn

### Installation

1. **Cloner le repository**
```bash
git clone https://github.com/votre-username/rally-stage-generator.git
cd rally-stage-generator
```

2. **Installer et démarrer le backend**
```bash
cd backend
npm install
npm start
```

3. **Installer et démarrer le frontend** (dans un autre terminal)
```bash
cd frontend
npm install
npm start
```

4. **Accéder à l'application**

Ouvrir http://localhost:3000 dans votre navigateur.

## 📖 Utilisation

1. Entrer le nom d'une ville française
2. Entrer le code postal correspondant
3. Définir le rayon de recherche (1-50 km)
4. Cliquer sur "Générer la spéciale"
5. Visualiser le tracé sur la carte avec les PK
6. Consulter les statistiques
7. Exporter le tracé au format souhaité

## 🛠️ Technologies utilisées

### Backend
- Node.js & Express
- Overpass API (OpenStreetMap)
- Turf.js (calculs géospatiaux)
- Graphlib (algorithmes de graphe)

### Frontend
- React
- Leaflet & React-Leaflet
- Turf.js
- Axios

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.
