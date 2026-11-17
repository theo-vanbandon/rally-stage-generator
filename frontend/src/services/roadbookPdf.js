/**
 * Roadbook PDF téléchargeable : page de garde (rallye, ordre des épreuves, totaux, plan d'ensemble), puis une
 * section par spéciale ou liaison choisie, dans l'ordre du rallye. Tout est dessiné en vectoriel (tulipes
 * comprises, avec la même géométrie qu'à l'écran) : le fichier reste net à l'impression, en A5 comme en A4.
 *
 * jsPDF n'est chargé qu'au moment du téléchargement (import dynamique) : la page n'est pas alourdie.
 */
import { C, CY, RING_R, branchPoints, exitArrow, roundaboutArc } from "../utils/tulipGeometry";

export const PDF_FORMATS = {
  a5: { label: "A5", width: 148, height: 210, margin: 9, tulip: 19, font: 8 },
  a4: { label: "A4", width: 210, height: 297, margin: 13, tulip: 26, font: 10 },
};

const COLORS = {
  stage: [229, 57, 53],
  liaison: [142, 36, 170],
  text: [27, 32, 39],
  muted: [93, 104, 117],
  rule: [205, 210, 217],
  headBg: [242, 244, 247],
  danger: [198, 40, 40],
  road: [51, 51, 51],
  start: [46, 125, 50],
};
const PT_TO_MM = 0.3528;

// Les polices standard du PDF ne couvrent que le Latin-1 : un seul caractère hors de ce jeu rendrait toute la
// ligne illisible. On remplace donc les quelques signes typographiques utilisés par l'application.
const LATIN1 = {
  "—": "-",
  "–": "-",
  "−": "-",
  "→": "»",
  "←": "«",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "œ": "oe",
  "Œ": "OE",
  "Ÿ": "Y",
  "≈": "~",
  "€": "EUR",
  "⚠": "!",
};
export const pdfText = (value) => String(value ?? "").replace(/[\u0100-\uffff]/g, (ch) => LATIN1[ch] ?? "");

/** Revêtement d'une spéciale en quelques mots */
export function surfaceSummary({ paved = 0, gravel = 0, dirt = 0 }) {
  const unpaved = gravel + dirt;
  if (!unpaved) return "Asphalte";
  if (!paved) return "Terre";
  return `Mixte (${unpaved} % terre)`;
}

/** Nom du fichier : roadbook-rallye-des-routes-du-nord.pdf */
export function roadbookFilename(rallyName, hostTown) {
  const slug = pdfText(rallyName || hostTown || "rallye")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `roadbook-${slug || "rallye"}.pdf`;
}

const fmtKm = (km) => `${km.toFixed(2)} km`;

/* ------------------------------------------------------------------------------------------------------------- */
/* Dessin                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------- */

/** Ligne brisée (points absolus en mm) */
function polyline(doc, pts, { width, color, dash = null, closed = false, fill = null }) {
  if (pts.length < 2) return;
  doc.setLineWidth(width);
  doc.setDrawColor(...color);
  doc.setLineDashPattern(dash ?? [], 0);
  if (fill) doc.setFillColor(...fill);
  const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
  doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], fill ? "FD" : "S", closed);
  doc.setLineDashPattern([], 0);
}

