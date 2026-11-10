// Lectura de presupuestos en el navegador. Nada se envía a ningún servidor.
// Devuelve solo lo necesario para el catálogo: grupos, referencias, títulos, textos, medidas y unidades.
// Precios, IVA, totales y datos personales se descartan aquí y no se guardan.
import { normRef, DIM_RE } from './util.js';
import { ocrLines } from './ocr.js';

const MONEY = /^-?\d{1,3}(?:[.\s]\d{3})*,\d{1,2}\s*€?$|^-?\d+(?:[.,]\d{1,2})?\s*€$|^€\s*\d|^-?\d+(?:[.,]\d+)?\s*%$/;
const FISCAL = /\b(i\.?v\.?a|base imponible|subtotal|sub-total|total|importe|dto\.?|descuento|recargo|portes|forma de pago|vencimiento|iban|swift|bic|cuenta|transferencia|validez|condiciones|garant[ií]a|plazo de entrega|precio|pvp|neto|bruto)\b/i;
const PERSONAL = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,                                   // email
  /(?:\+34\s?)?\b[6789]\d{2}(?:[\s.]?\d{3}[\s.]?\d{3}|[\s.]\d{2}[\s.]\d{2}[\s.]\d{2})\b(?!\s*(?:x|×|mm|cm|kg))/i, // teléfono
  /\b(?:nif|cif|n\.i\.f|c\.i\.f|dni|nie)\b/i,
  /\b[A-HJ-NP-SUVW]\d{7}[0-9A-J]\b|\b\d{8}[A-Z]\b|\b[XYZ]\d{7}[A-Z]\b/, // CIF/NIF/NIE
  /\bES\d{2}[\s\d]{20,}/,                                       // IBAN
  /\b(c\/|calle|avda\.?|avenida|pol[ií]gono|p\.i\.|ctra\.?|carretera|plaza|cp\b|c\.p\.)/i,
  /\b(att?\.?|atenci[oó]n|a\/a|cliente|contacto|tel[eé]fono|tlf\.?|m[oó]vil|fax|e-?mail|web)\s*:/i,
];
const OPTION = /^\s*(opci[oó]n|alternativa)\s*(n[ºo°.]?\s*)?(\d+|[a-z])\b/i;
const CODE = /^(?=[A-Z0-9\-./]*\d)(?=[A-Z0-9\-./]*[A-Z])[A-Z0-9][A-Z0-9\-./]{2,22}$/;
const NUMCODE = /^\d{5,10}$/;
const HEAD_KEYS = {
  ref: /\b(ref\.?|referencia|c[oó]d\.?|c[oó]digo|art\.?|art[ií]culo|modelo)\b/i,
  desc: /\b(descripci[oó]n|concepto|denominaci[oó]n|producto|detalle)\b/i,
  qty: /\b(cant\.?|cantidad|uds?\.?|unid\.?|unidades|ud\.)\b/i,
  money: /\b(precio|importe|total|pvp|dto\.?|descuento|neto|p\.\s?unit|€)\b/i,
};

const isPersonal = t => PERSONAL.some(r => r.test(t));
// Importes, porcentajes y € fuera de cualquier texto (también en lecturas OCR, donde no hay columnas)
const MONEY_ANY = [/-?\d{1,3}(?:[.\s]\d{3})*,\d{1,2}\s*€?/g, /-?\d+(?:[.,]\d{1,2})?\s*€/g, /€\s*-?\d[\d.,]*/g, /-?\d+(?:[.,]\d+)?\s*%/g, /€/g];
const stripMoney = t => { let o = t; MONEY_ANY.forEach(r => { o = o.replace(r, ' '); }); return o.replace(/\s+/g, ' ').trim(); };
const hasMoney = t => MONEY_ANY.slice(0, 4).some(r => { r.lastIndex = 0; return r.test(t); });
const isMoney = t => MONEY.test(t.trim());
const upperHeading = t => {
  const s = t.trim();
  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  return s.length <= 60 && letters.length >= 4 && letters === letters.toUpperCase() && !/\d{3,}/.test(s) && s.split(/\s+/).length <= 8;
};

