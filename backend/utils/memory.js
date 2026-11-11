/**
 * Mémoire du serveur, pour les logs de la console : RAM totale du processus et tas JavaScript (sur sa limite)
 */
const v8 = require("v8");

const mo = (bytes) => Math.round(bytes / 1e6);

/** Limite du tas JavaScript (réglée par --max-old-space-size dans `npm start`) */
const heapLimitMo = () => mo(v8.getHeapStatistics().heap_size_limit);

/** « RAM 312 Mo · tas 180/384 Mo » */
function memoryLabel() {
  const { rss, heapUsed } = process.memoryUsage();
  return `RAM ${mo(rss)} Mo · tas ${mo(heapUsed)}/${heapLimitMo()} Mo`;
}

module.exports = { memoryLabel, heapLimitMo };
