-- TekPair · Habilitar Supabase Realtime (sincronización instantánea entre dispositivos)
-- Idempotente: se puede ejecutar varias veces sin error.
-- 1) Añade cada tabla a la publicación supabase_realtime si no está ya.
-- 2) replica identity full → los eventos DELETE incluyen tienda_id (necesario para el
--    filtro por tienda y para que la RLS de Realtime decida a quién enviar el cambio).

do $$
declare t text;
begin
  foreach t in array array[
    'reparaciones','ventas','stock','clientes','gastos','proveedores',
    'pedidos','gastos_recurrentes','pagos_proveedor','servicios','citas','tiendas'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- Comprobar qué tablas quedaron habilitadas:
-- select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename;