// ── Extracción con posiciones ────────────────────────────────────────────
async function pdfRows(file, onStatus) {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onStatus?.(`Leyendo página ${n} de ${doc.numPages}…`);
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({
      s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 8,
    }));
    if (items.map(i => i.s).join('').replace(/\s/g, '').length < 25) {
      // Página escaneada: OCR local
      onStatus?.(`Página ${n} escaneada: reconociendo texto…`);
      const vp = page.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      const lines = await ocrLines(canvas, p => onStatus?.(`OCR página ${n}: ${Math.round(p * 100)} %`));
      pages.push(lines.map((t, i) => rowFromText(t, n, i)));
      continue;
    }
    items = dedupe(items);
    pages.push(rowsFromItems(items, n));
  }
  return { pages, numPages: doc.numPages };
}

// Textos superpuestos idénticos o casi (negritas simuladas, sombras): fuera si están a < 3 pt
function dedupe(items) {
  const kept = [];
  for (const it of items) {
    const t = it.s.trim();
    const dup = kept.some(k => Math.abs(k.x - it.x) < 3 && Math.abs(k.y - it.y) < 3 &&
      (k.s.trim() === t || k.s.trim().includes(t) || t.includes(k.s.trim())));
    if (!dup) kept.push(it);
  }
  return kept;
}

function rowsFromItems(items, page) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const tol = Math.max(2, it.h * 0.45);
    let r = rows.find(r => Math.abs(r.y - it.y) <= tol);
    if (!r) { r = { page, y: it.y, items: [] }; rows.push(r); }
    r.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of r.items) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x2 : Infinity;
      if (last && gap < Math.max(6, it.h * 0.9)) {
        last.text += (gap > 0.8 ? ' ' : '') + it.s; last.x2 = it.x + it.w;
      } else cells.push({ x: it.x, x2: it.x + it.w, text: it.s });
    }
    cells.forEach(c => c.text = c.text.replace(/\s+/g, ' ').trim());
    return { page, y: r.y, cells: cells.filter(c => c.text), text: cells.map(c => c.text).join(' ').trim() };
  });
}

function rowFromText(t, page, i) {
  const parts = t.split(/\s{2,}|\t|\s\|\s/).map(s => s.trim()).filter(Boolean);
  let x = 0;
  return { page, y: -i, cells: parts.map(p => ({ x: x += 10, x2: x + 5, text: p })), text: parts.join(' ') };
}

