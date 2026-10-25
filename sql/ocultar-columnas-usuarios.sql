-- ocultar-columnas-usuarios.sql - El navegador no puede leer hashes ni tokens (TekPair)
-- EJECUTAR SOLO DESPUES de publicar la version que pide columnas concretas de usuarios
-- (sin select=*): con un select=* el navegador recibiria "permission denied".
-- El servidor (service role) sigue leyendo todo. Ejecutable dos veces.
revoke select on usuarios from authenticated, anon;
grant select (id, tienda_id, nombre, email, rol, activo, permisos, permisos_caja, codigo, ultimo_acceso, created_at, plan, notif_read)
  on usuarios to authenticated;
-- Comprobacion: password_hash, password_hash_v2, reset_token y reset_expira NO deben salir
select column_name from information_schema.column_privileges
 where table_name = 'usuarios' and grantee = 'authenticated' and privilege_type = 'SELECT' order by 1;
