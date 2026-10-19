-- =============================================================
-- stock-ajustar.sql (19-oct-2026)
-- Suma o resta unidades EN la base de datos (no "escribe la cantidad final"): si dos equipos
-- venden el mismo artículo a la vez, antes los dos escribían 2 sobre 3 y quedaba 2 en vez de 1.
-- security invoker → se aplican las mismas reglas de acceso (RLS) que al editar el stock.
-- p_min: tope inferior (0 en ventas); null = sin tope (las piezas de reparación pueden dejarlo
-- en negativo para avisar de que falta stock).
-- =============================================================
create or replace function public.ajustar_stock(p_id text, p_delta integer, p_min integer default null)
returns table (unidades integer, vendido boolean)
language plpgsql
security invoker
as $$
#variable_conflict use_column
begin
  return query
  update public.stock s
     set unidades = case when p_min is null then coalesce(s.unidades, 0) + p_delta
                         else greatest(p_min, coalesce(s.unidades, 0) + p_delta) end,
         vendido  = case when p_min is null then coalesce(s.vendido, false) and (coalesce(s.unidades, 0) + p_delta) <= 0
                         else (greatest(p_min, coalesce(s.unidades, 0) + p_delta) <= 0) end
   where s.id = p_id
  returning s.unidades::integer, s.vendido;
end;
$$;
grant execute on function public.ajustar_stock(text, integer, integer) to authenticated, anon;

-- Comprobación: debe salir 1
select count(*) as funcion_creada from pg_proc where proname = 'ajustar_stock';
