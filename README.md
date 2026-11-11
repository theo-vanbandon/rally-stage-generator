# 🏁 Rally Stage Generator

Générateur automatique de spéciales de rallye sur les petites routes françaises hors agglomération, basé sur la BD TOPO® de l'IGN.

![Rally Stage Generator](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## 📋 Description

Rally Stage Generator génère des tracés de spéciales de rallye autour d'une commune française. Il s'appuie sur le réseau routier de l'IGN (BD TOPO®) pour écarter les villes et villages, privilégier les petites routes étroites et sinueuses, éviter les lignes droites et les allers-retours, puis produit un roadbook (PK à chaque carrefour, avec la direction) et un profil d'altitude.

## ✨ Fonctionnalités

- 🗺️ Spéciales hors agglomération, différentes à chaque clic (3 tracés proposés)
- 🔀 Ordre du rallye par glisser-déposer, et liaisons entre les ES calculées et dessinées sur la carte
- 🤿 Vigilance eau : les rares endroits où des plongeurs peuvent être nécessaires (étendue d'eau importante à l'extérieur d'un virage)
- 🏁 Revêtement au choix : asphalte, terre ou mixte ; longueur courte, moyenne ou longue
- ↻ Option boucle, deux types :
  - **carrefour** : la spéciale recroise son tracé à un carrefour ;
  - **portion commune** : un tronçon est parcouru deux fois dans le même sens, avant et après la boucle.
  Sur la carte, des flèches de sens sont dessinées à l'extérieur de la boucle. Le roadbook note chaque passage.
- 📍 Roadbook : PK à chaque carrefour avec la direction à prendre
- 📊 Statistiques : sinuosité, lignes droites, dénivelé, pente max, revêtement
- 🏔️ Altitudes IGN intégrées et profil interactif
- ⚡ Quelques secondes la première fois sur une zone, instantané ensuite (cache)
- 🔗 Lien partageable qui reproduit exactement la même spéciale
- 📤 Export GPX, KML et GeoJSON d'une ou plusieurs spéciales, dans le sens affiché, avec waypoints typés (départ, arrivée, point stop, carrefours de boucle avec leurs deux passages)

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

1. Chercher une commune (nom ou code postal) et la choisir dans la liste
2. Régler la zone de recherche (5-20 km), le revêtement et la longueur
3. Cliquer sur « Générer la spéciale », puis « Nouvelle spéciale » pour en obtenir d'autres
4. Comparer les 3 tracés proposés, consulter le roadbook et le profil
5. Exporter les tracés choisis ou copier le lien

## 🛠️ Technologies utilisées

### Backend
- Node.js & Express
- IGN BD TOPO® (WFS Géoplateforme) : réseau routier et altitudes
- geo.api.gouv.fr : géocodage des communes
- Générateur maison : marches aléatoires pondérées sur graphe + notation

### Frontend
- React
- Leaflet & React-Leaflet (fonds Plan IGN, photo aérienne, OSM)

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.
