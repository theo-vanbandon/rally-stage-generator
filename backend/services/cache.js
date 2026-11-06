/**
 * Cache mémoire LRU avec expiration, persistance disque optionnelle
 * et mutualisation des requêtes en cours (deux appels identiques = un seul téléchargement)
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

class TtlCache {
  /**
   * @param {object} options
   * @param {number} options.maxEntries - Nombre max d'entrées en mémoire
   * @param {number} options.ttlMs - Durée de vie d'une entrée
   * @param {string|null} [options.diskDir] - Dossier de persistance (null = mémoire seule)
   * @param {number} [options.maxDiskBytes] - Taille max du dossier ; au-delà, les fichiers les plus anciens partent
   * @param {string} [options.diskPrefix] - Préfixe des fichiers de la version courante ; les autres sont obsolètes
   */
  constructor({ maxEntries, ttlMs, diskDir = null, maxDiskBytes = Infinity, diskPrefix = "" }) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.diskDir = diskDir;
    this.maxDiskBytes = maxDiskBytes;
    this.diskPrefix = diskPrefix;
    this.entries = new Map();
    this.inflight = new Map();
    if (diskDir) fs.mkdirSync(diskDir, { recursive: true });
  }

  get(key) {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) {
      // Rafraîchit la position LRU
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    if (hit) this.entries.delete(key);
    return undefined;
  }

  set(key, value) {
    this.entries.set(key, { value, at: Date.now() });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  diskPath(key) {
    return path.join(this.diskDir, `${key.replaceAll(/[^a-z0-9._-]/gi, "_")}.json.gz`);
  }

  readDisk(key) {
    if (!this.diskDir) return undefined;
    try {
      const file = this.diskPath(key);
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs > this.ttlMs) return undefined;
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
    } catch {
      return undefined;
    }
  }

  writeDisk(key, value) {
    if (!this.diskDir) return;
    try {
      fs.writeFileSync(this.diskPath(key), zlib.gzipSync(JSON.stringify(value)));
    } catch (err) {
      console.warn(`Cache disque non écrit: ${err.message}`);
    }
    this.pruneDisk();
  }

  /**
   * Ménage du cache disque : supprime les fichiers expirés ou d'une ancienne version,
   * puis les plus anciens tant que le dossier dépasse maxDiskBytes
   * @returns {{removed: number, totalBytes: number}}
   */
  pruneDisk() {
    if (!this.diskDir) return { removed: 0, totalBytes: 0 };
    let removed = 0;
    const remove = (file) => {
      try {
        fs.unlinkSync(path.join(this.diskDir, file.name));
        removed++;
      } catch {
        // fichier déjà supprimé ou verrouillé : on réessaiera au prochain ménage
      }
    };

    let files;
    try {
      files = fs
        .readdirSync(this.diskDir)
        .filter((name) => name.endsWith(".json.gz"))
        .map((name) => ({ name, ...fs.statSync(path.join(this.diskDir, name)) }));
    } catch {
      return { removed: 0, totalBytes: 0 };
    }

    const now = Date.now();
    const kept = [];
    for (const file of files) {
      if (now - file.mtimeMs > this.ttlMs || !file.name.startsWith(this.diskPrefix)) remove(file);
      else kept.push(file);
    }

    kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let totalBytes = kept.reduce((sum, f) => sum + f.size, 0);
    while (totalBytes > this.maxDiskBytes && kept.length) {
      const oldest = kept.shift();
      remove(oldest);
      totalBytes -= oldest.size;
    }
    return { removed, totalBytes };
  }

  /**
   * Retourne la valeur en cache ou la calcule une seule fois
   * @returns {Promise<{value: any, source: "memory"|"disk"|"fresh"}>}
   */
  async getOrCompute(key, compute, { persist = false } = {}) {
    const mem = this.get(key);
    if (mem !== undefined) return { value: mem, source: "memory" };

    if (persist) {
      const disk = this.readDisk(key);
      if (disk !== undefined) {
        this.set(key, disk);
        return { value: disk, source: "disk" };
      }
    }

    if (!this.inflight.has(key)) {
      const promise = Promise.resolve()
        .then(compute)
        .then((value) => {
          this.set(key, value);
          if (persist) this.writeDisk(key, value);
          return value;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, promise);
    }
    return { value: await this.inflight.get(key), source: "fresh" };
  }
}

const DEFAULT_DISK_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), "rally-stage-generator-cache");

module.exports = { TtlCache, DEFAULT_DISK_DIR };
