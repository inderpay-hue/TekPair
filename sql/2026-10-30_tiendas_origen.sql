-- 2026-10-30 · «¿Cómo nos has conocido?» del registro.
-- Lo guarda api/register.js aparte del alta (si falta la columna, el registro sigue).
-- Valores: google, instagram, tiktok, youtube, facebook, comercial, recomendacion, otro.
alter table public.tiendas add column if not exists origen text;
notify pgrst, 'reload schema';
-- Comprobación: select origen, count(*) from tiendas group by 1 order by 2 desc;
