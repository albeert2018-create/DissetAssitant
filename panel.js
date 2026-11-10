// Panel de dirección (Fase 6). Solo admin/CEO con 2FA (lo garantiza el servidor con RLS).
// Sin servidor configurado muestra una DEMO con datos ficticios para presentarlo.
import { esc } from './util.js';
import { sb } from './auth.js';

const QST = { en_preparacion: 'En preparación', catalogo_generado: 'Catálogo generado', enviado: 'Enviado', negociando: 'Negociándose', aceptado: 'Aceptado', perdido: 'Perdido' };
const SERIE = ['#6D5BD0', '#eb6834', '#1baf7a', '#2a78d6'];   // validado: CVD ΔE ≥ 9, normal ≥ 24 (con etiquetas y tabla)
const POT_FAM = { armarios_vestuario: 'Taquillas', estructuras_picking: 'Estanterías', estanterias_ligeras: 'Estanterías', estanterias_longspan: 'Estanterías',
  estanterias_paletizacion: 'Estanterías', cajas_athena: 'Cajas Athena', cajas_nexit: 'Cajas Nexit' };
const DAY = 864e5;
const iso = d => new Date(d).toISOString().slice(0, 10);
const fmt = f => f ? f.slice(0, 10).split('-').reverse().join('/') : '';
const eur = n => n == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const pct = (a, b) => b ? Math.round(a / b * 100) + ' %' : '—';

// ── Datos ────────────────────────────────────────────────────────────────
/** DEMO: datos ficticios y reproducibles (mismos cada vez). Clientes inventados. */
export function demoData(cat) {
  let seed = 17; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const people = [['u1', 'Álex Armengol'], ['u2', 'Sergio Caballero'], ['u3', 'Chema Domínguez'], ['u4', 'Albert Rovira']]
    .map(([id, full_name]) => ({ id, full_name, roles: ['comercial'] }));
  const clientes = ['Logística Ejemplo SL', 'Distribuciones Demo SA', 'Talleres Ficticios SL', 'Almacenes Prueba SA', 'Transportes Inventados SL',
    'Industrias Muestra SA', 'Frío Demo SL', 'Recambios Ejemplo SL', 'Química Ficticia SA', 'Hoteles Demo SL'];
  const prods = cat.products.filter(p => p.web && !p.isAccessory && p.photo);
  const now = Date.now(), quotes = [], events = [];
  const peso = [1.25, 1, 0.8, 0.9];
  people.forEach((u, ui) => {
    const n = Math.round(22 * peso[ui]);
    for (let i = 0; i < n; i++) {
      const age = Math.floor(rnd() * 84);
      const created = now - age * DAY;
      const r = rnd();
      const status = age < 3 ? pick(['catalogo_generado', 'enviado']) : r < 0.3 ? 'enviado' : r < 0.55 ? 'negociando' : r < 0.8 ? 'aceptado' : 'perdido';
      const abierto = ['enviado', 'negociando'].includes(status);
      const share = rnd() < 0.55;
      const id = `${u.id}-${i}`;
      quotes.push({ id, owner_id: u.id, full_name: u.full_name, offer_number: `26/0${(1200 + ui * 300 + i * 7) % 9999}`, quote_date: iso(created),
        created_at: new Date(created).toISOString(), status,
        follow_up: abierto ? iso(Math.max(created + 3 * DAY, now + (Math.floor(rnd() * 14) - 4) * DAY)) : null, next_action: abierto ? pick(['llamada', 'llamada', 'email', 'visita']) : null,
        actions_done: Math.floor(rnd() * (status === 'enviado' ? 2 : 5)),
        client_label: share ? pick(clientes) : null, total_amount: share && rnd() < 0.8 ? Math.round(800 + rnd() * 14000) : null,
        lines_count: 2 + Math.floor(rnd() * 9), extras_count: Math.floor(rnd() * 3) });
      for (let k = 0; k < 6; k++) {
        const potencial = k === 0 || k === 2;
        const pool = potencial ? prods.filter(p => POT_FAM[p.familia] && (k === 0 ? !/^cajas/.test(p.familia) : /^cajas_(athena|nexit)/.test(p.familia))) : prods;
        const p = pick(pool);
        const a = rnd();
        events.push({ quote_id: id, owner_id: u.id, product_ref: p.id, family: p.familia, slot: k + 1, action: 'mostrada', created_at: new Date(created).toISOString() });
        if (a < (potencial ? 0.34 : 0.22)) events.push({ quote_id: id, owner_id: u.id, product_ref: p.id, family: p.familia, slot: k + 1, action: 'anadida', created_at: new Date(created).toISOString() });
        else if (a > 0.8) events.push({ quote_id: id, owner_id: u.id, product_ref: p.id, family: p.familia, slot: k + 1, action: 'descartada', created_at: new Date(created).toISOString() });
      }
    }
  });
  const audit = [
    { at: new Date(now - 2 * DAY).toISOString(), actor: 'Mario Villaret', action: 'Publica potenciales', detail: 'Tarjeta 1: Taquillas, Estanterías · Tarjeta 3: Athena, Nexit' },
    { at: new Date(now - 6 * DAY).toISOString(), actor: 'Albert Rovira', action: 'Cambia rol', detail: 'Chema Domínguez → comercial' },
    { at: new Date(now - 9 * DAY).toISOString(), actor: 'Manuel Sánchez', action: 'Cambia estado', detail: 'Oferta 26/01843 → Aceptado' },
  ];
  return { demo: true, people, quotes, events, audit, potenciales: cat.potenciales };
}

