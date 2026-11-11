/**
 * Point d'entrée du backend Rally Stage Generator
 */
const express = require("express");
const cors = require("cors");
const compression = require("compression");

const generateRoutes = require("./routes/generate");
const liaisonRoutes = require("./routes/liaisons");
const waterRoutes = require("./routes/water");

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(compression()); // réponses JSON compressées (spéciale + sens inverse : ~540 Ko → ~140 Ko)
app.use(express.json({ limit: "2mb" })); // calcul des liaisons : tracés des spéciales envoyés par le client

// CORS - Autoriser le frontend en production et en dev
const corsOptions = {
  origin: [
    'http://localhost:3000', // Dev local
    'https://rally-stage-generator-front.onrender.com' // Production
  ],
  credentials: true
};
app.use(cors(corsOptions));

// Routes
app.use("/api/generate", generateRoutes);
app.use("/api/liaisons", liaisonRoutes);
app.use("/api/water", waterRoutes);

// Health check
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, version: "backend v5" });
});

// Démarrage
app.listen(PORT, () => {
  console.log(`🚗 Rally Stage Generator Backend`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`----------------------------------`);
});
