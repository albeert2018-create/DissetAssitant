// Identificación: corrección aprendida → código exacto → inicio de código → nombre / descripción.
import { normRef, tokens, jaccard } from './util.js';
import { db } from './db.js';

export const STATUS = { OK: 'seguro', REVIEW: 'revisar', NONE: 'sin_ficha' };

// Códigos creados en el momento para una oferta (KF0000, KF00478…): no dicen nada del producto y se reutilizan.
// Se identifican por la descripción y las correcciones se aprenden contra la descripción, no contra el código.
export const AD_HOC = /^KF\d/;
// Cómo se escribe en los presupuestos → cómo lo llama la web
const SINONIMOS = { malla: 'rejadas', mallado: 'rejadas', rejilla: 'rejadas', enrejado: 'rejadas', inox: 'inoxidable',
  galvanizada: 'galvanizado', taquilla: 'taquillas', estanteria: 'estanterias', jaula: 'roll' };
const tituloClave = line => 'KF:' + tokens(line.title || line.text || '').filter(t => t.length > 2 && !/\d/.test(t)).slice(0, 8).join(' ');
/** Clave con la que se guarda y busca una corrección */
export const correctionKey = line => (AD_HOC.test(normRef(line.ref)) ? tituloClave(line) : normRef(line.ref));

export class Matcher {
  constructor(catalog, corrections = []) {
    this.cat = catalog;
    this.corr = new Map(corrections.map(c => [c.key, c]));
  }
  static async create(catalog) { return new Matcher(catalog, await db.all('corrections')); }

  /** Elige la mejor variante entre candidatas: prioriza ficha web y parecido con el texto del presupuesto */
  pick(cands, tq) {
    if (cands.length === 1) return cands[0];
    let best = cands[0], bs = -1;
    for (const v of cands) {
      const p = this.cat.product(v.pi);
      const s = (p.web ? 1 : 0) + jaccard(tq, p.tokens);
      if (s > bs) { bs = s; best = v; }
    }
    return best;
  }

  res(v, confidence, why) {
    const status = !v ? STATUS.NONE : confidence >= 0.9 ? STATUS.OK : STATUS.REVIEW;
    return { vi: v ? v.idx : null, pi: v ? v.pi : null, confidence: Math.round(confidence * 100) / 100, why, status };
  }

  match(line) {
    const ref = normRef(line.ref);
    const tq = tokens(`${line.title || ''} ${line.text || ''}`);
    if (ref && AD_HOC.test(ref)) return this.matchAdHoc(line, ref, tq);
    if (ref) {
      const c = this.corr.get(ref);
      if (c) {
        const v = this.cat.variants[c.vi];
        if (v && v.refNorm === c.refNorm) return this.res(v, 0.97, `Corrección guardada: ${line.ref} → ${v.ref}`);
      }
      let exact = this.cat.byRef.get(ref);
      if (!exact) {   // confusiones típicas de OCR o de tecleo: O↔0, I/L↔1 en la parte numérica
        const alt = ref.replace(/(?<=\d)[OIL]|[OIL](?=\d)/g, ch => ({ O: '0', I: '1', L: '1' })[ch]);
        if (alt !== ref) exact = this.cat.byRef.get(alt);
      }
      if (exact) {
        const fichas = new Set(exact.map(v => v.pi));
        const v = this.pick(exact, tq);
        return this.res(v, fichas.size === 1 ? 1 : 0.9, fichas.size === 1 ? 'Código exacto' : `Código exacto en ${fichas.size} fichas; elegida la más parecida`);
      }
      if (ref.length >= 4) {
        // La referencia del presupuesto es más corta (sin color/acabado) o más larga que la del catálogo
        let cands = this.cat.refsWithPrefix(ref, 40).flatMap(r => this.cat.byRef.get(r)), corto = 0;
        if (!cands.length) {
          for (let k = ref.length - 1; k >= Math.max(5, ref.length - 2) && !cands.length; k--) {
            const base = ref.slice(0, k);
            if (this.cat.byRef.has(base)) cands = this.cat.byRef.get(base);
          }
        }
        // Variante de color o acabado: mismo código salvo los 1–2 últimos caracteres (FCEP1050708 ≈ FCEP1050704)
        if (!cands.length && ref.length >= 7) {
          for (corto = 1; corto <= 2 && !cands.length; corto++) cands = this.cat.refsWithPrefix(ref.slice(0, -corto), 60).flatMap(r => this.cat.byRef.get(r));
          corto--;
        }
        if (cands.length) {
          const fichas = new Set(cands.map(v => v.pi));
          if (fichas.size > 1) { const n = this.porNombre(line); if (n) return n; }   // varias fichas: manda el nombre
          const v = this.pick(cands, tq);
          const conf = fichas.size === 1 ? (corto ? 0.9 : 0.9) : 0.7;
          return this.res(v, conf, fichas.size === 1
            ? (corto ? `Variante de ${v.ref} (cambia el final del código: color o acabado)` : `Inicio de código: ${line.ref} ≈ ${v.ref} (misma ficha)`)
            : `Inicio de código: ${fichas.size} fichas posibles`);
        }
      }
    }
    if (tq.length >= 2) { const n = this.porNombre(line); if (n) return n; }
    return this.res(null, 0, ref ? 'Referencia no encontrada en el catálogo' : 'Sin referencia reconocible');
  }