// Cabeceras y pies repetidos en varias páginas
function dropRepeated(pages) {
  if (pages.length < 2) return { rows: pages.flat(), removed: 0 };
  const count = new Map();
  pages.forEach(rows => new Set(rows.map(r => r.text.replace(/\d+/g, '#'))).forEach(k => count.set(k, (count.get(k) || 0) + 1)));
  const rep = new Set([...count].filter(([k, n]) => n >= Math.min(2, pages.length) && k.length > 2).map(([k]) => k));
  let removed = 0;
  const rows = pages.flat().filter(r => {
    const k = r.text.replace(/\d+/g, '#');
    if (rep.has(k) && !OPTION.test(r.text)) { removed++; return false; }
    if (/^p[aá]g(ina)?\.?\s*#/i.test(k) || /^#\s*(\/|de)\s*#$/.test(k)) { removed++; return false; }
    return true;
  });
  return { rows, removed };
}

// ── Detección de referencia en una fila ─────────────────────────────────
function findRef(cells, cat, refCol) {
  const scan = refCol != null ? [cells.find(c => c.col === refCol)].filter(Boolean) : cells.slice(0, 3);
  // 1. Código del catálogo en cualquier celda inicial
  for (const [ci, c] of scan.entries()) {
    const dims = [...c.text.matchAll(new RegExp(DIM_RE.source, 'g'))].map(m => [m.index, m.index + m[0].length]);
    let pos = 0;
    for (const [ti, tok] of c.text.split(/\s+/).entries()) {
      const at = c.text.indexOf(tok, pos); pos = at + tok.length;
      if (dims.some(([a, b]) => at >= a && at < b)) continue;           // parte de unas medidas: nunca es referencia
      const t = tok.replace(/[,;:()]+$/g, '');
      const numeric = /^\d+$/.test(t);
      if (numeric && (ci > 0 || ti > 0)) continue;                      // código solo numérico: solo al inicio de la fila
      if (cat.byRef.has(normRef(t)) && normRef(t).length >= 3) return { ref: t, cell: c, known: true };
      // 2. Referencia pegada al título (FG6000Cubeto, PACK7800FiIm): código más largo del catálogo con el que empieza
      const nt = normRef(t);
      if (nt.length >= 7 && /^[A-Z0-9]/i.test(t)) {
        for (let k = nt.length - 2; k >= 5; k--) {
          if (cat.byRef.has(nt.slice(0, k)) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t.charAt(k))) {
            const left = t.slice(0, k);
            if (normRef(left) === nt.slice(0, k)) return { ref: left, cell: c, known: true, glued: t.slice(k) };
          }
        }
      }
      const g = t.match(/^([A-Z0-9][A-Z0-9\-./]*\d[A-Z0-9]*?)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}.*)$/);
      if (g && (cat.byRef.has(normRef(g[1])) || CODE.test(g[1]))) return { ref: g[1], cell: c, known: cat.byRef.has(normRef(g[1])), glued: g[2] };
    }
  }
  // 3. Estructura de código en la primera celda
  const first = scan[0];
  if (first) {
    const tok = first.text.split(/\s+/)[0].replace(/[,;:]+$/, '');
    if ((CODE.test(tok) || NUMCODE.test(tok)) && !DIM_RE.test(tok)) return { ref: tok, cell: first, known: false };
  }
  return null;
}