/** Tulipe, mêmes formes qu'à l'écran (voir utils/tulipGeometry), dans un carré de `size` mm */
export function drawTulip(doc, tulip, x, y, size) {
  const k = size / 100;
  const at = ([px, py]) => [x + px * k, y + py * k];
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...COLORS.rule);
  doc.setLineWidth(0.2);
  doc.rect(x, y, size, size, "FD");
  doc.setLineCap("round");
  doc.setLineJoin("round");

  for (const b of tulip.others) {
    const pts = branchPoints(b.path, b.angle).map(at);
    if (b.kind === "major") {
      polyline(doc, pts, { width: 13 * k, color: COLORS.road });
      polyline(doc, pts, { width: 6 * k, color: [255, 255, 255] });
    } else {
      polyline(doc, pts, { width: 4 * k, color: COLORS.road, dash: b.kind === "track" ? [7 * k, 6 * k] : null });
    }
  }
  doc.setFillColor(0, 0, 0);
  if (tulip.entry) {
    const pts = branchPoints(tulip.entryPath, 180).map(at);
    polyline(doc, pts, { width: 8 * k, color: [0, 0, 0] });
    doc.circle(...pts.at(-1), 6 * k, "F");
  } else {
    doc.circle(...at([C, CY]), 5 * k, "F");
  }
  const { line, head } = exitArrow(branchPoints(tulip.exitPath, tulip.exit));
  polyline(doc, line.map(at), { width: 8 * k, color: [0, 0, 0] });
  const [h1, h2, h3] = head.map(at);
  doc.setFillColor(0, 0, 0);
  doc.triangle(h1[0], h1[1], h2[0], h2[1], h3[0], h3[1], "F");

  if (tulip.roundabout) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...COLORS.road);
    doc.setLineWidth(4 * k);
    doc.circle(...at([C, CY]), RING_R * k, "FD");
    polyline(doc, roundaboutArc(tulip.exit).points.map(at), { width: 6 * k, color: [0, 0, 0] });
  }
}

/** Panneau STOP du point stop */
function drawStopSign(doc, x, y, size) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.42;
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = ((i * 45 + 22.5) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  polyline(doc, pts, { width: size * 0.03, color: [255, 255, 255], closed: true, fill: [198, 40, 40] });
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize((size * 0.19) / PT_TO_MM);
  doc.text("STOP", cx, cy, { align: "center", baseline: "middle" });
}

/** Pastille de texte (CH, ASPH., TERRE) */
function drawLabelBox(doc, label, x, y, size, color) {
  const h = size * 0.42;
  doc.setDrawColor(...color);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.5);
  doc.roundedRect(x + size * 0.08, y + (size - h) / 2, size * 0.84, h, 1, 1, "FD");
  doc.setTextColor(...color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize((h * 0.5) / PT_TO_MM);
  doc.text(label, x + size / 2, y + size / 2, { align: "center", baseline: "middle" });
}

/** Colonne « tulipe » d'une case : tulipe, ou symbole */
function drawCaseSymbol(doc, c, x, y, size) {
  if (c.type === "stop") return drawStopSign(doc, x, y, size);
  if (c.tulip) return drawTulip(doc, c.tulip, x, y, size);
  if (c.type === "surface") return drawLabelBox(doc, c.direction.startsWith("Retour") ? "ASPH." : "TERRE", x, y, size, COLORS.text);
  if (c.type === "start") return drawLabelBox(doc, "CH", x, y, size, COLORS.text);
  // Arrivée sans tulipe : damier
  const s = size * 0.12;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      doc.setFillColor(...((i + j) % 2 ? [255, 255, 255] : [0, 0, 0]));
      doc.rect(x + size * 0.14 + i * s, y + size * 0.32 + j * s, s, s, "F");
    }
  }
  return undefined;
}

/** Pastille colorée « ES1 » / « L1 » */
function badge(doc, text, x, y, h, color) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize((h * 0.55) / PT_TO_MM);
  const w = doc.getTextWidth(text) + h * 0.7;
  doc.setFillColor(...color);
  doc.roundedRect(x, y, w, h, h * 0.25, h * 0.25, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + w / 2, y + h / 2, { align: "center", baseline: "middle" });
  return w;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Pages                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

const itemLabel = (item) => (item.kind === "stage" ? `ES${item.number}` : `L${item.number}`);
const itemColor = (item) => (item.kind === "stage" ? COLORS.stage : COLORS.liaison);
const itemTitle = (item) => pdfText(item.kind === "stage" ? item.name || `ES${item.number}` : `Liaison ES${item.from} → ES${item.to}`);
const itemKm = (item) => (item.kind === "stage" ? item.stage.stats.lengthKm : item.liaison.km);

