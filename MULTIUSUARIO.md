# Multi-administración

Cada administradora (fila de la tabla `administracion`) tiene sus propios consorcios, proveedores, comunicados,
teléfonos, archivos y usuarios. Nadie ve lo de otra. Los superadmin ven todo.

## Activar (una vez)
1. Supabase → SQL Editor → correr `supabase/migrations/20261026120000_multiusuario.sql`.
   Al final muestra la lista de usuarios con su administración: todo lo existente queda en "Grupo Amel"
   (la única administración que había) y dwainer@dypsa.com / dewdiego@gmail.com quedan como superadmin.
2. Supabase → Edge Functions → crear `admin-usuarios` con `supabase/functions/admin-usuarios/index.ts` (invita usuarios por mail).
3. Volver a deployar `portal` y `enviar-expensas` (versiones nuevas: filtran por administración y firman los mails con su nombre).
4. Supabase → Authentication → Email Templates → "Invite user": el link del mail tiene que apuntar a la app
   (variable `{{ .ConfirmationURL }}`, ya viene así). Authentication → URL Configuration → agregar la URL de la app en "Redirect URLs".
5. Commit + push del código.

## Dar de alta otra administradora (superadmin)
Mi Administración → Usuarios → pestaña **Administraciones** → Nueva. Después, pestaña Usuarios → **Invitar usuario**
con rol Administrador y esa administración. Le llega un mail, elige contraseña y ya puede cargar sus consorcios e invitar a su gente.

## Qué se comparte entre administraciones
Rubros de gastos, tipos de mantenimiento y parámetros legales (aportes, contribuciones, retenciones). Todo lo demás es privado.
