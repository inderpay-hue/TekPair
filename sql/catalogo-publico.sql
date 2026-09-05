-- Catálogo público: qué artículos del stock se enseñan en el enlace que la
-- tienda comparte con sus clientes.
--
-- Por defecto NADIE: `en_catalogo` arranca en false y el taller marca uno a uno
-- lo que quiere publicar. Es más trabajo, pero al revés se publicarían de golpe
-- móviles reservados, en reparación o que no se quieren enseñar, y eso no tiene
-- vuelta atrás una vez que alguien lo ha visto.

alter table stock add column if not exists en_catalogo boolean not null default false;

comment on column stock.en_catalogo is 'true = visible en el catálogo público de la tienda (/catalogo/<citas_slug>)';

-- La consulta pública siempre filtra por tienda + en_catalogo. Sin este índice
-- recorrería todo el stock de todas las tiendas en cada visita.
create index if not exists ix_stock_catalogo on stock (tienda_id, en_catalogo) where en_catalogo = true;

-- ---------------------------------------------------------------------------
-- Interruptor de la tienda: poder apagar el catálogo entero de golpe.
-- ---------------------------------------------------------------------------
-- Sin esto, para dejar de publicar habría que desmarcar artículo por artículo.
-- Arranca apagado: una tienda que actualiza TekPair no debe encontrarse con su
-- stock publicado sin haberlo pedido.

alter table tiendas add column if not exists catalogo_activo boolean not null default false;

comment on column tiendas.catalogo_activo is 'true = el enlace público del catálogo responde; false = 404 aunque haya artículos marcados';
