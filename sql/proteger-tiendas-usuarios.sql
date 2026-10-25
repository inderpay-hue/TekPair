-- proteger-tiendas-usuarios.sql - Columnas que solo puede tocar el servidor (TekPair)
--
-- Las politicas de tiendas y usuarios dejaban a cualquier usuario autenticado de la
-- tienda (tambien un empleado) hacer UPDATE de toda la fila desde la API REST:
--   tiendas.plan / plan_status / plan_until... -> saltarse el pago de Stripe
--   usuarios.rol / permisos / activo -> un empleado se hacia administrador
-- La app nunca escribe esas columnas desde el navegador: las cambian las funciones del
-- servidor (api/*.js con service role). Un trigger deja esas columnas como estaban
-- cuando quien escribe es el rol 'authenticated' (el navegador), sin dar error.
-- Ademas, crear o borrar tiendas y usuarios queda solo para el servidor.
-- Se puede ejecutar dos veces.

create or replace function proteger_tiendas_cols() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.id := old.id;
    new.usuario_id := old.usuario_id;
    new.plan := old.plan;
    new.plan_status := old.plan_status;
    new.plan_until := old.plan_until;
    new.trial_until := old.trial_until;
    new.plan_email := old.plan_email;
    new.trial_email_3d_sent := old.trial_email_3d_sent;
    new.trial_email_1d_sent := old.trial_email_1d_sent;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_sub_id := old.stripe_sub_id;
    new.codigo_referido := old.codigo_referido;
    new.descuento_pct := old.descuento_pct;
    new.referral_code := old.referral_code;
    new.impago_desde := old.impago_desde;
    new.cobro_manual := old.cobro_manual;
    new.tarjeta_avisada_at := old.tarjeta_avisada_at;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_tiendas_cols on tiendas;
create trigger trg_proteger_tiendas_cols before update on tiendas
  for each row execute function proteger_tiendas_cols();

create or replace function proteger_usuarios_cols() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.id := old.id;
    new.tienda_id := old.tienda_id;
    new.email := old.email;
    new.password_hash := old.password_hash;
    new.password_hash_v2 := old.password_hash_v2;
    new.rol := old.rol;
    new.activo := old.activo;
    new.permisos := old.permisos;
    new.permisos_caja := old.permisos_caja;
    new.reset_token := old.reset_token;
    new.reset_expira := old.reset_expira;
    new.codigo := old.codigo;
    new.plan := old.plan;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_usuarios_cols on usuarios;
create trigger trg_proteger_usuarios_cols before update on usuarios
  for each row execute function proteger_usuarios_cols();

-- Antes: una politica ALL (select, insert, update, delete). Ahora el navegador solo lee y
-- actualiza su tienda / los usuarios de su tienda; altas y bajas van por el servidor.
drop policy if exists tiendas_auth_full on tiendas;
drop policy if exists tiendas_auth_select on tiendas;
drop policy if exists tiendas_auth_update on tiendas;
create policy tiendas_auth_select on tiendas for select to authenticated using (id = (auth.jwt() ->> 'tienda_id'));
create policy tiendas_auth_update on tiendas for update to authenticated using (id = (auth.jwt() ->> 'tienda_id')) with check (id = (auth.jwt() ->> 'tienda_id'));

drop policy if exists usuarios_auth_full on usuarios;
drop policy if exists usuarios_auth_select on usuarios;
drop policy if exists usuarios_auth_update on usuarios;
create policy usuarios_auth_select on usuarios for select to authenticated using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy usuarios_auth_update on usuarios for update to authenticated using (tienda_id = (auth.jwt() ->> 'tienda_id')) with check (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- Comprobacion. Esperado: 2 triggers y 4 politicas.
select (select count(*) from pg_trigger where tgname in ('trg_proteger_tiendas_cols', 'trg_proteger_usuarios_cols')) as triggers,
       (select count(*) from pg_policies where tablename in ('tiendas', 'usuarios')) as politicas;