/** Résumé d'une spéciale ou d'une liaison (sous le titre) */
function itemSummary(item) {
  if (item.kind === "liaison") {
    return [`${fmtKm(item.liaison.km)} · temps imparti ${item.minutes} min (moyenne ${item.speed} km/h)`];
  }
  const { stats } = item.stage;
  const loop =
    stats.loop?.kind === "shared"
      ? `boucle de ${stats.loop.lengthKm.toFixed(2)} km, portion commune de ${stats.loop.sharedKm.toFixed(2)} km parcourue 2 fois`
      : stats.loop
        ? `boucle de ${stats.loop.lengthKm.toFixed(2)} km (km ${stats.loop.fromKm.toFixed(2)})`
        : null;
  return [
    [
      fmtKm(stats.lengthKm),
      surfaceSummary(stats.surfacePct),
      stats.elevation ? `D+ ${stats.elevation.gain} m` : null,
      `${stats.junctions} carrefours`,
      item.reversed ? "sens inverse" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    loop,
  ].filter(Boolean);
}

/** Page de garde */
function coverPage(doc, f, { rallyName, hostTown, items, generatedAt }) {
  const { width, height, margin } = f;
  const inner = width - 2 * margin;
  let y = margin + f.font * 0.6;

  doc.setTextColor(...COLORS.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(f.font);
  doc.text("ROADBOOK", margin, y);
  y += f.font * 0.9;

  doc.setTextColor(...COLORS.text);
  doc.setFontSize(f.font * 2.4);
  const title = doc.splitTextToSize(pdfText(rallyName || "Rallye"), inner);
  doc.text(title, margin, y, { baseline: "top" });
  y += title.length * f.font * 2.4 * PT_TO_MM * 1.15 + 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(f.font * 1.3);
  doc.setTextColor(...COLORS.muted);
  if (hostTown) {
    doc.text(pdfText(hostTown), margin, y, { baseline: "top" });
    y += f.font * 1.3 * PT_TO_MM * 1.4;
  }
  doc.setFontSize(f.font * 0.9);
  doc.text(`Généré le ${generatedAt.toLocaleDateString("fr-FR")}`, margin, y, { baseline: "top" });
  y += f.font * 0.9 * PT_TO_MM * 2.2;

  // Ordre du rallye
  doc.setFont("helvetica", "bold");
  doc.setFontSize(f.font);
  doc.setTextColor(...COLORS.muted);
  doc.text("ORDRE DU RALLYE", margin, y, { baseline: "top" });
  y += f.font * PT_TO_MM * 1.6;
  const rowH = f.font * PT_TO_MM * 2.1;
  for (const item of items) {
    doc.setDrawColor(...COLORS.rule);
    doc.setLineWidth(0.2);
    doc.line(margin, y + rowH, width - margin, y + rowH);
    badge(doc, itemLabel(item), margin, y + rowH * 0.18, rowH * 0.64, itemColor(item));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(f.font);
    doc.setTextColor(...COLORS.text);
    const nameX = margin + rowH * 1.9;
    const kmX = width - margin;
    const info =
      item.kind === "stage"
        ? `${surfaceSummary(item.stage.stats.surfacePct)}${item.reversed ? " · sens inverse" : ""}`
        : `temps imparti ${item.minutes} min`;
    doc.text(doc.splitTextToSize(itemTitle(item), inner * 0.42)[0], nameX, y + rowH / 2, { baseline: "middle" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.muted);
    doc.text(pdfText(info), nameX + inner * 0.44, y + rowH / 2, { baseline: "middle" });
    doc.setTextColor(...COLORS.text);
    doc.text(fmtKm(itemKm(item)), kmX, y + rowH / 2, { baseline: "middle", align: "right" });
    y += rowH;
  }

  // Totaux
  const stageKm = items.filter((i) => i.kind === "stage").reduce((s, i) => s + itemKm(i), 0);
  const liaisonKm = items.filter((i) => i.kind === "liaison").reduce((s, i) => s + itemKm(i), 0);
  y += f.font * PT_TO_MM * 1.2;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.text);
  const totals = [`Chronométré : ${fmtKm(stageKm)}`, liaisonKm ? `Liaisons : ${fmtKm(liaisonKm)}` : null, `Total : ${fmtKm(stageKm + liaisonKm)}`];
  doc.text(totals.filter(Boolean).join("   ·   "), margin, y, { baseline: "top" });
  y += f.font * PT_TO_MM * 2.4;

  // Plan d'ensemble : ce qui reste de la page, au-dessus de la mention légale
  const noteH = f.font * 0.85 * PT_TO_MM * 3.2;
  const mapH = height - margin - noteH - y - 2;
  if (mapH > 35) overviewMap(doc, f, items, margin, y, inner, mapH);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(f.font * 0.85);
  doc.setTextColor(...COLORS.muted);
  const note = doc.splitTextToSize(
    "Tracés indicatifs générés automatiquement (données IGN BD TOPO®). À reconnaître sur place et à valider avec les communes et la préfecture.",
    inner
  );
  doc.text(note, margin, height - margin - noteH + 2, { baseline: "top" });
}

/** Plan d'ensemble : spéciales (rouge) et liaisons (violet), numéros d'ES, échelle et nord */
function overviewMap(doc, f, items, x, y, w, h) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(f.font);
  doc.setTextColor(...COLORS.muted);
  doc.text("PLAN D'ENSEMBLE", x, y, { baseline: "top" });
  const top = y + f.font * PT_TO_MM * 1.6;
  const boxH = h - (top - y);
  doc.setDrawColor(...COLORS.rule);
  doc.setLineWidth(0.3);
  doc.rect(x, top, w, boxH, "S");

  const lines = items.map((i) => (i.kind === "stage" ? i.stage.geometry.coordinates : i.liaison.coordinates)).filter((c) => c?.length);
  if (!lines.length) return;
  const all = lines.flat();
  const lat0 = all.reduce((s, c) => s + c[1], 0) / all.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((c) => c[0] * cos);
  const ys = all.map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 6;
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1e-6), (boxH - 2 * pad) / (maxY - minY || 1e-6));
  const ox = x + (w - (maxX - minX) * scale) / 2;
  const oy = top + (boxH - (maxY - minY) * scale) / 2;
  const at = ([lon, lat]) => [ox + (lon * cos - minX) * scale, oy + (maxY - lat) * scale];

  doc.setLineCap("round");
  doc.setLineJoin("round");
  items.forEach((item) => {
    if (item.kind !== "liaison" || !item.liaison.coordinates?.length) return;
    polyline(doc, item.liaison.coordinates.map(at), { width: 0.6, color: COLORS.liaison, dash: [1.4, 1.2] });
  });
  items.forEach((item) => {
    if (item.kind !== "stage") return;
    const pts = item.stage.geometry.coordinates.map(at);
    polyline(doc, pts, { width: 1.1, color: COLORS.stage });
    doc.setFillColor(...COLORS.start);
    doc.circle(...pts[0], 0.9, "F");
    doc.setFillColor(0, 0, 0);
    doc.circle(...pts.at(-1), 0.9, "F");
    badge(doc, `ES${item.number}`, pts[0][0] + 1.2, pts[0][1] - 4.2, 3.6, COLORS.stage);
  });

  // Échelle : une longueur ronde d'environ un quart de la largeur
  const kmPerMm = 111.32 / scale;
  const target = (w / 4) * kmPerMm;
  const nice = [0.5, 1, 2, 5, 10, 20].find((v) => v >= target * 0.6) ?? 20;
  const barW = nice / kmPerMm;
  const bx = x + 4;
  const by = top + boxH - 4;
  doc.setDrawColor(...COLORS.text);
  doc.setLineWidth(0.5);
  doc.line(bx, by, bx + barW, by);
  doc.line(bx, by - 1, bx, by + 0.6);
  doc.line(bx + barW, by - 1, bx + barW, by + 0.6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(f.font * 0.8);
  doc.setTextColor(...COLORS.text);
  doc.text(`${nice} km`, bx + barW + 1.5, by, { baseline: "middle" });
  // Nord
  const nx = x + w - 6;
  const ny = top + 4;
  doc.setFillColor(...COLORS.text);
  doc.triangle(nx, ny, nx - 1.6, ny + 4, nx + 1.6, ny + 4, "F");
  doc.setFont("helvetica", "bold");
  doc.text("N", nx, ny + 6.5, { align: "center", baseline: "top" });
}