/** Datos reales del servidor (RLS: solo admin/CEO con 2FA ven los de todo el equipo) */
export async function serverData(cat) {
  const c = sb();
  const [p, q, e, a, r] = await Promise.all([
    c.from('profiles').select('id, full_name, roles, active'),
    c.from('shared_quotes').select('*').is('deleted_at', null),
    c.from('recommendation_events').select('quote_id, product_ref, family, slot, action, created_at'),
    c.from('audit_log').select('at, actor, action, entity, detail').order('at', { ascending: false }).limit(50),
    c.from('rule_sets').select('version, payload').eq('is_current', true).maybeSingle(),
  ]);
  for (const x of [p, q, e]) if (x.error) throw x.error;
  const name = Object.fromEntries(p.data.map(x => [x.id, x.full_name]));
  const owner = Object.fromEntries(q.data.map(x => [x.id, x.owner_id]));
  return {
    demo: false, people: p.data.filter(x => x.active && x.roles.includes('comercial')),
    quotes: q.data.map(x => ({ ...x, full_name: name[x.owner_id] || '—' })),
    events: e.data.map(x => ({ ...x, owner_id: owner[x.quote_id] })),
    audit: (a.data || []).map(x => ({ at: x.at, actor: name[x.actor] || '—', action: `${x.action} ${x.entity}`, detail: '' })),
    potenciales: r.data?.payload?.potenciales || cat.potenciales,
  };
}

// ── Vista ────────────────────────────────────────────────────────────────
const st = { quien: 'todos', dias: 90, estado: 'abiertos', todos: false };

