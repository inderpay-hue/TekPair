-- tarifas-calidad.sql — varias calidades por avería (pantalla Original / OLED / Incell…)
alter table public.tarifas add column if not exists calidad text;

-- Comprobación: debe salir 1
select count(*) as columna_calidad from information_schema.columns
 where table_schema = 'public' and table_name = 'tarifas' and column_name = 'calidad';
