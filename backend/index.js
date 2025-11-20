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
app.use(cors());

// Routes
app.use("/api/generate", generateRoutes);

// Health check
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, version: "backend v4" });
});

// Démarrage
app.listen(PORT, () => {
  console.log(`🚗 Rally Stage Generator Backend`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`----------------------------------`);
});