  /** Código creado para la oferta: manda la descripción */
  matchAdHoc(line, ref, tq) {
    const c = this.corr.get(tituloClave(line));
    if (c) { const v = this.cat.variants[c.vi]; if (v && v.refNorm === c.refNorm) return this.res(v, 0.95, `Código de oferta (${line.ref}). Corrección guardada para esta descripción → ${v.ref}`); }
    const exact = this.cat.byRef.get(ref);
    if (exact) {   // coincide con un código real del catálogo: solo vale si la descripción también encaja
      const v = this.pick(exact, tq), p = this.cat.product(v.pi);
      const t = tokens(line.title || '').filter(x => x.length > 2 && !/\d/.test(x));
      const n = t.filter(x => p.tokens.some(y => y === x || (Math.min(x.length, y.length) >= 4 && (y.startsWith(x) || x.startsWith(y))))).length;
      if (n >= 2 && n / Math.max(1, t.length) >= 0.5) return this.res(v, 0.9, 'Código exacto y la descripción coincide');
    }
    const n = this.porNombre(line);
    if (n) { n.why = `Código creado para esta oferta (${line.ref}): identificado por la descripción. Confírmalo o corrígelo`; return n; }
    return this.res(null, 0, `Código creado para esta oferta (${line.ref}) y sin ficha parecida en la web`);
  }

  /** Por nombre: la ficha web que más palabras comparte con el título del presupuesto. Siempre «por confirmar».
   *  Exige al menos 2 palabras significativas en común y la mitad del título. */
  porNombre(line) {
    const titulo = tokens(line.title || line.text || '').filter(t => t.length > 2 && !/^\d/.test(t)).slice(0, 10).map(t => SINONIMOS[t] || t);
    if (titulo.length < 2) return null;
    const best = this.search(titulo.join(' '), 1)[0];
    if (!best) return null;
    const p = this.cat.product(best.pi);
    const hit = (t, pt) => pt.some(x => x === t || (Math.min(x.length, t.length) >= 4 && (x.startsWith(t) || t.startsWith(x))));
    const n = titulo.filter(t => hit(t, p.tokens)).length, cov = n / titulo.length;
    if (!p.web || n < 2 || cov < 0.5) return null;
    const v = best.idx != null ? best : this.cat.variants.find(x => x.pi === p.idx) || { idx: null, pi: p.idx };
    return { vi: v.idx ?? null, pi: p.idx, confidence: Math.round(Math.min(0.75, 0.3 + cov * 0.5) * 100) / 100,
             why: `Código no publicado en la web. Ficha parecida por nombre (${Math.round(cov * 100)} %): confírmala o corrígela`, status: STATUS.REVIEW };
  }

  /** El comercial corrige: se guarda para que la próxima lectura acierte sola */
  async learn(line, variant) {
    const key = correctionKey(line);
    if (!key || key === 'KF:' || !variant || key === variant.refNorm) return;
    const c = { key, vi: variant.idx, refNorm: variant.refNorm, ref: variant.ref, at: new Date().toISOString() };
    this.corr.set(key, c);
    await db.put('corrections', c);
  }

  /** Búsqueda manual: por código (exacto o inicio) y por texto */
  search(q, n = 8) {
    const r = normRef(q), out = [], seen = new Set();
    const add = v => { if (v && !seen.has(v.pi) && out.length < n) { seen.add(v.pi); out.push(v); } };
    if (r.length >= 2) {
      (this.cat.byRef.get(r) || []).forEach(add);
      for (const k of this.cat.refsWithPrefix(r, 60)) (this.cat.byRef.get(k) || []).forEach(add);
    }
    if (out.length < n) {
      const tq = tokens(q);
      if (tq.length) {
        // cobertura: cuántas palabras buscadas están en la ficha (acepta plurales: «rampa» ↔ «rampas»)
        const hit = (t, pt) => pt.some(x => x === t || (t.length >= 4 && (x.startsWith(t) || t.startsWith(x)) && Math.min(x.length, t.length) >= 4));
        this.cat.products.map(p => {
          const cov = tq.filter(t => hit(t, p.tokens)).length / tq.length;
          return [p, cov + 0.25 * jaccard(tq, p.tokens) + (p.web ? 0.02 : 0) - (p.isAccessory ? 0.05 : 0)];
        })
          .filter(([, s]) => s > 0.3).sort((a, b) => b[1] - a[1]).slice(0, n * 2)
          .forEach(([p]) => add(this.cat.variants.find(v => v.pi === p.idx) || { idx: null, pi: p.idx, ref: '' }));
      }
    }
    return out;
  }
}
