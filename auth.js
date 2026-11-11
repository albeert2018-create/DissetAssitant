// Acceso con usuario real (Supabase Auth). Contraseña mínima 12 caracteres y 2FA obligatoria para admin y CEO.
// Sin configuración, la app funciona en modo «solo este ordenador».
import { CONFIG } from './config.js';

export const MIN_PASSWORD = 12;
let client = null;

export function configured() { return !!(CONFIG.supabaseUrl && CONFIG.supabaseKey && window.supabase?.createClient); }
export function sb() { return client; }

/** Arranca el cliente. Si la URL trae un enlace de invitación o de nueva contraseña, devuelve su tipo. */
export async function initAuth() {
  if (!configured()) return { mode: 'local' };
  const h = location.hash;
  const linkType = /[#&]type=(invite|recovery|signup|magiclink)/.exec(h)?.[1] || null;
  const linkError = /[#&]error_description=([^&]+)/.exec(h)?.[1];
  client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  await client.auth.getSession();   // procesa el enlace (si lo hay)
  if (/access_token=|error_description=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
  return { mode: 'remote', linkType, linkError: linkError ? decodeURIComponent(linkError.replace(/\+/g, ' ')) : null };
}

export async function currentUser() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user || null;
}

export async function profile() {
  const u = await currentUser();
  if (!u) return null;
  const { data, error } = await client.from('profiles').select('id, full_name, email, phone, roles, active').eq('id', u.id).maybeSingle();
  if (error) throw error;
  return data;
}

export const isAdmin = p => !!p?.roles?.some(r => r === 'admin' || r === 'ceo');
/** Secciones del menú por rol. Comercial: su trabajo. CEO: agenda del equipo y dirección. Admin: todo. */
export function secciones(p, remote) {
  if (!remote) return ['home', 'agenda', 'pedidos', 'hist', 'equipo', 'panel'];          // modo local (demo): todo
  const r = new Set(p?.roles || []), s = new Set();
  if (r.has('comercial') || r.has('admin')) ['home', 'agenda', 'pedidos', 'hist'].forEach(x => s.add(x));
  if (r.has('ceo') || r.has('admin')) ['equipo', 'panel'].forEach(x => s.add(x));
  return [...s];
}

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message);
}
export async function signOut() { await client?.auth.signOut(); }

export async function resetPassword(email) {
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
  if (error) throw error;
}

export function passwordProblem(p, p2) {
  if (p.length < MIN_PASSWORD) return `Mínimo ${MIN_PASSWORD} caracteres.`;
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'Combina letras y números.';
  if (p !== p2) return 'Las dos contraseñas no coinciden.';
  return null;
}
export async function setPassword(p) {
  const { error } = await client.auth.updateUser({ password: p });
  if (error) throw error;
}

// ── 2FA (TOTP: Google Authenticator, Microsoft Authenticator, 1Password…) ──
export async function mfaState() {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  const { data: f } = await client.auth.mfa.listFactors();
  const totp = (f?.totp || []).find(x => x.status === 'verified');
  return { level: data.currentLevel, next: data.nextLevel, factorId: totp?.id || null };
}
export async function mfaEnroll() {
  const { data: f } = await client.auth.mfa.listFactors();
  for (const x of (f?.all || []).filter(x => x.status !== 'verified')) await client.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Disset Odiseo' });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
export async function mfaVerify(factorId, code) {
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) throw new Error('Código incorrecto o caducado. Prueba con el siguiente.');
}
