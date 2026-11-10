// Conexión con el servidor central (Supabase).
// La clave «publishable/anon» es pública por diseño: los datos los protegen las reglas de acceso (RLS) del servidor.
// NUNCA poner aquí la clave service_role / secret.
// Vacío = la app funciona solo en este ordenador, sin usuarios ni sincronización.
export const CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
