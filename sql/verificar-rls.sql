-- ════════════════════════════════════════════════════════════════
-- VERIFICACIÓN DE RLS (solo lectura) — TekPair
-- Correr en el SQL Editor de Supabase. No modifica nada.
-- Comprueba que CADA tabla que usa la app tiene RLS activada y políticas.
-- ════════════════════════════════════════════════════════════════

-- ── 1) ¿Cada tabla de la app tiene RLS activada y con políticas? ──
-- Cualquier fila que NO sea "✅ OK" es un agujero a revisar.
with app_tables(t) as (
  values ('audit'),('avisos'),('citas'),('clientes'),('encargos'),('gastos'),
         ('gastos_recurrentes'),('modelos_custom'),('notas'),('pagos_proveedor'),
         ('pagos_reparacion'),('payment_attempts'),('pedidos'),('proveedores'),
         ('reparaciones'),('servicios'),('stock'),('tiendas'),('usuarios'),('ventas')
)
select a.t as tabla,
       coalesce(c.relrowsecurity, false) as rls_activada,
       coalesce((select count(*) from pg_policies p
                 where p.schemaname='public' and p.tablename=a.t), 0) as n_politicas,
       case
         when c.oid is null then '❌ NO EXISTE'
         when not c.relrowsecurity then '🔴 RLS DESACTIVADA'
         when (select count(*) from pg_policies p
               where p.schemaname='public' and p.tablename=a.t) = 0 then '🔴 SIN POLITICAS'
         else '✅ OK'
       end as estado
from app_tables a
left join pg_class c
  on c.relname = a.t and c.relnamespace = 'public'::regnamespace
order by estado, tabla;

-- ── 2) ¿Las políticas aíslan por tienda_id? ──
-- Casi todas deben mencionar tienda_id. tiendas/usuarios filtran por id/owner (revisar a mano).
select tablename, policyname, cmd,
       case
         when coalesce(qual,'')      ilike '%tienda_id%'
           or coalesce(with_check,'') ilike '%tienda_id%' then '✅ filtra por tienda_id'
         when tablename in ('tiendas','usuarios') then 'ⓘ revisar (filtro por id/owner)'
         else '⚠️ NO menciona tienda_id'
       end as filtro
from pg_policies
where schemaname = 'public'
order by filtro, tablename, cmd;

-- ── 3) (Opcional) Tablas con RLS desactivada en TODO el esquema public ──
select c.relname as tabla_sin_rls
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and not c.relrowsecurity
order by 1;
