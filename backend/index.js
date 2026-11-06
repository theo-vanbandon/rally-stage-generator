/**
 * Point d'entrée du backend Rally Stage Generator
 */
const express = require("express");
const cors = require("cors");

const generateRoutes = require("./routes/generate");

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json());

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
