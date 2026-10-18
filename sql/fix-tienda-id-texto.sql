-- =============================================================
-- fix-tienda-id-texto.sql
-- Las tiendas de TekPair tienen id de TEXTO ('tienda_1778374299537'), pero estas
-- tablas se crearon con tienda_id uuid: en 12 de las 13 tiendas nada se guardaba
-- (encargos, cuadres y saldos de caja, compras de usados, herramientas). El id no
-- se podía convertir a uuid y la nube lo rechazaba; al recargar se perdía.
-- Se pasa tienda_id a texto y las reglas de acceso comparan como texto.
-- En una transacción: si algo falla, no cambia nada.
-- =============================================================
begin;

-- encargos
drop policy if exists encargos_delete on public.encargos;
drop policy if exists encargos_insert on public.encargos;
drop policy if exists encargos_select on public.encargos;
drop policy if exists encargos_update on public.encargos;
alter table public.encargos alter column tienda_id type text using tienda_id::text;
alter table public.encargos alter column cliente_id type text using cliente_id::text;
create policy encargos_delete on public.encargos for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy encargos_insert on public.encargos for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy encargos_select on public.encargos for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy encargos_update on public.encargos for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- cajas_cuadre_lineas
drop policy if exists cajas_cuadre_lineas_delete on public.cajas_cuadre_lineas;
drop policy if exists cajas_cuadre_lineas_insert on public.cajas_cuadre_lineas;
drop policy if exists cajas_cuadre_lineas_select on public.cajas_cuadre_lineas;
drop policy if exists cajas_cuadre_lineas_update on public.cajas_cuadre_lineas;
alter table public.cajas_cuadre_lineas alter column tienda_id type text using tienda_id::text;
create policy cajas_cuadre_lineas_delete on public.cajas_cuadre_lineas for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuadre_lineas_insert on public.cajas_cuadre_lineas for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuadre_lineas_select on public.cajas_cuadre_lineas for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuadre_lineas_update on public.cajas_cuadre_lineas for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- cajas_cuadres
drop policy if exists cajas_cuadres_delete on public.cajas_cuadres;
drop policy if exists cajas_cuadres_insert on public.cajas_cuadres;
drop policy if exists cajas_cuadres_select on public.cajas_cuadres;
drop policy if exists cajas_cuadres_update on public.cajas_cuadres;
alter table public.cajas_cuadres alter column tienda_id type text using tienda_id::text;
create policy cajas_cuadres_delete on public.cajas_cuadres for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuadres_insert on public.cajas_cuadres for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuadres_select on public.cajas_cuadres for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuadres_update on public.cajas_cuadres for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- cajas_cuentas
drop policy if exists cajas_cuentas_delete on public.cajas_cuentas;
drop policy if exists cajas_cuentas_insert on public.cajas_cuentas;
drop policy if exists cajas_cuentas_select on public.cajas_cuentas;
drop policy if exists cajas_cuentas_update on public.cajas_cuentas;
alter table public.cajas_cuentas alter column tienda_id type text using tienda_id::text;
create policy cajas_cuentas_delete on public.cajas_cuentas for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuentas_insert on public.cajas_cuentas for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuentas_select on public.cajas_cuentas for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_cuentas_update on public.cajas_cuentas for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- cajas_saldo_mov
drop policy if exists cajas_saldo_mov_delete on public.cajas_saldo_mov;
drop policy if exists cajas_saldo_mov_insert on public.cajas_saldo_mov;
drop policy if exists cajas_saldo_mov_select on public.cajas_saldo_mov;
alter table public.cajas_saldo_mov alter column tienda_id type text using tienda_id::text;
create policy cajas_saldo_mov_delete on public.cajas_saldo_mov for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_saldo_mov_insert on public.cajas_saldo_mov for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy cajas_saldo_mov_select on public.cajas_saldo_mov for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- compras_usados
drop policy if exists compras_usados_insert on public.compras_usados;
drop policy if exists compras_usados_select on public.compras_usados;
drop policy if exists compras_usados_update on public.compras_usados;
alter table public.compras_usados alter column tienda_id type text using tienda_id::text;
create policy compras_usados_insert on public.compras_usados for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy compras_usados_select on public.compras_usados for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy compras_usados_update on public.compras_usados for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));

-- herramientas_tienda
drop policy if exists herramientas_tienda_delete on public.herramientas_tienda;
drop policy if exists herramientas_tienda_insert on public.herramientas_tienda;
drop policy if exists herramientas_tienda_select on public.herramientas_tienda;
drop policy if exists herramientas_tienda_update on public.herramientas_tienda;
alter table public.herramientas_tienda alter column tienda_id type text using tienda_id::text;
create policy herramientas_tienda_delete on public.herramientas_tienda for delete using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy herramientas_tienda_insert on public.herramientas_tienda for insert with check (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy herramientas_tienda_select on public.herramientas_tienda for select using (tienda_id = (auth.jwt() ->> 'tienda_id'));
create policy herramientas_tienda_update on public.herramientas_tienda for update using (tienda_id = (auth.jwt() ->> 'tienda_id'));

commit;

-- Comprobación: debe salir 0 (ninguna tabla con tienda_id uuid)
select count(*) as tablas_con_uuid from information_schema.columns
 where table_schema = 'public' and column_name = 'tienda_id' and data_type = 'uuid';
