// Sincronización con el servidor central. Solo sube lo autorizado:
//   cabecera (nº de oferta, fecha, estado, seguimiento, recuentos), líneas (código, ficha, cantidad, grupo, estado)
//   y eventos de venta cruzada / aprendizaje.
// NUNCA: el PDF, el texto del presupuesto, descripciones, medidas, precios ni datos del cliente.
// Nombre del cliente e importe solo si el comercial marca «compartir».
import { db } from './db.js';
import { sb } from './auth.js';
import { uuid } from './util.js';

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

/** dd/mm/aaaa (o aa) → aaaa-mm-dd; si no se entiende, null */
export function isoDate(s) {
  const m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s || '');
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  const d = new Date(Date.UTC(+y, +m[2] - 1, +m[1]));
  return d.getUTCMonth() === +m[2] - 1 ? d.toISOString().slice(0, 10) : null;
}

/** Lo único que sale del ordenador para un presupuesto */
export function payload(q, cat) {
  const a = q.agenda || {};
  const head = {
    client_uuid: q.id,
    offer_number: cut(q.offer, 40) || null,
    quote_date: isoDate(q.date),
    status: q.status || 'en_preparacion',
    follow_up: a.seguimiento || null,
    next_action: a.siguiente || null,
    actions_done: a.hechas || 0,
    share_client: !!(a.compartirCliente && a.cliente),
    client_label: a.compartirCliente && a.cliente ? cut(a.cliente, 80) : null,
    share_amount: !!(a.compartirImporte && a.importe != null && a.importe !== ''),
    total_amount: a.compartirImporte && a.importe != null && a.importe !== '' ? Math.max(0, +a.importe || 0) : null,
    lines_count: q.lines.filter(l => l.include !== false).length,
    extras_count: (q.extras || []).length,
    catalogs_generated: q.catalogs || 0,
    updated_at: q.updatedAt,
    deleted_at: null,
  };
  const lines = [];
  let pos = 0;
  for (const l of q.lines) {
    if (l.include === false) continue;
    const p = l.match?.pi != null ? cat.product(l.match.pi) : null;
    lines.push({ position: ++pos, ref: cut(l.ref, 40), product_ref: p?.id || null, product_name: cut(p?.name, 160),
      quantity: Number.isFinite(+l.qty) && l.qty !== '' && l.qty != null ? +l.qty : null, group_label: cut(l.group, 60) || null,
      match_status: l.match?.status || 'sin_ficha', is_extra: false });
  }
  for (const e of q.extras || []) {
    const p = cat.product(e.pi);
    lines.push({ position: ++pos, ref: cut(e.ref, 40), product_ref: p?.id || null, product_name: cut(p?.name, 160),
      quantity: null, group_label: 'TE PUEDE INTERESAR', match_status: 'seguro', is_extra: true });
  }
  const events = (q.reco?.eventos || []).filter(e => !e.sync).map(e => ({
    client_event_id: e.id, product_ref: e.producto, family: e.familia || null, slot: e.slot ?? 0,
    badge: e.tipo || null, score: e.score ?? null, action: e.accion === 'añadida' ? 'anadida' : e.accion, created_at: e.at,
  }));
  return { head, lines, events };
}

// ── Cola local (sobrevive a cierres y a estar sin conexión) ──
export const queue = {
  quote: id => db.put('outbox', { id: 'q:' + id, type: 'quote', quoteId: id, at: Date.now() }),
  remove: id => db.put('outbox', { id: 'q:' + id, type: 'delete', quoteId: id, at: Date.now() }),
  learn: (kind, key, value) => db.put('outbox', { id: uuid(), type: 'learn', kind, key: cut(key, 120), value, at: Date.now() }),
  count: async () => (await db.all('outbox')).length,
};

let running = null;
/** Envía la cola. Devuelve {sent, pending, error}. Nunca lanza: la cola se reintenta más tarde. */
export function flush(cat, me) {
  if (running) return running;
  running = (async () => {
    const client = sb();
    if (!client || !me || !navigator.onLine) return { sent: 0, pending: await queue.count() };
    let sent = 0, error = null;
    const items = (await db.all('outbox')).sort((a, b) => a.at - b.at);
    for (const it of items) {
      try {
        if (it.type === 'quote') await sendQuote(client, it.quoteId, cat, me);
        else if (it.type === 'delete') {
          const { error: e } = await client.from('shared_quotes').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('owner_id', me.id).eq('client_uuid', it.quoteId);
          if (e) throw e;
        } else if (it.type === 'learn') {
          const { error: e } = await client.from('learning_events')
            .upsert({ client_event_id: it.id, owner_id: me.id, kind: it.kind, key: it.key, value: it.value ?? null },
              { onConflict: 'client_event_id', ignoreDuplicates: true });
          if (e) throw e;
        }
        await db.del('outbox', it.id); sent++;
      } catch (e) {
        if (/stale_update/.test(e?.message || '')) { await db.del('outbox', it.id); continue; }   // el servidor ya tiene algo más nuevo
        error = e?.message || String(e); break;                                                  // sin red o sesión caducada: se reintenta
      }
    }
    return { sent, pending: await queue.count(), error };
  })().finally(() => { running = null; });
  return running;
}

async function sendQuote(client, id, cat, me) {
  const q = await db.get('quotes', id);
  if (!q) return;
  if ((q.reco?.eventos || []).some(e => !e.id)) { q.reco.eventos.forEach(e => { e.id ||= uuid(); }); await db.put('quotes', q); }   // eventos de antes de la Fase 5
  const { head, lines, events } = payload(q, cat);
  const { data, error } = await client.from('shared_quotes')
    .upsert({ ...head, owner_id: me.id }, { onConflict: 'owner_id,client_uuid' }).select('id').single();
  if (error) throw error;
  const qid = data.id;
  let r = await client.from('shared_quote_lines').delete().eq('quote_id', qid);
  if (r.error) throw r.error;
  if (lines.length) { r = await client.from('shared_quote_lines').insert(lines.map(l => ({ ...l, quote_id: qid }))); if (r.error) throw r.error; }
  if (events.length) {
    r = await client.from('recommendation_events').upsert(events.map(e => ({ ...e, quote_id: qid })), { onConflict: 'client_event_id', ignoreDuplicates: true });
    if (r.error) throw r.error;
    // marcar como enviados sin tocar updatedAt (no es un cambio del comercial)
    const fresh = await db.get('quotes', id);
    const sentIds = new Set(events.map(e => e.client_event_id));
    (fresh.reco?.eventos || []).forEach(e => { if (sentIds.has(e.id)) e.sync = 1; });
    await db.put('quotes', fresh);
  }
}

/** Potenciales publicados por dirección (sustituyen a los del catálogo si existen) */
export async function fetchRules() {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client.from('rule_sets').select('version, payload').eq('is_current', true).maybeSingle();
  if (error || !data) return null;
  return data;
}
