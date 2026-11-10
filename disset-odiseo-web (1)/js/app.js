import { db, saveQuote, exportBackup, importBackup, MAX_QUOTES } from './db.js';
import { esc, uuid, normRef } from './util.js';
import { Catalog } from './catalog.js';
import { Matcher, STATUS } from './matcher.js';
import { readQuote } from './reader.js';
import { renderCatalog } from './layout.js';
import { Mascot } from './mascot.js';
import { CrossSell } from './crosssell.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const PERFIL_DEF = { nombre: 'Albert Rovira Tejedor', email: 'arovira@dissetodiseo.com', telefono: '900 17 17 00', web: 'www.dissetodiseo.com' };
const ST = {
  seguro: ['Seguro', 'pill-ok'], revisar: ['Por confirmar', 'pill-warn'], sin_ficha: ['Sin ficha', 'pill-none'],
};
let cat, matcher, mixa, perfil, quote = null, openFix = null;

const FRASES = {
  home: ['Suéltame el presupuesto. Yo me encargo, sin precios.', 'Aquí los precios no entran. Ni con casco.',
    'Tranquilo: el PDF se queda en tu ordenador.', 'Un buen catálogo vende más que tres llamadas.'],
  lines: ['Si un código viene raro, corrígelo una vez y lo aprendo.', 'Lo ámbar, revísalo. Lo verde, ni lo mires.',
    'Las líneas sin ficha salen igual, compactas y con su borde azul.'],
  pdf: ['Ni precio, ni IVA, ni NIF. Limpio como obra recién entregada.', 'Dale a «Guardar como PDF» y listo para enviar.'],
  venta: ['Si no encaja, ×. Yo tomo nota y no te lo vuelvo a sacar.', 'Prefiero un hueco vacío a inventarme una compatibilidad.',
    'Un roll sin rampa es medio pedido.', 'Las dos de dirección van en la 1 y la 3. Las otras, por puntos.', 'El % es lo que encaja, no lo que se va a vender.'],
  hist: ['Aquí guardo tus últimos 60 presupuestos. Solo en este ordenador.', 'Haz una copia de vez en cuando. Yo tengo siete vidas; tus datos, una.'],
};

// ── Arranque ──────────────────────────────────────────────────────────────
async function init() {
  mixa = new Mascot();
  perfil = { ...PERFIL_DEF, ...(await db.meta('perfil') || {}) };
  view.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando catálogo…</div>`;
  try {
    cat = await Catalog.load();
    matcher = await Matcher.create(cat);
  } catch (e) {
    view.innerHTML = `<div class="panel err">No se pudo cargar el catálogo. ${esc(e.message)}</div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('paste', onPaste);
  $('#btn-ajustes').addEventListener('click', openSettings);
  route();
}

