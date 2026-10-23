// api/_lib/sb-todo.js
// Lee TODAS las filas de una consulta REST de Supabase, de 1000 en 1000.
// PostgREST corta cada respuesta en el máximo del proyecto (1000 por defecto) aunque
// la URL pida limit=10000, así que sin esto las cuentas salen incompletas en silencio.
export async function sbTodo(url, headers, pagina = 1000) {
  const out = [];
  for (let desde = 0; desde < 1000000; desde += pagina) {
    const r = await fetch(url, { headers: { ...headers, 'Range-Unit': 'items', 'Range': `${desde}-${desde + pagina - 1}` } });
    if (!r.ok && r.status !== 206) { if (desde === 0) throw new Error('sbTodo ' + r.status); break; }
    const filas = await r.json();
    if (!Array.isArray(filas)) break;
    out.push(...filas);
    if (filas.length < pagina) break;
  }
  return out;
}
