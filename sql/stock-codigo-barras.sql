-- =============================================================
-- stock-codigo-barras.sql
-- Código de barras de cada producto del stock: en el TPV basta con pasar el
-- lector (o escribirlo y pulsar Enter) para añadirlo al ticket.
-- =============================================================
alter table public.stock add column if not exists codigo_barras text;
create index if not exists idx_stock_codigo_barras on public.stock (tienda_id, codigo_barras) where codigo_barras is not null;

-- Comprobación: debe salir 1
select count(*) as columna from information_schema.columns
 where table_schema = 'public' and table_name = 'stock' and column_name = 'codigo_barras';
