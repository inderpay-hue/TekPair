-- ════════════════════════════════════════════════════════════════
-- FIX RLS — eliminar política anónima sobrante en `servicios`
-- Auditoría RLS jun-2026.
--
-- Contexto: `servicios_anon_select_publicos` (using: publico = true) dejaba
-- que cualquiera con la anon key (pública) leyera los servicios `publico=true`
-- de TODAS las tiendas sin filtrar por tienda → scraping cross-tenant del
-- catálogo de precios públicos.
--
-- Ya no la usa nadie: la página pública de citas (citas.html) migró a
-- /api/citas-publicas, que usa service_role server-side y filtra por
-- tienda_id (api/citas-publicas.js:177). Ninguna página pública consulta
-- `servicios` por REST con la anon key. Quitarla NO rompe nada y cierra la fuga.
--
-- Idempotente (drop ... if exists). Correr en el SQL Editor de Supabase.
-- Verificar después con sql/verificar-rls.sql.
-- ════════════════════════════════════════════════════════════════

drop policy if exists servicios_anon_select_publicos on public.servicios;

-- Comprobación: tras correr, esta consulta NO debe devolver filas.
-- select policyname from pg_policies
-- where schemaname='public' and tablename='servicios'
--   and policyname='servicios_anon_select_publicos';