/** En-tête d'une section (spéciale ou liaison) ; renvoie l'ordonnée sous l'en-tête */
function sectionHeader(doc, f, item, { continued = false } = {}) {
  const { margin, width } = f;
  const inner = width - 2 * margin;
  let y = margin;
  const h = f.font * PT_TO_MM * 2.6;
  const bw = badge(doc, itemLabel(item), margin, y, h, itemColor(item));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(f.font * 1.5);
  doc.setTextColor(...COLORS.text);
  const title = `${itemTitle(item)}${continued ? " (suite)" : ""}`;
  doc.text(doc.splitTextToSize(title, inner - bw - 3)[0], margin + bw + 3, y + h / 2, { baseline: "middle" });
  y += h + 1.5;
  if (continued) return y + 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(f.font * 0.95);
  doc.setTextColor(...COLORS.muted);
  for (const line of itemSummary(item)) {
    const wrapped = doc.splitTextToSize(pdfText(line), inner);
    doc.text(wrapped, margin, y, { baseline: "top" });
    y += wrapped.length * f.font * 0.95 * PT_TO_MM * 1.3;
  }
  if (item.kind === "liaison" && item.liaison.warnings?.length) {
    doc.setTextColor(...COLORS.danger);
    const wrapped = doc.splitTextToSize(pdfText(`! ${item.liaison.warnings.join(" · ")}`), inner);
    doc.text(wrapped, margin, y, { baseline: "top" });
    y += wrapped.length * f.font * 0.95 * PT_TO_MM * 1.3;
  }
  return y + 2;
}

