// api/_lib/ratelimit.js
// Rate-limiting compartido y DISTRIBUIDO sobre Upstash Redis (REST API).
//
// Por qué: los rate-limiters en memoria (Map por proceso) no sirven en serverless —
// Vercel tiene varias instancias y cold starts, así que el contador no es global y se evade.
// Este helper usa Upstash Redis (contador global vía INCR+EXPIRE) para un límite real.
//
// Robusto: si las env vars de Upstash no están configuradas, o Upstash falla, hace
// FALLBACK a un limitador en memoria (mismo comportamiento que antes) — nunca rompe producción.
// Esto permite desplegar el código ya y "encender" el modo distribuido con solo añadir las
// env vars UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (o KV_REST_API_URL / KV_REST_API_TOKEN).
//
// La carpeta empieza por "_" → Vercel NO la trata como función serverless (no consume del límite 12/12).

const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

// ── Fallback en memoria (por instancia) ──
const _mem = new Map();
function _memLimit(key, limit, windowMs) {
  const now = Date.now();
  let e = _mem.get(key);
  if (!e || now > e.resetAt) e = { count: 0, resetAt: now + windowMs };
  e.count++;
  _mem.set(key, e);
  if (_mem.size > 5000) { for (const [k, v] of _mem) if (now > v.resetAt) _mem.delete(k); }
  return { ok: e.count <= limit, remaining: Math.max(0, limit - e.count), backend: 'memory' };
}

/**
 * Comprueba y consume 1 del límite para `key`.
 * @param {string} key        identificador lógico (p.ej. "login:ip:1.2.3.4")
 * @param {number} limit      nº máximo de peticiones en la ventana
 * @param {number} windowSec  ventana en segundos
 * @returns {Promise<{ok:boolean, remaining:number, backend:string}>}
 */
export async function rateLimit(key, limit, windowSec) {
  if (!URL || !TOKEN) return _memLimit(key, limit, windowSec * 1000);
  const rkey = 'rl:' + key;
  try {
    // Pipeline atómico: INCR y (solo la primera vez, NX) fijar el TTL de la ventana.
    const r = await fetch(`${URL}/pipeline`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', rkey], ['EXPIRE', rkey, String(windowSec), 'NX']])
    });
    if (!r.ok) {
      console.error('[ratelimit] Upstash HTTP', r.status);
      return _memLimit(key, limit, windowSec * 1000);
    }
    const data = await r.json();
    const count = Array.isArray(data) && data[0] && typeof data[0].result === 'number' ? data[0].result : 0;
    return { ok: count <= limit, remaining: Math.max(0, limit - count), backend: 'upstash' };
  } catch (e) {
    // Fail-open a memoria (no bloquear el servicio si Upstash está caído).
    console.error('[ratelimit] error:', e.message);
    return _memLimit(key, limit, windowSec * 1000);
  }
}
