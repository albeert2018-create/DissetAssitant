// Identificación: corrección aprendida → código exacto → inicio de código → nombre / descripción.
import { normRef, tokens, jaccard } from './util.js';
import { db } from './db.js';

export const STATUS = { OK: 'seguro', REVIEW: 'revisar', NONE: 'sin_ficha' };

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
    if (ref) {
      const c = this.corr.get(ref);
      if (c) {
        const v = this.cat.variants[c.vi];
        if (v && v.refNorm === c.refNorm) return this.res(v, 0.97, `Corrección guardada: ${line.ref} → ${v.ref}`);
      }
      const exact = this.cat.byRef.get(ref);
      if (exact) {
        const fichas = new Set(exact.map(v => v.pi));
        const v = this.pick(exact, tq);
        return this.res(v, fichas.size === 1 ? 1 : 0.9, fichas.size === 1 ? 'Código exacto' : `Código exacto en ${fichas.size} fichas; elegida la más parecida`);
      }
      if (ref.length >= 4) {
        // La referencia del presupuesto es más corta (sin color/acabado) o más larga que la del catálogo
        let cands = this.cat.refsWithPrefix(ref, 40).flatMap(r => this.cat.byRef.get(r));
        if (!cands.length) {
          for (let k = ref.length - 1; k >= Math.max(4, ref.length - 4) && !cands.length; k--) {
            const base = ref.slice(0, k);
            if (this.cat.byRef.has(base)) cands = this.cat.byRef.get(base);
          }
        }
        if (cands.length) {
          const fichas = new Set(cands.map(v => v.pi));
          const v = this.pick(cands, tq);
          const conf = fichas.size === 1 ? 0.9 : 0.7;
          return this.res(v, conf, fichas.size === 1
            ? `Inicio de código: ${line.ref} ≈ ${v.ref} (misma ficha)`
            : `Inicio de código: ${fichas.size} fichas posibles`);
        }
      }
    }
    if (tq.length >= 2) {
      let best = null, bs = 0;
      for (const p of this.cat.products) {
        if (!p.web) continue;
        const s = jaccard(tq, p.tokens);
        if (s > bs) { bs = s; best = p; }
      }
      if (best && bs >= 0.34) {
        const v = this.cat.variants.find(x => x.pi === best.idx) || { idx: null, pi: best.idx, ref: '' };
        return { vi: v.idx, pi: best.idx, confidence: Math.round(Math.min(0.75, 0.35 + bs) * 100) / 100,
                 why: `Nombre parecido (${Math.round(bs * 100)} %)`, status: STATUS.REVIEW };
      }
    }
    return this.res(null, 0, ref ? 'Referencia no encontrada en el catálogo' : 'Sin referencia reconocible');
  }

  /** El comercial corrige: se guarda para que la próxima lectura acierte sola */
  async learn(rawRef, variant) {
    const key = normRef(rawRef);
    if (!key || !variant || key === variant.refNorm) return;
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
