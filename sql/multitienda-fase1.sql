-- ════════════════════════════════════════════════════════════════════
-- Multi-tienda · Fase 1 — enlace usuario ↔ tiendas (sin Stripe todavía)
-- Un dueño (usuario admin) puede acceder a varias tiendas y cambiar entre
-- ellas con un selector. La autorización vive AQUÍ; el endpoint cambiar-tienda
-- re-emite un JWT solo para tiendas enlazadas. La RLL de datos NO cambia
-- (sigue filtrando por el tienda_id del JWT). usuario_id y tienda_id son TEXT
-- (ids tipo 'usr_…' / 'tienda_…').
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usuario_tiendas (
  usuario_id text NOT NULL,
  tienda_id  text NOT NULL,
  rol        text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, tienda_id)
);

ALTER TABLE usuario_tiendas ENABLE ROW LEVEL SECURITY;

-- El usuario solo ve sus propios enlaces (el endpoint usa SERVICE_KEY, pero por si
-- el cliente consulta directo). 'sub' del JWT = id del usuario.
DROP POLICY IF EXISTS "usuario_ve_sus_tiendas" ON usuario_tiendas;
CREATE POLICY "usuario_ve_sus_tiendas" ON usuario_tiendas
  FOR SELECT USING (usuario_id = (auth.jwt() ->> 'sub'));

-- ── Cómo enlazar tiendas a un dueño (Fase 1, manual) ──
-- 1) Encuentra tu id de usuario y tus tiendas:
--    select id, email, tienda_id from usuarios where email = 'tu@email.com';
--    select id, nombre from tiendas;   -- localiza las que son tuyas
-- 2) Enlaza cada tienda EXTRA (la primaria ya está autorizada de serie):
--    insert into usuario_tiendas (usuario_id, tienda_id) values ('usr_…', 'tienda_…');
--    insert into usuario_tiendas (usuario_id, tienda_id) values ('usr_…', 'tienda_OTRA');
-- (La tienda primaria, usuarios.tienda_id, NO hace falta enlazarla: ya cuenta.)
