-- compra-usados-lote-fotos.sql - Compra de usados: varios telefonos por contrato y fotos
--   lote_id   : une los telefonos comprados al mismo vendedor en un solo contrato
--   doc_fotos : rutas (bucket gastos-adjuntos) de la foto o escaneo del documento del vendedor
--   fotos     : rutas de las fotos del telefono
-- Se puede ejecutar dos veces sin problema. ASCII puro a proposito.
alter table compras_usados add column if not exists lote_id uuid;
alter table compras_usados add column if not exists doc_fotos jsonb;
alter table compras_usados add column if not exists fotos jsonb;
create index if not exists compras_usados_lote_idx on compras_usados (lote_id) where lote_id is not null;
select count(*) as columnas_nuevas from information_schema.columns
 where table_name = 'compras_usados' and column_name in ('lote_id', 'doc_fotos', 'fotos');
