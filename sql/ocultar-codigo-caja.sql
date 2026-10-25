-- ocultar-codigo-caja.sql - El navegador no puede leer los códigos de caja (TekPair)
-- EJECUTAR SOLO DESPUES de publicar la versión que valida el código en api/cajas.js
-- y que pide los códigos al servidor (usuarios-admin op 'listar-codigos').
revoke select on usuarios from authenticated, anon;
grant select (id, tienda_id, nombre, email, rol, activo, permisos, permisos_caja, ultimo_acceso, created_at, plan, notif_read)
  on usuarios to authenticated;
select column_name from information_schema.column_privileges
 where table_name = 'usuarios' and grantee = 'authenticated' and privilege_type = 'SELECT' order by 1;