function route() {
  const h = location.hash;
  let m;
  if ((m = h.match(/^#\/q\/([\w-]+)\/catalogo/))) return showCatalog(m[1]);
  if ((m = h.match(/^#\/q\/([\w-]+)\/venta/))) return showCross(m[1]);
  if ((m = h.match(/^#\/q\/([\w-]+)/))) return showLines(m[1]);
  if (h.startsWith('#/historial')) return showHistory();
  return showHome();
}
function nav(active) {
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === active));
}

// ── Portada ───────────────────────────────────────────────────────────────
async function showHome() {
  nav('home'); mixa.setPhrases(FRASES.home); document.title = 'Disset Odiseo · Asistente comercial';
  const recent = (await db.all('quotes')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const shop = cat.showcase(14);
  view.innerHTML = `
  <section class="hero">
    <p class="kicker">Paso 1 · Presupuesto</p>
    <h1>Del presupuesto al <span class="accent">catálogo</span></h1>
    <p class="sub">Fichas, fotos de la web y referencias de Disset. Sin precios.</p>
    <label class="drop" id="drop" tabindex="0">
      <input type="file" id="file" accept="application/pdf,image/*" multiple hidden>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
      <strong>Arrastra el presupuesto o <span class="accent">selecciónalo</span></strong>
      <span class="muted">PDF, imagen o captura · Ctrl+V para pegar un recorte</span>
    </label>
    <p class="privacy">Se lee en este ordenador. El documento, los precios y los datos del cliente nunca se suben.</p>
    <div id="progress" class="progress" hidden></div>
  </section>
  <section class="showcase" aria-label="Escaparate"><div class="track">${[...shop, ...shop].map(p => `
    <a class="tile" href="${esc(p.url)}" target="_blank" rel="noopener"><span class="tile-img"><img src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span><span>${esc(p.name)}</span></a>`).join('')}</div></section>
  ${recent.length ? `<section class="card recent"><h2>Seguir donde lo dejé</h2>${recent.map(q => `
    <a class="recent-row" href="#/q/${q.id}"><span>Oferta ${esc(q.offer || 'sin número')} <span class="muted">· ${esc(q.date || '')}</span></span><span class="muted">${q.lines.length} líneas</span></a>`).join('')}</section>` : ''}`;
  const drop = $('#drop'), input = $('#file');
  input.addEventListener('change', () => handleFiles([...input.files]));
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFiles([...e.dataTransfer.files]));
}

function onPaste(e) {
  const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  if (files.length && !location.hash.startsWith('#/q/')) { e.preventDefault(); handleFiles(files.map((f, i) => new File([f], `recorte-${i + 1}.png`, { type: f.type }))); }
}

async function handleFiles(files) {
  files = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || f.type.startsWith('image/'));
  if (!files.length) return;
  const prog = $('#progress');
  const say = t => { if (prog) { prog.hidden = false; prog.textContent = t; } };
  mixa.say('Descargando el palé… dame un momento.');
  try {
    const q = { id: uuid(), offer: '', date: '', createdAt: new Date().toISOString(), status: 'en_preparacion', lines: [], extras: [], stats: {}, files: files.length };
    for (const f of files) {
      say(`Leyendo ${f.name}…`);
      const r = await readQuote(f, cat, say);
      q.offer = q.offer || r.offer; q.date = q.date || r.date;
      q.strategy = r.strategy; q.stats = r.stats;
      for (const l of r.lines) q.lines.push({ id: uuid(), ...l, match: matcher.match(l), include: true });
    }
    if (!q.date) q.date = new Date().toLocaleDateString('es-ES');
    if (q.offer) {   // misma oferta subida de nuevo: se actualiza, no se duplica
      const prev = (await db.all('quotes')).find(x => x.offer === q.offer);
      if (prev) { q.id = prev.id; q.createdAt = prev.createdAt; q.status = prev.status; q.catalogs = prev.catalogs; }
    }
    if (!q.lines.length) { say('No he encontrado líneas de producto. ¿Es un presupuesto? Prueba con el PDF original o una captura más nítida.'); mixa.say('Ahí no veo ni una referencia. ¿Seguro que es un presupuesto?'); return; }
    await saveQuote(q);
    quote = q; openFix = null; xs = null;
    location.hash = `#/q/${q.id}`;
    if (location.hash === `#/q/${q.id}`) route();
  } catch (e) {
    console.error(e); say('No he podido leer el archivo: ' + e.message);
  }
}

// ── Líneas del presupuesto ────────────────────────────────────────────────
async function load(id) {
  if (quote?.id !== id) quote = await db.get('quotes', id);
  return quote;
}
const persist = () => saveQuote(quote);
const touchLines = () => { xs = null; };

async function showLines(id) {
  nav(''); if (!(await load(id))) return (location.hash = '#/');
  const c = { seguro: 0, revisar: 0, sin_ficha: 0 };
  quote.lines.forEach(l => c[l.match.status]++);
  mixa.setPhrases(c.revisar ? [`Hay ${c.revisar} por confirmar. Míralas antes de enviar.`, ...FRASES.lines] : ['¡Todo identificado! Así da gusto.', ...FRASES.lines]);
  document.title = `Oferta ${quote.offer || ''} · líneas`;
  let group = null;
  const rows = quote.lines.map(l => {
    const p = l.match.pi != null ? cat.product(l.match.pi) : null;
    const [label, cls] = ST[l.match.status];
    let out = '';
    if ((l.group || '') !== group) { group = l.group || ''; if (group) out += `<div class="grp">${esc(group)}</div>`; }
    out += `<div class="ln ${l.include === false ? 'off' : ''}" data-id="${l.id}">
      <div class="ln-ph">${p?.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>
      <div class="ln-ref mono">${esc(l.ref || '—')}</div>
      <div class="ln-main"><div class="ln-title">${esc(p ? p.name : (l.title || l.text))}</div>
        <div class="ln-why muted" title="${esc(l.match.why)}">${esc(p ? (l.title || '') : l.match.why)}</div></div>
      <div class="ln-dim muted">${esc(l.dims || '')}</div>
      <div><span class="pill ${cls}" title="${esc(l.match.why)} · confianza ${Math.round(l.match.confidence * 100)} %">${label}</span></div>
      <div class="ln-act"><button class="lnk" data-act="fix">Corregir</button><button class="lnk muted" data-act="toggle">${l.include === false ? 'Incluir' : 'Quitar'}</button></div>
    </div>${openFix === l.id ? fixPanel(l) : ''}`;
    return out;
  }).join('');
  view.innerHTML = `
  <div class="bar"><div><p class="kicker">Paso 2 · Revisión</p><h1>Líneas del presupuesto</h1>
    <p class="muted">${c.seguro} seguras · <span class="warn">${c.revisar} por confirmar</span> · ${c.sin_ficha} sin ficha</p></div>
    <div class="bar-actions">
      <label class="fld">Oferta <input id="offer" value="${esc(quote.offer)}" size="12"></label>
      <label class="fld">Fecha <input id="date" value="${esc(quote.date)}" size="10"></label>
      <a class="btn ghost" href="#/q/${quote.id}/catalogo">Ver catálogo</a>
      <a class="btn" href="#/q/${quote.id}/venta">Venta cruzada${quote.extras?.length ? ` · ${quote.extras.length}` : ''} ›</a></div></div>
  <div class="card lines" id="lines">${rows}</div>
  <p class="muted small">Leído por ${esc(quote.strategy || '—')} · descartadas en local: ${quote.stats?.descartadas || 0} líneas de precios/condiciones y ${quote.stats?.personales || 0} con datos del cliente.</p>`;
  $('#offer').addEventListener('change', e => { quote.offer = e.target.value.trim(); persist(); });
  $('#date').addEventListener('change', e => { quote.date = e.target.value.trim(); persist(); });
  $('#lines').addEventListener('click', onLineClick);
  $('#lines').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.fix-input')) { e.preventDefault(); doSearch(); } });
  if (openFix) { const inp = $('.fix-input'); inp?.focus(); inp?.select(); if (inp?.value) doSearch(); }
}

function fixPanel(l) {
  return `<div class="fix" data-id="${l.id}"><label>Referencia o nombre <input class="fix-input mono" value="${esc(l.ref)}" autocomplete="off"></label>
    <button class="btn" data-act="search">Buscar ficha ↵</button><button class="lnk" data-act="close">Cerrar</button>
    <div class="fix-res"></div><p class="muted small">Al elegir una ficha, la corrección se guarda y la próxima vez se reconoce sola.</p></div>`;
}

function doSearch() {
  const q = $('.fix-input').value.trim(); const box = $('.fix-res');
  const res = q ? matcher.search(q, 8) : [];
  box.innerHTML = res.length ? res.map(v => { const p = cat.product(v.pi); return `
    <button class="res" data-act="pick" data-vi="${v.idx ?? ''}" data-pi="${v.pi}">
      <span class="res-ph">${p.photo ? `<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">` : ''}</span>
      <span><strong class="mono">${esc(v.ref || '')}</strong> ${esc(p.name)}<br><span class="muted small">${esc(cat.familyLabel(p.familia))}${v.detalle ? ' · ' + esc(v.detalle.slice(0, 80)) : ''}</span></span></button>`; }).join('')
    : '<p class="muted">Sin resultados. Prueba con otra parte del código o con el nombre.</p>';
}

async function onLineClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.closest('[data-id]')?.dataset.id; const l = quote.lines.find(x => x.id === id);
  const act = b.dataset.act;
  if (act === 'fix') { openFix = openFix === id ? null : id; return showLines(quote.id); }
  if (act === 'close') { openFix = null; return showLines(quote.id); }
  if (act === 'toggle') { l.include = l.include === false; touchLines(); await persist(); return showLines(quote.id); }
  if (act === 'search') return doSearch();
  if (act === 'pick') {
    const pi = +b.dataset.pi, vi = b.dataset.vi === '' ? null : +b.dataset.vi;
    const v = vi != null ? cat.variants[vi] : null;
    if (l.ref && v) await matcher.learn(l.ref, v);
    l.match = { pi, vi, confidence: 1, why: 'Corregido por el comercial', status: STATUS.OK };
    if (!l.ref && v) l.ref = v.ref;
    openFix = null; touchLines(); await persist(); mixa.say('Apuntado. La próxima vez esa la clavo yo solita.');
    return showLines(quote.id);
  }
}

// ── Venta cruzada: seis tarjetas ───────────────────────────────────────────
const BADGE = { 'Potencial': 'b-pot', 'Completa tu pedido': 'b-ok', 'Muy compatible': 'b-ok', 'Compatible': 'b-lav', 'Oportunidad': 'b-warn' };
let xs = null;   // { id, eng }

async function learningMap() { return new Map((await db.all('learning')).map(r => [r.key, r])); }
async function aprender(eng, c, campo) {
  const p = cat.product(c.pi), key = eng.lkey(p);
  const r = (await db.get('learning', key)) || { key, situacion: eng.ctx.main, producto: p.id, nombre: p.name, added: 0, discarded: 0 };
  r[campo] = (r[campo] || 0) + 1; r.at = new Date().toISOString();
  await db.put('learning', r); eng.L.set(key, r);
}
function evento(c, accion) {
  (quote.reco.eventos ||= []).push({ producto: cat.product(c.pi).id, familia: c.fa, slot: c.slot, tipo: c.badge, score: c.score, accion, at: new Date().toISOString() });
}

async function showCross(id) {
  nav(''); if (!(await load(id))) return (location.hash = '#/');
  mixa.setPhrases(FRASES.venta); document.title = `Venta cruzada · Oferta ${quote.offer || ''}`;
  if (xs?.id !== id) xs = { id, eng: new CrossSell(cat, quote, await learningMap()) };
  const eng = xs.eng;
  quote.reco ||= { cards: [], descartados: [], marcados: {}, eventos: [], aprendidos: [] };
  const R = quote.reco;
  const cards = eng.seleccionar(R.cards, new Set(R.descartados));
  const nuevas = cards.filter(c => c && !R.cards.includes(c.key));
  R.cards = cards.map(c => c?.key || null);
  nuevas.forEach(c => evento(c, 'mostrada'));
  await persist();
  const n = Object.keys(R.marcados).filter(k => R.cards.includes(k)).length;
  view.innerHTML = `
  <div class="bar"><div><p class="kicker">Paso 3 · Venta cruzada</p><h1>Te puede interesar</h1>
    <p class="muted">Marca las propuestas que van al catálogo. La <b>×</b> descarta y trae la siguiente alternativa.</p></div>
    <div class="bar-actions"><a class="btn ghost" href="#/q/${quote.id}">Líneas</a>
      <button class="btn ghost" id="xs-all">Marcar todas</button>
      <button class="btn" id="xs-ok">${n ? `Confirmar ${n} y ver catálogo` : 'Continuar sin propuestas'} ›</button></div></div>
  <div class="xs-grid" id="xs">${cards.map((c, i) => c ? cardHTML(eng, c, i) : emptyCard(i)).join('')}</div>
  <p class="muted small">1 y 3: productos que potencia dirección · 2, 4, 5 y 6: por compatibilidad comercial. El % mide cuánto encaja con el pedido, no la probabilidad de venta.</p>`;
  const grid = $('#xs');
  grid.addEventListener('click', e => onCross(e, eng));
  grid.addEventListener('change', e => {
    const sel = e.target.closest('select'); if (!sel) return;
    const k = sel.closest('[data-key]').dataset.key;
    R.sel = { ...(R.sel || {}), [k]: +sel.value };
    if (k in R.marcados) R.marcados[k] = +sel.value;
    persist();
  });
  $('#xs-all').onclick = () => { cards.forEach(c => { if (c && !(c.key in R.marcados)) R.marcados[c.key] = R.sel?.[c.key] ?? eng.referencias(c).pre?.idx ?? null; }); persist().then(() => showCross(id)); };
  $('#xs-ok').onclick = () => confirmCross(eng, cards);
}

function cardHTML(eng, c, i) {
  const p = cat.product(c.pi), R = quote.reco;
  const { vs, pre, exacta } = eng.referencias(c);
  const sel = R.marcados[c.key] ?? R.sel?.[c.key] ?? pre?.idx;
  const on = c.key in R.marcados;
  const opts = vs.slice(0, 80).map(v => `<option value="${v.idx}"${v.idx === sel ? ' selected' : ''}>${esc(v.ref)}${v.detalle ? ' · ' + esc(v.detalle.replace(/^Descripción:\s*/, '').slice(0, 70)) : ''}</option>`).join('');
  return `<article class="xs-card${on ? ' on' : ''}" data-key="${c.key}">
    <span class="xs-n">${i + 1}</span>
    <button class="xs-x" data-act="x" aria-label="Descartar ${esc(p.name)}" title="Descartar: muestra la siguiente alternativa">×</button>
    <a class="xs-ph" href="${esc(p.url)}" target="_blank" rel="noopener">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</a>
    <div class="xs-top"><span class="xs-badge ${BADGE[c.badge] || 'b-lav'}">${esc(c.badge)}</span>
      <span class="xs-ring" style="--p:${c.score}" title="Compatibilidad comercial con el pedido (no es probabilidad de compra). ${esc(c.evidencia)}"><b>${c.score}</b><small>%</small></span></div>
    <h3>${esc(p.name)}</h3>
    <p class="xs-why">${esc(c.motivo)}</p>
    ${c.beneficio ? `<p class="xs-ben">${esc(c.beneficio)}</p>` : ''}
    ${vs.length ? `<label class="xs-ref"><span>Referencia${exacta ? ' <em class="ok">· coincide con el pedido</em>' : vs.length > 1 ? ' <em>· elige medida</em>' : ''}</span><select>${opts}</select></label>` : '<p class="muted small">Sin referencia en catálogo: se añadirá la ficha.</p>'}
    <div class="xs-act"><a class="lnk" href="${esc(p.url)}" target="_blank" rel="noopener">Ver ficha ›</a>
      <button class="btn ${on ? '' : 'ghost'} xs-add" data-act="add" aria-pressed="${on}">${on ? '✓ En el catálogo' : 'Añadir al catálogo'}</button></div>
  </article>`;
}
const emptyCard = i => `<article class="xs-card xs-empty"><span class="xs-n">${i + 1}</span><p>Sin más propuestas con justificación suficiente.</p><p class="muted small">Mejor un hueco que una compatibilidad inventada.</p></article>`;

async function onCross(e, eng) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const k = b.closest('[data-key]').dataset.key, c = eng.byKey.get(k), R = quote.reco;
  if (b.dataset.act === 'add') {
    if (k in R.marcados) { delete R.marcados[k]; evento(c, 'desmarcada'); }
    else { R.marcados[k] = +(b.closest('.xs-card').querySelector('select')?.value ?? NaN); if (Number.isNaN(R.marcados[k])) R.marcados[k] = null; evento(c, 'marcada'); }
    await persist(); return showCross(quote.id);
  }
  if (b.dataset.act === 'x') {
    R.descartados.push(k); delete R.marcados[k]; evento(c, 'descartada');
    await aprender(eng, c, 'discarded');
    mixa.say('Fuera. Apuntado: la próxima vez la tengo en cuenta.');
    await persist(); return showCross(quote.id);
  }
}

async function confirmCross(eng, cards) {
  const R = quote.reco;
  const marc = cards.filter(c => c && c.key in R.marcados);
  quote.extras = marc.map(c => {
    const v = R.marcados[c.key] != null ? cat.variants[R.marcados[c.key]] : null;
    return { key: c.key, pi: c.pi, vi: v?.idx ?? null, ref: v?.ref || '', title: v?.detalle?.replace(/^Descripción:\s*/, '') || '', badge: c.badge };
  });
  for (const c of marc) if (!R.aprendidos.includes(c.key)) { R.aprendidos.push(c.key); await aprender(eng, c, 'added'); evento(c, 'añadida'); }
  await persist();
  location.hash = `#/q/${quote.id}/catalogo`;
}

// ── Catálogo A4 ───────────────────────────────────────────────────────────
const footerText = () => [perfil.nombre, perfil.email, perfil.telefono, perfil.web].filter(Boolean).join(' · ');

async function showCatalog(id) {
  nav(''); if (!(await load(id))) return (location.hash = '#/');
  mixa.setPhrases(FRASES.pdf);
  document.title = `Catálogo ${quote.offer || ''} · Disset Odiseo`;
  view.innerHTML = `<div class="bar noprint"><div><p class="kicker">Paso 4 · Catálogo</p><h1>Catálogo para el cliente</h1><p class="muted" id="pinfo">Maquetando…</p></div>
    <div class="bar-actions"><a class="btn ghost" href="#/q/${quote.id}">Líneas</a><a class="btn ghost" href="#/q/${quote.id}/venta">Venta cruzada</a><button class="btn" id="print">Guardar como PDF</button></div></div>
    <div id="pages" class="pages"></div>`;
  const n = await renderCatalog($('#pages'), quote, cat, footerText());
  $('#pinfo').textContent = `${n} página${n > 1 ? 's' : ''} A4 · sin precios ni datos del cliente`;
  $('#print').addEventListener('click', async () => {
    if (quote.status === 'en_preparacion') quote.status = 'catalogo_generado';
    quote.catalogs = (quote.catalogs || 0) + 1; await persist();
    const t = document.title; document.title = `Catalogo_${(quote.offer || 'Disset').replace(/[^\w-]+/g, '_')}`;
    window.print(); document.title = t;
  });
}

// ── Mis presupuestos ──────────────────────────────────────────────────────
async function showHistory() {
  nav('hist'); mixa.setPhrases(FRASES.hist); document.title = 'Mis presupuestos · Disset Odiseo';
  const qs = (await db.all('quotes')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  view.innerHTML = `<div class="bar"><div><p class="kicker">Guardado en este ordenador</p><h1>Mis presupuestos</h1>
    <p class="muted">${qs.length} de ${MAX_QUOTES} como máximo · se guardan solos mientras trabajas</p></div>
    <div class="bar-actions"><button class="btn ghost" id="exp">Descargar copia</button>
      <label class="btn ghost">Importar copia<input type="file" id="imp" accept="application/json" hidden></label>
      <button class="btn ghost danger" id="reset">Empezar de nuevo</button></div></div>
    <div class="card">${qs.length ? qs.map(q => `<div class="recent-row"><a href="#/q/${q.id}">Oferta ${esc(q.offer || 'sin número')} <span class="muted">· ${esc(q.date || '')} · ${q.lines.length} líneas</span></a>
      <span class="muted small">${esc(q.status.replace('_', ' '))}</span><button class="lnk muted" data-del="${q.id}">Borrar</button></div>`).join('')
      : '<p class="muted">Todavía no hay presupuestos.</p>'}</div>`;
  $('#exp').onclick = async () => {
    const blob = new Blob([JSON.stringify(await exportBackup())], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `disset-copia-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#imp').onchange = async e => {
    try { await importBackup(JSON.parse(await e.target.files[0].text())); matcher = await Matcher.create(cat); showHistory(); }
    catch (err) { alert('No es una copia válida: ' + err.message); }
  };
  $('#reset').onclick = async () => { if (confirm('¿Borrar todos los presupuestos guardados en este ordenador? Las correcciones aprendidas se mantienen.')) { await db.clear('quotes'); quote = null; showHistory(); } };
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (confirm('¿Borrar este presupuesto?')) { await db.del('quotes', b.dataset.del); showHistory(); } });
}

// ── Ajustes: datos del pie del catálogo ───────────────────────────────────
function openSettings() {
  const d = $('#ajustes');
  d.querySelector('form').innerHTML = `<h2>Mis datos para el catálogo</h2>
    ${['nombre', 'email', 'telefono', 'web'].map(k => `<label class="fld-col">${{ nombre: 'Nombre', email: 'Correo', telefono: 'Teléfono', web: 'Web' }[k]}<input name="${k}" value="${esc(perfil[k])}"></label>`).join('')}
    <div class="row-end"><button class="btn ghost" value="cancel" formmethod="dialog">Cancelar</button><button class="btn" value="ok">Guardar</button></div>`;
  d.showModal();
  d.querySelector('form').onsubmit = async e => {
    if (e.submitter?.value !== 'ok') return;
    perfil = Object.fromEntries(new FormData(e.target)); await db.meta('perfil', perfil);
  };
}

const offline = $('#offline');
const updOnline = () => { offline.hidden = navigator.onLine; };
addEventListener('online', updOnline); addEventListener('offline', updOnline); updOnline();

init();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
