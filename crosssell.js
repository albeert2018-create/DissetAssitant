// Motor de venta cruzada. Seis posiciones: 1 y 3 = potenciales de dirección; 2, 4, 5 y 6 por puntuación comercial.
// Fuentes: A completa tu pedido · B relaciones del Excel (≥ umbral) · D segundo nivel · E misma sección.
// El % es compatibilidad comercial, NO probabilidad de compra.

import { jaccard, tokens } from './util.js';

// «Máximo una de…»: familias que cuentan como el mismo grupo
const GRUPOS = [
  [/^cajas_|^accesorios_cajas$/, 'cajas'], [/^estanterias_|^estructuras_picking$/, 'estanterias'],
  [/^armarios_vestuario$/, 'taquillas'], [/^armarios_/, 'armarios'], [/^sillas$/, 'sillas'],
  [/^mesas_|^bancos_trabajo$/, 'mesas'], [/^carros_|^roll_containers$/, 'carros'],
  [/^transpaletas_|^apiladores$/, 'manutencion'], [/^palets_/, 'palets'],
];
export const grupo = fa => (GRUPOS.find(([re]) => re.test(fa || '')) || [0, fa])[1];

const CON_RUEDAS = /^(transpaletas_|apiladores$|tractores_arrastre$|carros_motorizados$)/;
const NO_PRINCIPAL = /^(accesorios?|equipamiento adicional|cerramientos|soportes?|recambios?|repuestos?|kit de)\b/i;
const ESPECIAL = /especial|cantilever|m[oó]vil|compact|drive|din[aá]mic|autoportante|entreplanta|altillo|inflamables|contaminantes|inoxidable|cerramiento/i;
const PICKING = new Set(['almacen_picking', 'taller_produccion', 'puesto_trabajo']);
// Palabras del razonamiento que no ayudan a elegir producto
const VACIAS = new Set('zona zonas pedido cliente mismo misma puesto antes cuando junto sobre todo menos mas solo bajo uso producto productos'.split(' '));
// Nombre que debe tener la ficha elegida como potencial (evita «palet porta barras» como estantería)
const NOMBRE_POT = { armarios_vestuario: /taquill|vestuario|armario/i, cajas_athena: /caja/i, cajas_nexit: /caja/i };
const NOMBRE_EST = /estanter|estructura/i;
// Fichas de nicho: solo si el pedido o la relación hablan de ese nicho
const NICHO = /dom[eé]stic|motocicleta|ganado|patinaje|niños|hospital|deportiv|gimnasio|lavander|hotel|comedor|ESD|ATEX|antiexplosi|soldadura|ladrillos|adoquines/i;
const QUIMICOS = /^(armarios_seguridad|almacenes_quimicos|cubetos_retencion|bidones_seguridad|manipulacion_bidones|absorbentes)$/;

// Textos de los potenciales (tarjetas 1 y 3)
const POT = {
  armarios_vestuario: ['Taquillas para el personal: cualquier cliente con plantilla necesita vestuario.', 'Venta sencilla de sumar al mismo pedido y que se repite al crecer la plantilla.'],
  estructuras_picking: ['El pedido apunta a picking: estructuras para trabajar con cajas a mano.', 'Ordena la preparación de pedidos y saca partido de las cajas.'],
  estanterias_ligeras: ['Almacenaje ligero para recambios, consumibles y pequeño material.', 'Montaje sin tornillos y ampliable por módulos.'],
  estanterias_longspan: ['Cargas medias y bultos largos que no caben en estantería ligera.', 'Más carga por nivel sin pasar a paletización.'],
  estanterias_paletizacion: ['El cliente mueve palets: almacenaje en altura para ganar espacio.', 'Aprovecha la altura de la nave y ordena las ubicaciones.'],
  cajas_athena: ['Almacén y transporte: caja Norma Europa 600×400, apilable y robusta.', 'Módulo estándar sobre palet 1200×800 y en estanterías.'],
  cajas_nexit: ['Picking y puestos de trabajo: cajas de logística para tener el material a mano.', 'Encajan en estructuras de picking y bancos de trabajo.'],
};

