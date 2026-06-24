#!/usr/bin/env node
/**
 * retencion-fotos.cjs — Limpieza de fotos de reparaciones antiguas (M7).
 *
 * Borra las fotos (recepción + entrega) de reparaciones ENTREGADAS cuya entrega es
 * anterior a N meses (RETENCION_MESES, por defecto 14 — cubre la garantía legal de
 * 2-3 años parcialmente; ajusta a tu criterio). Nunca toca reparaciones vivas, en
 * garantía ni recientes. Tras borrar, RECALCULA tiendas.storage_usado_bytes de cada
 * tienda afectada a partir del almacenamiento real (auto-corrige la deriva del contador).
 *
 * Pensado para correr desde un GitHub Action mensual (ver .github/workflows/retencion-fotos.yml).
 * Variables de entorno:
 *   SUPABASE_URL          (obligatoria)
 *   SUPABASE_SERVICE_KEY  (obligatoria — service role; va en los secrets del repo)
 *   RETENCION_MESES       (opcional, default 14)
 *   RETENCION_DRY         (opcional, "1" = solo informar, no borrar nada)
 */
// Normaliza la URL: quita comillas/espacios, añade https:// si falta, y recorta
// una barra final o un /rest/v1 sobrante. Así funciona la pegues como la pegues.
let SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '').trim();
SB_URL = SB_URL.replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
if (SB_URL && !/^https?:\/\//i.test(SB_URL)) SB_URL = 'https://' + SB_URL;
const SK = (process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/^["']|["']$/g, '').trim();
const MESES = parseInt(process.env.RETENCION_MESES || '14', 10);
const DRY = process.env.RETENCION_DRY === '1';
const BUCKET = 'gastos-adjuntos';

function log(m) { console.log('[retencion] ' + m); }
function die(m) { console.error('[retencion][ERROR] ' + m); process.exit(1); }

const H = { 'apikey': SK, 'Authorization': 'Bearer ' + SK, 'Content-Type': 'application/json' };

async function main() {
  if (!SB_URL || !SK) die('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY.');

  const corte = new Date();
  corte.setMonth(corte.getMonth() - MESES);
  const corteIso = corte.toISOString().slice(0, 10);
  log('Corte: reparaciones Entregadas con fecha_entrega_real < ' + corteIso + ' (>' + MESES + ' meses)' + (DRY ? ' · DRY RUN' : ''));

  // 1) Reparaciones entregadas y antiguas con alguna foto.
  const sel = 'select=id,tienda_id,fotos_recepcion,fotos_entrega';
  const url = `${SB_URL}/rest/v1/reparaciones?estado=eq.Entregado&fecha_entrega_real=lt.${encodeURIComponent(corteIso)}&${sel}`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) die('No se pudieron leer reparaciones: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const reps = await r.json();

  const conFotos = reps.filter(x => (Array.isArray(x.fotos_recepcion) && x.fotos_recepcion.length) || (Array.isArray(x.fotos_entrega) && x.fotos_entrega.length));
  log('Reparaciones candidatas: ' + reps.length + ' · con fotos: ' + conFotos.length);
  if (!conFotos.length) { log('Nada que limpiar. Fin.'); return; }

  const tiendasAfectadas = new Set();
  let fotosBorradas = 0, repsLimpiadas = 0;

  for (const rep of conFotos) {
    const paths = []
      .concat(Array.isArray(rep.fotos_recepcion) ? rep.fotos_recepcion : [])
      .concat(Array.isArray(rep.fotos_entrega) ? rep.fotos_entrega : [])
      .filter(Boolean);
    if (!paths.length) continue;
    tiendasAfectadas.add(rep.tienda_id);

    if (DRY) { log('  [dry] rep ' + rep.id + ' → ' + paths.length + ' fotos'); fotosBorradas += paths.length; repsLimpiadas++; continue; }

    // Borrar objetos del storage (exactos, por prefixes).
    const del = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: paths }) });
    if (!del.ok) { log('  ⚠ no se pudieron borrar fotos de rep ' + rep.id + ': ' + del.status); continue; }

    // Vaciar las columnas de la reparación.
    const up = await fetch(`${SB_URL}/rest/v1/reparaciones?id=eq.${encodeURIComponent(rep.id)}`, {
      method: 'PATCH', headers: { ...H, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ fotos_recepcion: [], fotos_entrega: [] })
    });
    if (!up.ok) { log('  ⚠ no se pudo limpiar la rep ' + rep.id + ': ' + up.status); continue; }
    fotosBorradas += paths.length; repsLimpiadas++;
  }

  log((DRY ? '[dry] ' : '') + 'Reparaciones limpiadas: ' + repsLimpiadas + ' · fotos borradas: ' + fotosBorradas);

  // 2) Recalcular storage_usado_bytes EXACTO por tienda afectada (auto-corrige el contador).
  if (DRY) { log('[dry] No se recalcula el uso.'); return; }
  for (const tienda of tiendasAfectadas) {
    try {
      const bytes = await usoRealTienda(tienda);
      const up = await fetch(`${SB_URL}/rest/v1/tiendas?id=eq.${encodeURIComponent(tienda)}`, {
        method: 'PATCH', headers: { ...H, 'Prefer': 'return=minimal' }, body: JSON.stringify({ storage_usado_bytes: bytes })
      });
      log('  tienda ' + tienda + ' → uso real ' + (bytes / 1048576).toFixed(1) + ' MB' + (up.ok ? '' : ' (no se pudo guardar)'));
    } catch (e) { log('  ⚠ recálculo falló para ' + tienda + ': ' + e.message); }
  }
  log('OK');
}

// Suma el tamaño de TODOS los objetos del bucket bajo {tienda}/reps (con paginación).
async function usoRealTienda(tienda) {
  let total = 0, offset = 0; const limit = 100;
  for (;;) {
    const r = await fetch(`${SB_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ prefix: tienda + '/reps', limit, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!r.ok) break;
    const items = await r.json();
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) { const sz = it && it.metadata && Number(it.metadata.size); if (sz) total += sz; }
    if (items.length < limit) break;
    offset += limit;
  }
  return total;
}

main().catch(e => die(e.stack || e.message));