/** Cases d'une section, en tableau ; nouvelle page (en-tête répété) quand la page est pleine */
function caseTable(doc, f, item) {
  const { margin, width, height, tulip } = f;
  const inner = width - 2 * margin;
  const cols = { n: inner * 0.08, total: inner * 0.13, partial: inner * 0.12, tulip: tulip + 3 };
  cols.info = inner - cols.n - cols.total - cols.partial - cols.tulip;
  const xs = {
    n: margin,
    total: margin + cols.n,
    partial: margin + cols.n + cols.total,
    tulip: margin + cols.n + cols.total + cols.partial,
    info: margin + cols.n + cols.total + cols.partial + cols.tulip,
  };
  const bottom = height - margin - f.font * PT_TO_MM * 2;
  const lineH = f.font * PT_TO_MM * 1.25;
  const roadbook = item.kind === "stage" ? item.stage.roadbook : item.liaison.roadbook;

  const tableHead = (y) => {
    const h = f.font * PT_TO_MM * 1.9;
    doc.setFillColor(...COLORS.headBg);
    doc.rect(margin, y, inner, h, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(f.font * 0.8);
    doc.setTextColor(...COLORS.muted);
    const mid = y + h / 2;
    doc.text("CASE", xs.n + 1, mid, { baseline: "middle" });
    doc.text("TOTAL", xs.total + cols.total - 2, mid, { baseline: "middle", align: "right" });
    doc.text("PARTIEL", xs.partial + cols.partial - 2, mid, { baseline: "middle", align: "right" });
    doc.text("TULIPE", xs.tulip + cols.tulip / 2, mid, { baseline: "middle", align: "center" });
    doc.text("OBSERVATIONS", xs.info + 1, mid, { baseline: "middle" });
    return y + h;
  };

  let y = tableHead(sectionHeader(doc, f, item));
  for (const c of roadbook) {
    // Observations : direction (en gras), route, notes
    doc.setFontSize(f.font);
    const direction = `${c.danger > 0 ? `${"!".repeat(c.danger)} ` : ""}${pdfText(c.direction)}`;
    doc.setFont("helvetica", "bold");
    const dirLines = doc.splitTextToSize(direction, cols.info - 2);
    doc.setFont("helvetica", "normal");
    const roadLines = c.road ? doc.splitTextToSize(pdfText(c.road), cols.info - 2) : [];
    doc.setFontSize(f.font * 0.85);
    const noteLines = c.notes.flatMap((note) => doc.splitTextToSize(pdfText(note), cols.info - 2));
    const textH = (dirLines.length + roadLines.length) * lineH + noteLines.length * lineH * 0.9;
    const rowH = Math.max(tulip + 3, textH + 3);

    if (y + rowH > bottom) {
      doc.addPage();
      y = tableHead(sectionHeader(doc, f, item, { continued: true }));
    }

    const mid = y + rowH / 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(f.font * 1.3);
    doc.setTextColor(...COLORS.text);
    doc.text(String(c.n), xs.n + 1, mid, { baseline: "middle" });
    doc.setFontSize(f.font * 1.1);
    doc.text(c.km.toFixed(2), xs.total + cols.total - 2, mid, { baseline: "middle", align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.muted);
    if (c.n > 1) doc.text(c.partial.toFixed(2), xs.partial + cols.partial - 2, mid, { baseline: "middle", align: "right" });
    drawCaseSymbol(doc, c, xs.tulip + 1.5, y + (rowH - tulip) / 2, tulip);

    let ty = y + (rowH - textH) / 2;
    doc.setFontSize(f.font);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...(c.danger > 0 ? COLORS.danger : COLORS.text));
    doc.text(dirLines, xs.info + 1, ty, { baseline: "top" });
    ty += dirLines.length * lineH;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.text);
    if (roadLines.length) {
      doc.text(roadLines, xs.info + 1, ty, { baseline: "top" });
      ty += roadLines.length * lineH;
    }
    if (noteLines.length) {
      doc.setFontSize(f.font * 0.85);
      doc.setTextColor(...COLORS.muted);
      doc.text(noteLines, xs.info + 1, ty, { baseline: "top", lineHeightFactor: 1.05 });
    }

    y += rowH;
    doc.setDrawColor(...COLORS.rule);
    doc.setLineWidth(0.2);
    doc.line(margin, y, width - margin, y);
  }
}