// ── Notas del cliente como pista ─────────────────────────────────────────
// Palabras que no dicen qué producto quiere el cliente
const NOTA_VACIAS = new Set(('quiere quieren necesita necesitan pide piden tambien también cliente clientes llamar llamada llamo jueves lunes martes miercoles miércoles viernes sabado domingo semana mes '
  + 'plazo entrega precio presupuesto oferta hablar habla dice dicho comentado interesa interesado gerencia compras pedido pedir mandar enviar enviado catalogo catálogo ver mirar '
  + 'para con sin que los las del una unos unas por mas más muy bien todo toda todos todas este esta estos estas ese esa eso tiene tienen hay hacer poner otro otra otros otras '
  + 'antes despues después ahora luego hoy mañana manana tarde pronto rapido rápido urgente cuanto cuantos cuando donde como sobre entre hasta desde nave empresa persona personas '
  + 'nuevo nueva nuevos nuevas grande grandes pequeño pequeña algo alguna alguno').split(' '));
function notaTokens(texto) {
  return [...new Set(tokens(texto).filter(t => t.length >= 4 && !/^\d/.test(t) && !NOTA_VACIAS.has(t)))];
}
// misma palabra o plural/singular (báscula ≠ basculante)
const notaHit = (t, pt) => pt.some(x => x === t || (x.startsWith(t) && x.length - t.length <= 2) || (t.startsWith(x) && t.length - x.length <= 2));

export class CrossSell {
  /**
   * @param cat      Catálogo
   * @param quote    presupuesto con lines[].match.pi
   * @param learning Map clave → {added, discarded} (aprendizaje local de este ordenador)
   */
  constructor(cat, quote, learning = new Map(), opts = {}) {
    this.cat = cat; this.L = learning;
    this.muy = opts.muyCompatible ?? 70;
    if (!cat._vby) { cat._vby = new Map(); for (const v of cat.variants) { if (!cat._vby.has(v.pi)) cat._vby.set(v.pi, []); cat._vby.get(v.pi).push(v); } }
    this.ctx = this.contexto(quote);
    this.nota = notaTokens((quote.notas || []).map(n => n.texto).join(' . '));   // lo que el cliente ha dicho (solo en local)
    this.byKey = new Map(); this.cov = new Map();
    this.q1 = this.potencial(1); this.q3 = this.potencial(3);
    this.general = this.generales();
  }