function parse(rows, cat, cols) {
  const out = { lines: [], discarded: 0, personal: 0 };
  let group = '', started = false, last = null, headerSeen = !cols;
  const refCol = cols?.ref, qtyCol = cols?.qty;
  for (const row of rows) {
    let cells = row.cells.map(c => ({ ...c }));
    if (cols) {
      if (row === cols.headerRow) { headerSeen = true; continue; }
      cells.forEach(c => c.col = cols.colOf(c));
      cells = cells.filter(c => !cols.money.includes(c.col));       // columnas de precio: ni se leen
    }
    const hadMoney = cells.some(c => hasMoney(c.text));
    cells = cells.filter(c => !isMoney(c.text)).map(c => ({ ...c, text: stripMoney(c.text) })).filter(c => c.text);
    const text = cells.map(c => c.text).join(' ').trim();
    if (!text) continue;
    const opt = text.match(OPTION);
    if (opt && !isPersonal(text)) { group = text.replace(/\s+/g, ' ').slice(0, 60).toUpperCase(); last = null; continue; }
    const r = findRef(cells, cat, refCol);
    if ((!r || !r.known) && isPersonal(text)) { out.personal++; last = null; continue; }
    if (r) {
      if (FISCAL.test(text) && !r.known) { out.discarded++; continue; }
      started = true;
      const rest = cells.filter(c => c !== r.cell).map(c => c.text);
      let qty = null;
      const qc = cells.find(c => (qtyCol != null ? c.col === qtyCol : c !== r.cell) && /^\d{1,4}(?:[.,]0+)?$/.test(c.text.trim()));
      if (qc) qty = parseInt(qc.text, 10);
      let body = rest.filter(t => !(qc && t === qc.text)).join(' ').replace(/\s+/g, ' ').trim();
      if (qty == null && hadMoney) {
        const tail = (body || r.cell.text).match(/\s(\d{1,4})$/);
        if (tail) { qty = parseInt(tail[1], 10); if (body) body = body.slice(0, -tail[0].length).trim(); else r.cell.text = r.cell.text.slice(0, -tail[0].length); }
      }
      const sameCellRest = r.cell.text.replace(r.ref, '').replace(r.glued || '', '').trim();
      const full = [r.glued, sameCellRest, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      last = { group, ref: r.ref, title: full.slice(0, 90), text: full, qty, dims: (full.match(DIM_RE) || [''])[0], known: r.known, glued: !!r.glued };
      out.lines.push(last);
      continue;
    }
    if (FISCAL.test(text)) { out.discarded++; last = null; continue; }
    if (!started || !headerSeen) continue;                            // cabecera del documento: no son productos
    if (upperHeading(text)) { group = text.slice(0, 60); last = null; continue; }
    if (last && text.length > 2) {                                   // continuación de la descripción
      last.text = `${last.text} ${stripMoney(text)}`.trim();
      if (!last.dims) last.dims = (text.match(DIM_RE) || [''])[0];
    }
  }
  out.lines.forEach(l => { l.text = l.text.slice(0, 600); });
  return out;
}

function detectColumns(rows) {
  for (const row of rows.slice(0, 80)) {
    const hit = Object.fromEntries(Object.entries(HEAD_KEYS).map(([k, re]) => [k, row.cells.findIndex(c => re.test(c.text))]));
    if (hit.ref >= 0 && (hit.desc >= 0 || hit.qty >= 0)) {
      const xs = row.cells.map(c => c.x);
      const colOf = c => { let best = 0; xs.forEach((x, i) => { if (c.x >= x - 8) best = i; }); return best; };
      const money = row.cells.map((c, i) => HEAD_KEYS.money.test(c.text) && i !== hit.ref && i !== hit.desc ? i : -1).filter(i => i >= 0);
      return { headerRow: row, ref: hit.ref, qty: hit.qty >= 0 ? hit.qty : null, colOf, money };
    }
  }
  return null;
}

function meta(rows) {
  const all = rows.slice(0, 60).map(r => r.text).join('\n');
  const offer = (all.match(/\b(?:oferta|presupuesto|pedido|proforma)\s*(?:n\W{0,3}|num\.?|n[uú]mero)?\W{0,3}([A-Z]{0,5}[-/]?\d[\w\-/]{2,18})/i) || [])[1] || '';
  const d = all.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  const date = d ? `${d[1].padStart(2, '0')}/${d[2].padStart(2, '0')}/${d[3].length === 2 ? '20' + d[3] : d[3]}` : '';
  return { offer, date };
}

/** Punto de entrada: PDF o imagen → resultado estructurado sin datos sensibles */
export async function readQuote(file, cat, onStatus) {
  let pages;
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    pages = (await pdfRows(file, onStatus)).pages;
  } else {
    onStatus?.('Reconociendo texto de la imagen…');
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const scale = bmp.width < 1400 ? 2 : 1;
    canvas.width = bmp.width * scale; canvas.height = bmp.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const lines = await ocrLines(canvas, p => onStatus?.(`Reconociendo texto: ${Math.round(p * 100)} %`));
    pages = [lines.map((t, i) => rowFromText(t, 1, i))];
  }
  const m = meta(pages.flat());
  const { rows, removed } = dropRepeated(pages);
  const byLines = parse(rows, cat, null);
  const cols = detectColumns(rows);
  const byCols = cols ? parse(rows, cat, cols) : null;
  const hits = r => r ? r.lines.filter(l => l.known).length * 2 + r.lines.length : -1;
  const best = hits(byCols) > hits(byLines) ? byCols : byLines;
  return {
    offer: m.offer, date: m.date, lines: best.lines,
    strategy: best === byCols ? 'columnas' : 'líneas',
    stats: { lineas: hits(byLines), columnas: hits(byCols), cabeceras: removed, descartadas: best.discarded, personales: best.personal },
  };
}