/** Pied de page : nom du rallye et numéro de page (sauf page de garde) */
function footers(doc, f, rallyName) {
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(f.font * 0.8);
    doc.setTextColor(...COLORS.muted);
    const y = f.height - f.margin / 2;
    doc.text(pdfText(rallyName || "Roadbook"), f.margin, y, { baseline: "middle" });
    doc.text(`${p} / ${total}`, f.width - f.margin, y, { baseline: "middle", align: "right" });
  }
}

/**
 * Construit le roadbook PDF
 * @param {object} options
 * @param {"a5"|"a4"} options.format
 * @param {string} options.rallyName - Nom du rallye (page de garde)
 * @param {string} options.hostTown - Ville d'accueil (page de garde)
 * @param {object[]} options.items - Dans l'ordre du rallye :
 *   { kind: "stage", number, name, stage, reversed } ou { kind: "liaison", number, from, to, liaison, minutes, speed }
 * @param {Date} [options.generatedAt]
 * @returns {Promise<import("jspdf").jsPDF>}
 */
export async function buildRoadbookPdf({ format = "a5", rallyName = "", hostTown = "", items, generatedAt = new Date() }) {
  const { jsPDF } = await import("jspdf");
  const f = PDF_FORMATS[format] ?? PDF_FORMATS.a5;
  const doc = new jsPDF({ unit: "mm", format, orientation: "portrait" });
  doc.setProperties({ title: pdfText(`Roadbook ${rallyName || hostTown || ""}`.trim()), creator: "Rally Stage Generator" });

  coverPage(doc, f, { rallyName, hostTown, items, generatedAt });
  for (const item of items) {
    doc.addPage();
    caseTable(doc, f, item);
  }
  footers(doc, f, rallyName);
  return doc;
}