  // ── Situación comercial del presupuesto ────────────────────────────────
  contexto(quote) {
    const cat = this.cat, F = cat.F;
    const c = { pis: new Set(), fams: new Map(), series: new Set(), grupos: new Set(), secciones: new Map(), toks: new Set(), dims: new Set(), usos: new Set(), lines: 0 };
    for (const l of quote.lines || []) {
      if (l.include === false || l.match?.pi == null) continue;
      const p = cat.product(l.match.pi); c.lines++;
      c.pis.add(p.idx);
      if (p.familia) { c.fams.set(p.familia, (c.fams.get(p.familia) || 0) + 1); c.grupos.add(grupo(p.familia)); c.usos.add(F[p.familia]?.u); }
      if (p.serie) c.series.add(p.serie);
      if (p.seccion) c.secciones.set(p.seccion, (c.secciones.get(p.seccion) || 0) + 1);
      p.tokens.forEach(t => c.toks.add(t));
      const v = l.match.vi != null ? cat.variants[l.match.vi] : null;
      for (const d of v?.medidas || []) if (d) c.dims.add(d);
      for (const d of String(l.dims || '').match(/\d{3,4}/g) || []) c.dims.add(+d);
    }
    const fams = [...c.fams.keys()];
    c.main = [...c.fams.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    c.movil = fams.some(f => F[f]?.m && !CON_RUEDAS.test(f));
    c.palets = fams.some(f => /^palets_|^contenedores_metalicos$/.test(f));
    c.transporte = fams.some(f => ['manutencion', 'reparto'].includes(F[f]?.u) || (F[f]?.m && ['almacen_transporte', 'obra_exterior'].includes(F[f]?.u)));
    c.estatico = fams.some(f => F[f]?.e);
    c.tokArr = [...c.toks];
    c.nombres = [...c.pis].map(i => cat.product(i).name).join(' ');
    return c;
  }

  // ── Aprendizaje local ──────────────────────────────────────────────────
  lkey(p) { return `${this.ctx.main}|${p.id}`; }
  ajuste(p) {
    const r = this.L.get(this.lkey(p));
    if (!r) return 0;
    return 6 * Math.min(r.added || 0, 3) - 12 * (r.discarded || 0);
  }
  bloqueado(p) { return (this.L.get(this.lkey(p))?.discarded || 0) >= 2; }   // dos descartes en esta situación: no vuelve

  // ── Productos representativos de una familia ───────────────────────────
  /** Mejores fichas de una familia. `texto` = lo que pide la relación («Film para asegurar…»): manda sobre todo lo demás.
   *  La primera palabra es el producto que se busca y pesa más. Guarda en this.cov cuánto encaja cada ficha con el texto. */
  mejores(fa, n = 2, filtro = () => true, texto = '') {
    const q = tokens(texto).filter(t => !VACIAS.has(t) && t.length > 2);
    const w = q.map((_, i) => 1 / (1 + i * 0.35)), wt = w.reduce((a, b) => a + b, 0) || 1;
    const hit = (t, pt) => pt.some(x => x === t || (Math.min(x.length, t.length) >= 4 && (x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5))))
      || (t.length >= 6 && x.includes(t)) || (x.length >= 6 && t.includes(x)));
    return this.cat.products
      .filter(p => p.familia === fa && p.web && !p.isAccessory && !NO_PRINCIPAL.test(p.name) && !this.ctx.pis.has(p.idx) && filtro(p))
      .map(p => {
        const cov = q.length ? q.reduce((a, t, i) => a + (hit(t, p.tokens) ? w[i] : 0), 0) / wt : 0;
        const cabeza = q.length && p.tokens[0] && hit(q[0], [p.tokens[0]]) ? 0.5 : 0;   // «Film de embalaje» para «Film…»
        this.cov.set(p.idx, cov);
        return [p, 1.6 * cov + cabeza + 0.4 * jaccard(this.ctx.tokArr, p.tokens) + (p.photo ? 0.3 : 0)
          + ((this.cat._vby.get(p.idx) || []).length ? 0.4 : 0) + this.ajuste(p) / 100
          + 0.6 * this.nota.filter(t => notaHit(t, p.tokens)).length
          - (NICHO.test(p.name) && !NICHO.test(texto) && !NICHO.test(this.ctx.nombres) ? 0.8 : 0)];
      })
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  }

  /** Si la ficha elegida no es lo que describe la relación, no se le atribuye ese motivo concreto */
  motivoDe(p, r) {
    return (this.cov.get(p.idx) || 0) >= 0.3 ? r.motivo : `Complemento habitual: ${this.cat.familyLabel(p.familia).toLowerCase()}. ${r.beneficio}`;
  }

  cand(p, o) {
    const key = `p${p.idx}`;
    const prev = this.byKey.get(key);
    const score = Math.max(0, Math.min(99, Math.round(o.score + this.ajuste(p) + (o.fuente !== 'N' ? Math.min(20, 8 * this.nota.filter(t => notaHit(t, p.tokens)).length) : 0))));
    if (prev && !(o.slot && !prev.slot) && prev.score >= score) return prev;   // nos quedamos con la mejor razón
    let motivo = o.motivo || '';
    const enNota = o.fuente === 'N' ? [] : this.nota.filter(t => notaHit(t, p.tokens));
    if (enNota.length) { o = { ...o, score: o.score + Math.min(20, 8 * enNota.length) }; motivo = `Encaja con tus notas («${enNota.slice(0, 3).join('», «')}»). ` + motivo; }
    if (QUIMICOS.test(p.familia) && !o.slot) motivo += ' Comprobar compatibilidad con el producto almacenado.';
    const c = { key, pi: p.idx, fa: p.familia, grupo: grupo(p.familia), serie: p.serie || '', slot: o.slot || 0, tipo: o.tipo,
      fuente: o.fuente, score, motivo: motivo.trim(), beneficio: o.beneficio || '', evidencia: o.evidencia || '', regla: o.regla || '' };
    c.badge = c.slot ? 'Potencial' : c.fuente === 'N' ? 'Según tus notas' : c.tipo === 'Completa tu pedido' ? 'Completa tu pedido'
      : c.fuente === 'B' && score >= this.muy ? 'Muy compatible' : c.fuente === 'B' && score >= this.cat.umbral ? 'Compatible' : 'Oportunidad';
    this.byKey.set(key, c);
    return c;
  }

  // ── Tarjetas 1 y 3: potenciales de dirección ───────────────────────────
  potencial(slot) {
    const ctx = this.ctx, out = [];
    const fams = this.cat.potenciales.filter(x => x.slot === slot)
      .flatMap(x => x.familias.split('/').map(s => s.trim()).filter(Boolean));
    let orden;
    if (slot === 1) {
      const pref = ctx.usos.has('almacen_picking') ? ['estructuras_picking', 'estanterias_ligeras']
        : ctx.usos.has('taller_produccion') || ctx.usos.has('mantenimiento') ? ['estanterias_ligeras', 'estructuras_picking']
        : ctx.usos.has('almacen_carga') || ctx.palets || ctx.usos.has('manutencion') && !ctx.movil ? ['estanterias_paletizacion', 'estanterias_longspan']
        : ['armarios_vestuario'];
      orden = [...pref.filter(f => fams.includes(f)), ...fams.filter(f => !pref.includes(f))];
    } else {
      const nexit = [...ctx.usos].some(u => PICKING.has(u));
      orden = nexit ? ['cajas_nexit', 'cajas_athena'] : ['cajas_athena', 'cajas_nexit'];
      orden = [...orden.filter(f => fams.includes(f)), ...fams.filter(f => !orden.includes(f))];
    }
    orden.forEach((fa, i) => {
      if (ctx.fams.has(fa) || (slot === 1 && ctx.grupos.has(grupo(fa)))) return;   // ya presupuestado
      const [motivo, beneficio] = POT[fa] || [`Producto que dirección quiere potenciar (${this.cat.familyLabel(fa)}).`, ''];
      const nombre = NOMBRE_POT[fa] || (grupo(fa) === 'estanterias' ? NOMBRE_EST : /./);
      const ps = this.mejores(fa, 3, p => nombre.test(p.name) && (slot !== 1 || !ESPECIAL.test(`${p.name} ${p.desc}`)), motivo);
      ps.forEach((p, j) => {
        out.push(this.cand(p, { slot, tipo: 'Potencial', fuente: 'P', score: (i === 0 ? 82 : 66) - j * 4, motivo, beneficio,
          evidencia: 'Potencial fijado por dirección; elegido según el tipo de pedido' }));
      });
    });
    return out;
  }

  // ── Tarjetas 2, 4, 5 y 6 ───────────────────────────────────────────────
  generales() {
    const cat = this.cat, ctx = this.ctx, out = [];
    // N · Lo que el cliente ha pedido en las notas (p. ej. «también quieren una báscula»)
    if (this.nota.length) {
      const porFam = new Map();
      for (const p of cat.products) {
        if (!p.web || p.isAccessory || NO_PRINCIPAL.test(p.name) || ctx.pis.has(p.idx) || !p.familia || ctx.fams.has(p.familia)) continue;
        const nombre = tokens(p.name), hits = this.nota.filter(t => notaHit(t, nombre));
        if (!hits.length) continue;
        const cabeza = hits.some(t => notaHit(t, nombre.slice(0, 1)));    // «Básculas de…», «Taquillas…»: lo pedido es el producto, no un accesorio suyo
        const peso = hits.length + (cabeza ? 2 : 0) + (p.photo ? 0.2 : 0) + ((this.cat._vby.get(p.idx) || []).length ? 0.3 : 0)
          - (NICHO.test(p.name) ? 1 : 0) - (ESPECIAL.test(`${p.name} ${p.desc}`) ? 1.5 : 0) - (QUIMICOS.test(p.familia) ? 1.5 : 0);
        const best = porFam.get(p.familia);
        if (!best || peso > best.peso) porFam.set(p.familia, { p, hits, peso });
      }
      const pedidas = new Set();   // una propuesta por cada cosa pedida («escaleras» → una escalera, no dos)
      [...porFam.values()].filter(x => x.peso >= 2.5).sort((a, b) => b.peso - a.peso)
        .filter(x => { if (x.hits.every(t => pedidas.has(t))) return false; x.hits.forEach(t => pedidas.add(t)); return true; })
        .slice(0, 4).forEach(({ p, hits, peso }) =>
        out.push(this.cand(p, { tipo: 'Según tus notas', fuente: 'N', score: Math.min(88, 55 + 10 * Math.floor(peso)),
          motivo: `Lo has apuntado en las notas del cliente («${hits.slice(0, 3).join('», «')}»).`,
          beneficio: 'Responde a algo que el cliente ya ha pedido.', evidencia: 'Notas del comercial (no salen del ordenador)' })));
    }
    // A · Completa tu pedido: accesorios de fichas presupuestadas
    const ids = new Set([...ctx.pis].map(i => cat.product(i).id));
    for (const a of cat.A) {
      if (!ids.has(a.origen) || !a.activo) continue;
      const p = cat.byId.get(a.destino);
      if (!p || ctx.pis.has(p.idx)) continue;
      out.push(this.cand(p, { tipo: 'Completa tu pedido', fuente: 'A', score: a.total, motivo: a.motivo,
        beneficio: 'Misma serie que lo presupuestado: encaja sin adaptaciones.', evidencia: a.evidencia, regla: a.reglaVariante }));
    }
    // B · Relaciones del Excel revisado (≥ umbral) y D · segundo nivel
    const rel = new Map();
    for (const r of cat.R) {
      if (!ctx.fams.has(r.origen) || ctx.fams.has(r.destino)) continue;
      const prev = rel.get(r.destino);
      if (!prev || r.total > prev.total) rel.set(r.destino, r);
    }
    const nivel2 = new Map();
    for (const [fa, r] of rel) {
      const sobre = r.activo && r.total >= cat.umbral;   // por debajo del umbral: solo oportunidad secundaria
      this.mejores(fa, 2, undefined, r.motivo).forEach((p, j) => out.push(this.cand(p, {
        tipo: sobre ? 'Relación' : 'Oportunidad secundaria', fuente: sobre ? 'B' : 'B-', score: (sobre ? r.total : Math.min(r.total, 40) * 0.8) - j * 15,
        motivo: this.motivoDe(p, r), beneficio: r.beneficio, evidencia: r.evidencia })));
      if (!sobre) continue;
      for (const r2 of cat.R) {
        if (r2.origen !== fa || !r2.activo || r2.total < cat.umbral || ctx.fams.has(r2.destino) || rel.has(r2.destino)) continue;
        const s = Math.round(r.total * r2.total / 100 * 0.9);
        if (!nivel2.has(r2.destino) || nivel2.get(r2.destino).s < s) nivel2.set(r2.destino, { s, r2, via: fa });
      }
    }
    for (const [fa, { s, r2, via }] of nivel2) {
      const p = this.mejores(fa, 1, undefined, r2.motivo)[0];
      if (p) out.push(this.cand(p, { tipo: 'Segundo nivel', fuente: 'D', score: s,
        motivo: `Complementa a ${cat.familyLabel(via).toLowerCase()}: ${this.motivoDe(p, r2)}`, beneficio: r2.beneficio, evidencia: r2.evidencia }));
    }
    // E · Productos cercanos: misma sección, otra familia (solo si no hay nada mejor)
    const sec = [...ctx.secciones.keys()];
    const famsSec = new Set(cat.products.filter(p => sec.includes(p.seccion) && p.web && !p.isAccessory).map(p => p.familia));
    for (const fa of famsSec) {
      if (!fa || ctx.fams.has(fa) || rel.has(fa) || nivel2.has(fa)) continue;
      const p = this.mejores(fa, 1)[0];
      if (p) out.push(this.cand(p, { tipo: 'Producto cercano', fuente: 'E', score: 22 + Math.round(jaccard(ctx.tokArr, p.tokens) * 30),
        motivo: `De la misma sección que lo presupuestado (${p.seccion.toLowerCase()}).`, beneficio: 'Amplía la propuesta sin salir de lo que ya interesa al cliente.',
        evidencia: 'Cercanía de catálogo, sin relación técnica verificada' }));
    }
    // U · Mismo ámbito de uso (obra, taller, almacén…): para productos con pocas relaciones, antes que dejar huecos
    const USO = { obra_exterior: 'obra y exteriores', taller_produccion: 'taller y producción', almacen_transporte: 'almacén y transporte', almacen_picking: 'almacén y picking',
      manutencion: 'manutención', quimicos: 'productos químicos', seguridad_planta: 'seguridad en planta', reparto: 'reparto', mantenimiento: 'mantenimiento',
      vestuarios_personal: 'vestuarios', puesto_trabajo: 'puesto de trabajo', oficina: 'oficina', instalaciones: 'instalaciones', combustible_taller: 'taller', almacen_carga: 'almacén' };
    const ya = new Set(out.map(c => c.fa));
    for (const [fa, f] of Object.entries(cat.F)) {
      if (!ctx.usos.has(f.u) || ctx.fams.has(fa) || ya.has(fa) || rel.has(fa) || nivel2.has(fa)) continue;
      const p = this.mejores(fa, 1, undefined, cat.familyLabel(fa))[0];
      if (p) out.push(this.cand(p, { tipo: 'Producto cercano', fuente: 'E', score: 18 + Math.round(jaccard(ctx.tokArr, p.tokens) * 30),
        motivo: `Mismo ámbito que lo presupuestado (${USO[f.u] || f.u.replace(/_/g, ' ')}): ${cat.familyLabel(fa).toLowerCase()}.`,
        beneficio: 'Completa la propuesta para el mismo tipo de trabajo.', evidencia: 'Mismo ámbito de uso, sin relación técnica verificada' }));
    }
    const uniq = [...new Set(out)].filter(c => this.byKey.get(c.key) === c && !c.slot);
    return uniq.sort((a, b) => b.score - a.score);
  }

  // ── Filtros obligatorios (8.1) ─────────────────────────────────────────
  ok(c, elegidos) {
    const ctx = this.ctx, p = this.cat.product(c.pi), F = this.cat.F[c.fa] || {};
    if (ctx.pis.has(c.pi) || this.bloqueado(p)) return false;
    if (c.fuente !== 'A') {
      if (p.isAccessory) return false;                                       // accesorios solo de lo presupuestado
      if (ctx.fams.has(c.fa) || (c.serie && ctx.series.has(c.serie))) return false;
      if (!c.slot && ctx.grupos.has(c.grupo) && (['cajas', 'estanterias', 'taquillas', 'armarios', 'sillas', 'mesas'].includes(c.grupo) || 'DE'.includes(c.fuente))) return false;
    }
    if (ctx.movil && CON_RUEDAS.test(c.fa) && !ctx.palets) return false;     // ya lleva ruedas
    if (!c.slot && c.fuente !== 'N' && ctx.transporte && !ctx.estatico && F.e) return false;     // transporte ≠ almacenaje estático (salvo que el cliente lo pida)
    for (const e of elegidos) {
      if (e === c) continue;
      if (e.pi === c.pi || e.fa === c.fa || e.grupo === c.grupo || (c.serie && e.serie === c.serie)) return false;
    }
    return true;
  }

  /** Elige las 6 tarjetas. Mantiene las que ya se mostraban y rellena los huecos con la siguiente alternativa. */
  seleccionar(prev = [], descartados = new Set()) {
    const out = Array(6).fill(null), elegidos = [];
    prev.forEach((k, i) => {
      const c = k && this.byKey.get(k);
      if (c && !descartados.has(k) && this.ok(c, elegidos)) { out[i] = c; elegidos.push(c); }
    });
    const fill = (i, q) => {
      if (out[i]) return;
      const c = q.find(x => !descartados.has(x.key) && !elegidos.includes(x) && this.ok(x, elegidos));
      if (c) { out[i] = c; elegidos.push(c); }
    };
    fill(0, this.q1); fill(2, this.q3);
    [1, 3, 4, 5, 0, 2].forEach(i => fill(i, this.general));   // si un potencial se agota, ocupa su hueco la siguiente mejor
    return out;
  }

  /** Referencia preseleccionada: la que comparte medidas con el pedido; si no, la primera */
  referencias(c) {
    const vs = this.cat._vby.get(c.pi) || [];
    let best = null, bs = 0;
    for (const v of vs) {
      const s = (v.medidas || []).filter(d => d && this.ctx.dims.has(d)).length;
      if (s > bs) { bs = s; best = v; }
    }
    // «Coincide» solo con dos medidas iguales (largo y fondo, p. ej.): una sola cifra común es casualidad
    return { vs, pre: bs >= 2 ? best : vs[0] || null, exacta: bs >= 2 };
  }
}
