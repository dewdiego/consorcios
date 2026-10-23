# Cierre de permisos (login obligatorio)

Hasta ahora la base aceptaba lecturas y escrituras anónimas. Con esta actualización:
- La app de administración pide **mail + contraseña**.
- Sólo entran los mails que figuran en **Mi Administración → Usuarios** (activos) y tienen cuenta en Supabase.
- Los vecinos del portal se loguean con código, pero no son operadores: no pueden tocar la base; sólo ven lo suyo a través de la función `portal`.

## Pasos (en este orden, para no quedar afuera)

1. **Subir esta versión** de la app (push) y esperar el deploy. Todavía va a funcionar sin login mientras no corras el SQL.
2. **Crear tu cuenta**: Supabase → Authentication → Users → **Add user** → mail y contraseña → marcá "Auto Confirm User".
   Repetí para cada operador (Andrea, etc.).
3. **Habilitarlos como operadores**: en la app → Mi Administración → Usuarios, cargá cada uno con el **mismo mail**.
   (Si ya los tenías cargados, verificá que el mail coincida exactamente.)
4. **Correr el SQL** `supabase/migrations/20261023160000_seguridad.sql` en el SQL Editor. Al final te lista los usuarios habilitados.
5. **Ctrl + F5** en la app: aparece la pantalla de login. Entrá con tu mail y contraseña.
6. **Volver a pegar** en Supabase las funciones `enviar-expensas` e `importar-liquidacion` (versión nueva: verifican que quien las llama sea operador).

## Si te quedás afuera
Corré en el SQL Editor (reemplazando el mail):
```sql
INSERT INTO usuarios (nombre, email, rol) VALUES ('Diego', 'tu@mail.com', 'admin')
ON CONFLICT (email) DO UPDATE SET activo = true;
```
y asegurate de que ese mail tenga cuenta en Authentication → Users.

## Para dar de alta un operador nuevo, siempre dos cosas
1. Authentication → Users → Add user (mail + contraseña).
2. Mi Administración → Usuarios → Nuevo, con el mismo mail.
