-- =============================================================
-- encargos-fase-c.sql
-- Encargos, fase 2: enlace con el pedido al proveedor y con la venta al entregar.
-- (tienda_id y estos campos son TEXTO, como el resto de TekPair.)
-- =============================================================
alter table public.encargos add column if not exists pedido_id text;
alter table public.encargos add column if not exists venta_id text;

-- Comprobación: debe salir 2
select count(*) as columnas from information_schema.columns
 where table_schema = 'public' and table_name = 'encargos' and column_name in ('pedido_id', 'venta_id');
