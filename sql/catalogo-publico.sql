-- ===========================================================================
-- CATALOGO PUBLICO
-- ===========================================================================
-- Que articulos del stock se ensenan en el enlace que la tienda comparte con
-- sus clientes: /catalogo.html?slug=<citas_slug>
--
-- Sin acentos a proposito: pegar SQL con caracteres no ASCII en el editor ha
-- dado problemas de codificacion otras veces.
--
-- Se puede ejecutar mas de una vez sin romper nada (todo lleva IF NOT EXISTS).
-- ===========================================================================


-- 1. Marca por articulo -----------------------------------------------------
-- Por defecto NADIE: arranca en false y el taller marca uno a uno lo que quiere
-- publicar. Al reves se publicarian de golpe moviles reservados, en reparacion
-- o que no se quieren ensenar, y eso no tiene vuelta atras una vez que alguien
-- lo ha visto.

alter table stock add column if not exists en_catalogo boolean not null default false;

comment on column stock.en_catalogo is 'true = visible en el catalogo publico de la tienda';


-- 2. Indice -----------------------------------------------------------------
-- La consulta publica filtra siempre por tienda + en_catalogo. Sin esto
-- recorreria el stock de todas las tiendas en cada visita.

create index if not exists ix_stock_catalogo
  on stock (tienda_id, en_catalogo)
  where en_catalogo = true;


-- 3. Interruptor general de la tienda ---------------------------------------
-- Permite apagar el catalogo entero de golpe sin desmarcar articulo por
-- articulo. Arranca apagado: ninguna tienda debe encontrarse su stock
-- publicado sin haberlo pedido.

alter table tiendas add column if not exists catalogo_activo boolean not null default false;

comment on column tiendas.catalogo_activo is 'true = el enlace publico del catalogo responde; false = 404 aunque haya articulos marcados';


-- 4. Comprobacion -----------------------------------------------------------
-- Debe devolver las dos columnas nuevas.

select table_name, column_name, data_type, column_default
from information_schema.columns
where (table_name = 'stock'   and column_name = 'en_catalogo')
   or (table_name = 'tiendas' and column_name = 'catalogo_activo')
order by table_name;
