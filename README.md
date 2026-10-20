# Sistema de Administración de Consorcios

React + Vite + TypeScript + Supabase. Multi-consorcio, con el circuito completo de expensas:

**Gastos (categorías A/B/C/D) → Liquidación mensual → Prorrateo por coeficiente de cada UF →
Cupones (1º y 2º vencimiento con recargo) → Cobranza → Cuenta corriente por unidad.**

## Puesta en marcha

1. **Base de datos**: abrí el SQL Editor de tu proyecto Supabase y ejecutá
   `supabase/migrations/20261020200000_esquema_consorcios_v2.sql`.
   ⚠ La migración **borra las tablas del esquema anterior** (el de Bolt) y crea todo de nuevo.
2. `.env`: ya trae tu `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (mismo proyecto que usabas).
3. `npm install` y `npm run dev` (o `npm run build` y subir `dist/` a Netlify/Vercel como antes).

## Flujo de trabajo típico

1. **Consorcios**: creá el edificio y configurá sus reglas (día de 1º y 2º vencimiento, % recargo,
   % interés de mora mensual, honorarios de administración).
2. **Unidades**: cargá las UF con sus coeficientes A (expensas ordinarias), B (cocheras),
   C (cuota extraordinaria) y D (gastos particulares). Cada columna debe sumar 100% —
   la pantalla lo valida y lo marca en verde/rojo. Hay import/export CSV.
3. **Expensas → Liquidaciones**: creá la liquidación del período y cargá los gastos
   (o traé los *gastos pendientes* y generá *provisiones y honorarios* con un click).
4. **Cerrar período**: genera los cupones definitivos por UF (prorrateo + saldo anterior
   + intereses de mora). Luego **Enviar** publica las expensas.
5. **Cobranza**: desde la pestaña Cupones registrás cada pago (sugiere el monto según
   el vencimiento vigente); impacta en la cuenta corriente y genera el ingreso en Contabilidad.
6. **Pago a proveedores**: agrupá gastos impagos en una orden de pago y al pagarla
   se marcan los gastos y sale el egreso de caja.

## Reglas de negocio implementadas

- Prorrateo por coeficiente con validación de columnas al 100%.
- Saldo anterior por UF (deuda o saldo a favor) arrastrado automáticamente al liquidar.
- Interés de mora mensual configurable por consorcio sobre saldo vencido.
- Recargo % de 2º vencimiento sólo sobre los gastos del período.
- Estados de cupón pendiente/parcial/pagado según lo cobrado (pagos parciales soportados).
- Reabrir liquidación: regenera cupones conservando pagos.
- Provisiones (gastos fijos) + honorarios de administración generados por período.
- Sueldos: preliquidación (antigüedad 1%/año, aportes 17%, contribuciones 26,4%),
  al pagar genera el gasto (costo total) y el egreso de caja (neto).
- Compras: pedido → cotizaciones → adjudicación → OC → al facturar genera el gasto.
- Mantenimientos recurrentes que renuevan vencimiento al registrarlos; vista cruzada en Acciones Masivas.
- Certificación de documentación de proveedores con vencimientos.
- Planes de pago: cada cuota cobrada baja deuda real en la cta. cte.
- Contabilidad: movimientos automáticos (cobranzas/OP/sueldos), saldos por período, conciliación, retenciones.
- Calendario con vencimientos automáticos de expensas, mantenimientos y certificaciones.

## Notas

- La app no tiene login (igual que la versión anterior): las políticas RLS están abiertas para `anon`.
  Si más adelante querés usuarios con contraseña, se agrega Supabase Auth y se ajustan las políticas.
- Storage: la migración crea el bucket público `archivos` (para logos, firma y documentos).
