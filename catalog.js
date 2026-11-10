// Catálogo en memoria: fichas web Disset (+ series de fabricante sin ficha) y todas sus referencias.
import { normRef, tokens, safeDissetUrl } from './util.js';

export class Catalog {
  constructor(data) {
    this.version = data.v;
    this.F = data.F;                      // familias comerciales
    this.R = data.R; this.A = data.A;     // relaciones (Fase 4)
    this.umbral = data.umbral; this.potenciales = data.potenciales;
    this.products = data.P.map((p, i) => ({
      idx: i, id: p.i, name: p.n, url: safeDissetUrl(p.u), photo: safeDissetUrl(p.f),
      gallery: (p.g || []).map(safeDissetUrl).filter(Boolean), familia: p.fa, seccion: p.s, serie: p.se,
      desc: p.d, isAccessory: !!p.a, accessoryOf: p.ao || [], reglaVariante: p.rv, web: !!p.w,
      tokens: tokens(`${p.n} ${p.se || ''}`),
    }));
    this.byId = new Map(this.products.map(p => [p.id, p]));
    this.variants = data.V.map(([pi, ref, refNorm, detalle, medidas], i) => ({ idx: i, pi, ref, refNorm, detalle, medidas }));
    this.byRef = new Map();
    for (const v of this.variants) {
      if (!this.byRef.has(v.refNorm)) this.byRef.set(v.refNorm, []);
      this.byRef.get(v.refNorm).push(v);
    }
    this.sortedRefs = [...this.byRef.keys()].sort();
  }

  static async load(url = 'catalogo.app.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo cargar el catálogo');
    return new Catalog(await res.json());
  }

  product(i) { return this.products[i]; }
  variantsOf(pi) { return this.variants.filter(v => v.pi === pi); }
  hasRef(r) { return this.byRef.has(normRef(r)); }
  familyLabel(k) { return this.F[k]?.l || ''; }

  /** Busca refs que empiecen por el prefijo (búsqueda binaria sobre la lista ordenada) */
  refsWithPrefix(prefix, limit = 50) {
    const a = this.sortedRefs; let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < prefix) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < a.length && a[i].startsWith(prefix) && out.length < limit; i++) out.push(a[i]);
    return out;
  }

  /** Para el escaparate de la portada: fichas web con foto, de familias variadas */
  showcase(n = 14) {
    const seen = new Set(), out = [];
    const pool = this.products.filter(p => p.web && p.photo && !p.isAccessory);
    for (let i = 0; i < pool.length && out.length < n; i += Math.max(1, Math.floor(pool.length / (n * 3)))) {
      const p = pool[i];
      if (!seen.has(p.familia)) { seen.add(p.familia); out.push(p); }
    }
    return out;
  }
}