export function renderPanel(view, D, cat, { onPublish } = {}) {
  const color = Object.fromEntries(D.people.map((u, i) => [u.id, SERIE[i % SERIE.length]]));
  const desde = Date.now() - st.dias * DAY;
  const Q = D.quotes.filter(q => (st.quien === 'todos' || q.owner_id === st.quien) && Date.parse(q.created_at) >= desde);
  const E = D.events.filter(e => (st.quien === 'todos' || e.owner_id === st.quien) && Date.parse(e.created_at) >= desde);
  const n = s => Q.filter(q => q.status === s).length;
  const enviados = Q.filter(q => ['enviado', 'negociando', 'aceptado', 'perdido'].includes(q.status)).length;
  const hoy = iso(Date.now());
  const atrasados = Q.filter(q => q.follow_up && q.follow_up < hoy && ['enviado', 'negociando'].includes(q.status));
  const enJuego = Q.filter(q => q.status === 'negociando' && q.total_amount != null).reduce((s, q) => s + +q.total_amount, 0);
  const ganado = Q.filter(q => q.status === 'aceptado' && q.total_amount != null).reduce((s, q) => s + +q.total_amount, 0);

  // Embudo
  const embudo = [['Enviados', enviados], ['Negociándose', n('negociando')], ['Aceptados', n('aceptado')], ['Perdidos', n('perdido')]];
  const maxE = Math.max(1, ...embudo.map(x => x[1]));

  // Semanas (12) apiladas por comercial
  const W = 12, wk = Array.from({ length: W }, (_, i) => Date.now() - (W - 1 - i) * 7 * DAY);
  const semana = t => Math.min(W - 1, Math.max(0, W - 1 - Math.floor((Date.now() - t) / (7 * DAY))));
  const quienes = st.quien === 'todos' ? D.people : D.people.filter(u => u.id === st.quien);
  const pila = wk.map(() => Object.fromEntries(quienes.map(u => [u.id, 0])));
  D.quotes.filter(q => quienes.some(u => u.id === q.owner_id) && Date.now() - Date.parse(q.created_at) < W * 7 * DAY)
    .forEach(q => pila[semana(Date.parse(q.created_at))][q.owner_id]++);
  const maxW = Math.max(1, ...pila.map(p => Object.values(p).reduce((a, b) => a + b, 0)));

  // Por comercial
  const filas = D.people.map(u => {
    const qs = D.quotes.filter(q => q.owner_id === u.id && Date.parse(q.created_at) >= desde);
    const ac = qs.filter(q => q.status === 'aceptado').length, pe = qs.filter(q => q.status === 'perdido').length;
    const ev = D.events.filter(e => e.owner_id === u.id && Date.parse(e.created_at) >= desde);
    return { u, total: qs.length, env: qs.filter(q => q.status !== 'en_preparacion' && q.status !== 'catalogo_generado').length,
      neg: qs.filter(q => q.status === 'negociando').length, ac, pe, cierre: pct(ac, ac + pe),
      acciones: qs.reduce((s, q) => s + (q.actions_done || 0), 0),
      tarde: qs.filter(q => q.follow_up && q.follow_up < hoy && ['enviado', 'negociando'].includes(q.status)).length,
      xs: ev.filter(e => e.action === 'anadida').length };
  });

  // Venta cruzada
  const porProd = new Map();
  for (const e of E) {
    const k = { mostrada: 'm', anadida: 'a', descartada: 'd' }[e.action]; if (!k) continue;
    const r = porProd.get(e.product_ref) || { ref: e.product_ref, fam: e.family, m: 0, a: 0, d: 0 };
    r[k]++; porProd.set(e.product_ref, r);
  }
  const prodName = id => cat.byId.get(id)?.name || id;
  const top = [...porProd.values()].filter(r => r.a).sort((a, b) => b.a - a.a).slice(0, 8);
  const descartes = [...porProd.values()].filter(r => r.d).sort((a, b) => b.d - a.d).slice(0, 5);
  const pot = {};
  for (const e of E) {
    const k = POT_FAM[e.family]; if (!k) continue;
    pot[k] ||= { m: 0, a: 0 }; if (e.action === 'mostrada') pot[k].m++; if (e.action === 'anadida') pot[k].a++;
  }
  const addTot = E.filter(e => e.action === 'anadida').length, showTot = E.filter(e => e.action === 'mostrada').length;

  // Presupuestos del equipo
  const LST = { abiertos: q => ['enviado', 'negociando'].includes(q.status), atrasados: q => atrasados.includes(q), aceptado: q => q.status === 'aceptado', perdido: q => q.status === 'perdido', todos: () => true };
  const lista = Q.filter(LST[st.estado]).sort((a, b) => (a.follow_up || '9').localeCompare(b.follow_up || '9'));
  const total = lista.length, visibles = st.todos ? lista : lista.slice(0, 12);

  view.innerHTML = `
  ${D.demo ? `<div class="demo-banner" role="note"><b>DEMO · datos ficticios.</b> Así se verá el panel con la actividad real del equipo cuando se conecte el servidor. Clientes e importes inventados.</div>` : ''}
  <div class="bar"><div><p class="kicker">Dirección · solo admin y CEO con verificación en dos pasos</p><h1>Panel comercial</h1>
    <p class="muted">${Q.length} presupuestos en los últimos ${st.dias} días${st.quien !== 'todos' ? ' · ' + esc(D.people.find(u => u.id === st.quien)?.full_name) : ' · todo el equipo'}</p></div>
    <div class="bar-actions pn-filters">
      <label class="fld">Comercial <select id="pn-quien"><option value="todos">Todo el equipo</option>${D.people.map(u => `<option value="${u.id}"${st.quien === u.id ? ' selected' : ''}>${esc(u.full_name)}</option>`).join('')}</select></label>
      <label class="fld">Periodo <select id="pn-dias">${[[30, '30 días'], [90, '90 días'], [365, '12 meses']].map(([d, t]) => `<option value="${d}"${st.dias === d ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <button class="btn ghost" id="pn-csv">Exportar CSV</button></div></div>

  <section class="kpis">
    ${kpi('Enviados', enviados, 'presupuestos con catálogo enviado')}
    ${kpi('Negociándose', n('negociando'), enJuego ? eur(enJuego) + ' compartido en juego' : 'sin importes compartidos')}
    ${kpi('Aceptados', n('aceptado'), ganado ? eur(ganado) + ' compartido' : '&nbsp;')}
    ${kpi('Tasa de cierre', pct(n('aceptado'), n('aceptado') + n('perdido')), 'aceptados ÷ (aceptados + perdidos)')}
    ${kpi('Seguimientos atrasados', atrasados.length, atrasados.length ? 'llamadas, emails o visitas sin hacer' : 'al día', atrasados.length ? 'warn' : '')}
    ${kpi('Venta cruzada añadida', pct(addTot, showTot), `${addTot} de ${showTot} propuestas · no es venta cerrada`)}
  </section>

  <div class="pn-grid">
    <section class="card pn-card"><h2>Embudo</h2>
      <div class="funnel">${embudo.map(([t, v]) => `<div class="f-row" data-tip="${t}: ${v}"><span class="f-l">${t}</span><span class="f-bar"><i style="width:${v / maxE * 100}%"></i></span><b>${v}</b></div>`).join('')}</div>
    </section>
    <section class="card pn-card"><h2>Presupuestos por semana</h2>
      <div class="legend">${quienes.map(u => `<span><i style="background:${color[u.id]}"></i>${esc(u.full_name.split(' ')[0])}</span>`).join('')}</div>
      ${weekChart(pila, wk, quienes, color, maxW)}
    </section>
  </div>

  <section class="card pn-card"><h2>Por comercial</h2><p class="muted small">Pulsa una fila para ver solo a esa persona.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Comercial</th><th>Presupuestos</th><th>Enviados</th><th>Negociándose</th><th>Aceptados</th><th>Perdidos</th><th>Cierre</th><th>Acciones hechas</th><th>Atrasados</th><th>Venta cruzada añadida</th></tr></thead>
    <tbody>${filas.map(f => `<tr data-u="${f.u.id}" class="${st.quien === f.u.id ? 'sel' : ''}"><td><i class="dot" style="background:${color[f.u.id]}"></i>${esc(f.u.full_name)}</td><td>${f.total}</td><td>${f.env}</td><td>${f.neg}</td><td>${f.ac}</td><td>${f.pe}</td><td>${f.cierre}</td><td>${f.acciones}</td><td class="${f.tarde ? 'warn' : ''}">${f.tarde}</td><td>${f.xs}</td></tr>`).join('')}</tbody></table></div>
  </section>

  <div class="pn-grid">
    <section class="card pn-card"><h2>Productos a potenciar</h2><p class="muted small">Tarjetas 1 y 3: cuántas veces se proponen y cuántas acaban en el catálogo del cliente.</p>
      <div class="pot-grid">${['Taquillas', 'Estanterías', 'Cajas Athena', 'Cajas Nexit'].map(k => { const v = pot[k] || { m: 0, a: 0 };
        return `<div class="pot"><span class="pot-n">${k}</span><b>${pct(v.a, v.m)}</b><span class="muted small">${v.a} añadidas de ${v.m}</span><span class="f-bar"><i style="width:${v.m ? v.a / v.m * 100 : 0}%"></i></span></div>`; }).join('')}</div>
    </section>
    <section class="card pn-card"><h2>Más añadidos a catálogos</h2>
      <ol class="rank">${top.map(r => `<li><span>${esc(prodName(r.ref))}</span><b>${r.a}</b><span class="muted small">de ${r.m} · ${pct(r.a, r.m)}</span></li>`).join('') || '<li class="muted">Sin datos</li>'}</ol>
      <h3 class="pn-h3">Más descartados</h3>
      <ol class="rank">${descartes.map(r => `<li><span>${esc(prodName(r.ref))}</span><b>${r.d}</b><span class="muted small">descartes</span></li>`).join('') || '<li class="muted">Sin datos</li>'}</ol>
    </section>
  </div>

  <section class="card pn-card"><h2>Presupuestos del equipo</h2>
    <div class="chips">${[['abiertos', 'Abiertos'], ['atrasados', 'Seguimiento atrasado'], ['aceptado', 'Aceptados'], ['perdido', 'Perdidos'], ['todos', 'Todos']].map(([k, t]) => `<button class="chip${st.estado === k ? ' on' : ''}" data-e="${k}">${t} <span>${Q.filter(LST[k]).length}</span></button>`).join('')}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Comercial</th><th>Oferta</th><th>Fecha</th><th>Estado</th><th>Próxima acción</th><th>Hechas</th><th>Cliente</th><th>Importe</th><th>Líneas</th></tr></thead>
    <tbody>${visibles.map(q => `<tr><td><i class="dot" style="background:${color[q.owner_id]}"></i>${esc(q.full_name.split(' ')[0])}</td><td class="mono">${esc(q.offer_number || '—')}</td><td>${fmt(q.quote_date)}</td>
      <td><span class="pill ${q.status === 'aceptado' ? 'pill-ok' : q.status === 'perdido' ? 'pill-none' : 'pill-warn'}">${QST[q.status]}</span></td>
      <td class="${q.follow_up && q.follow_up < hoy && ['enviado', 'negociando'].includes(q.status) ? 'warn' : ''}">${q.next_action ? `${q.next_action} · ${fmt(q.follow_up)}` : '—'}</td><td>${q.actions_done || 0}</td>
      <td>${q.client_label ? esc(q.client_label) : '<span class="muted small">no compartido</span>'}</td><td>${q.total_amount != null ? eur(q.total_amount) : '<span class="muted small">—</span>'}</td><td>${q.lines_count}${q.extras_count ? ` <span class="muted small">+${q.extras_count}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
    ${total > 12 ? `<div class="row-end"><button class="lnk" id="pn-mas">${st.todos ? 'Ver menos' : `Ver los ${total}`}</button></div>` : ''}
  </section>

  <div class="pn-grid">
    <section class="card pn-card"><h2>Potenciales de las tarjetas 1 y 3</h2><p class="muted small">Lo que dirección quiere empujar. Al publicar, todos los comerciales lo ven en su próxima venta cruzada.</p>
      ${potEditor(D.potenciales, cat)}
      <div class="row-end"><span class="muted small" id="pot-msg"></span><button class="btn" id="pot-pub">Publicar potenciales</button></div>
    </section>
    <section class="card pn-card"><h2>Registro de cambios</h2>
      <ul class="audit">${D.audit.map(a => `<li><span class="muted small">${fmt(a.at)}</span> <b>${esc(a.actor)}</b> · ${esc(a.action)}${a.detail ? ` <span class="muted">— ${esc(a.detail)}</span>` : ''}</li>`).join('') || '<li class="muted">Sin cambios</li>'}</ul>
    </section>
  </div>
  <p class="muted small">«Añadida al catálogo» significa que el comercial la incluyó en el catálogo del cliente; no es una venta cerrada. El cliente y el importe solo aparecen si el comercial los ha compartido.</p>`;

  const again = () => renderPanel(view, D, cat, { onPublish });
  view.querySelector('#pn-quien').onchange = e => { st.quien = e.target.value; again(); };
  view.querySelector('#pn-dias').onchange = e => { st.dias = +e.target.value; again(); };
  view.querySelectorAll('[data-u]').forEach(r => r.onclick = () => { st.quien = st.quien === r.dataset.u ? 'todos' : r.dataset.u; again(); });
  view.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { st.estado = b.dataset.e; again(); });
  view.querySelector('#pn-mas')?.addEventListener('click', () => { st.todos = !st.todos; again(); });
  view.querySelector('#pn-csv').onclick = () => descargarCSV(Q, D);
  view.querySelector('#pot-pub').onclick = async () => {
    const msg = view.querySelector('#pot-msg');
    const sel = [1, 3].map(slot => ({ slot, fams: [...view.querySelectorAll(`[data-slot="${slot}"]:checked`)].map(x => x.value) }));
    if (sel.some(s => !s.fams.length)) { msg.textContent = 'Elige al menos una familia en cada tarjeta.'; return; }
    if (D.demo || !onPublish) { msg.textContent = 'En la demo no se publica. Con el servidor conectado, se aplicaría a todo el equipo.'; return; }
    try { await onPublish(sel); msg.textContent = 'Publicado ✓'; } catch (err) { msg.textContent = 'No se pudo publicar: ' + err.message; }
  };
  tooltips(view);
}

function kpi(t, v, sub, cls = '') { return `<div class="kpi card ${cls}"><span class="kpi-t">${t}</span><b class="kpi-v">${v}</b><span class="kpi-s">${sub}</span></div>`; }

function weekChart(pila, wk, quienes, color, max) {
  const Wd = 640, H = 200, pad = 26, bw = (Wd - pad) / pila.length;
  const y = v => H - 22 - v / max * (H - 40);
  let bars = '';
  pila.forEach((p, i) => {
    let base = 0;
    const tot = Object.values(p).reduce((a, b) => a + b, 0);
    const label = `Semana del ${new Date(wk[i] - 6 * DAY).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}: ${tot} — ` + quienes.map(u => `${u.full_name.split(' ')[0]} ${p[u.id]}`).join(', ');
    quienes.forEach((u, k) => {
      const v = p[u.id]; if (!v) return;
      const y1 = y(base + v), y0 = y(base), top = k === quienes.length - 1 || quienes.slice(k + 1).every(w => !p[w.id]);
      bars += `<rect x="${pad + i * bw + 4}" y="${y1}" width="${bw - 8}" height="${Math.max(0, y0 - y1 - 2)}" rx="${top ? 4 : 0}" fill="${color[u.id]}"/>`;
      base += v;
    });
    bars += `<rect x="${pad + i * bw}" y="10" width="${bw}" height="${H - 32}" fill="transparent" data-tip="${esc(label)}"/>`;
    if (i % 2 === 0 || pila.length < 8) bars += `<text x="${pad + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" class="ax">${new Date(wk[i] - 6 * DAY).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</text>`;
  });
  const grid = [0, Math.ceil(max / 2), max].map(v => `<line x1="${pad}" x2="${Wd}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${pad - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${Wd} ${H}" class="wk" role="img" aria-label="Presupuestos creados por semana y comercial">${grid}${bars}</svg>`;
}

function potEditor(pots, cat) {
  const opciones = { 1: ['armarios_vestuario', 'estructuras_picking', 'estanterias_ligeras', 'estanterias_longspan', 'estanterias_paletizacion'], 3: ['cajas_athena', 'cajas_nexit', 'cajas_logistica', 'cajas_picking'] };
  const activas = slot => new Set(pots.filter(p => p.slot === slot).flatMap(p => p.familias.split('/').map(s => s.trim())));
  return [1, 3].map(slot => { const on = activas(slot);
    return `<fieldset class="pot-ed"><legend>Tarjeta ${slot}</legend>${opciones[slot].map(f => `<label class="ag-chk"><input type="checkbox" data-slot="${slot}" value="${f}" ${on.has(f) ? 'checked' : ''}> ${esc(cat.familyLabel(f))}</label>`).join('')}</fieldset>`; }).join('');
}

function tooltips(root) {
  let tip = document.getElementById('pn-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'pn-tip'; tip.className = 'pn-tip'; tip.hidden = true; document.body.appendChild(tip); }
  root.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mousemove', e => { tip.textContent = el.dataset.tip; tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; });
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

function descargarCSV(Q, D) {
  const cols = ['comercial', 'oferta', 'fecha', 'estado', 'proxima_accion', 'fecha_seguimiento', 'acciones_hechas', 'cliente', 'importe', 'lineas', 'venta_cruzada'];
  const rows = Q.map(q => [q.full_name, q.offer_number, q.quote_date, QST[q.status], q.next_action || '', q.follow_up || '', q.actions_done || 0, q.client_label || '', q.total_amount ?? '', q.lines_count, q.extras_count]);
  const csv = '﻿' + [cols, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `presupuestos_equipo_${D.demo ? 'DEMO_' : ''}${iso(Date.now())}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}
