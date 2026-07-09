# DEMAC Corporation — MVP Web + Android

Aplicación operativa de demostración para **DEMAC — Professional Cooling Solutions**.

## Incluye

- Inicio de sesión con roles: administrador, oficina/ventas, supervisor, técnico, contabilidad e inventario.
- Panel administrativo con agenda, cobros, cuentas por cobrar y alertas.
- Agenda y despacho con creación de citas y actualización de estados.
- Clientes, propiedades, equipos e historial de trabajos.
- Órdenes de trabajo y aprobación de reportes.
- Flujo móvil para técnicos con mediciones, diagnóstico, fotos y conformidad del cliente.
- Ventas, invoices y registro de pagos.
- Inventario con mínimos y ajustes de existencias.
- Persistencia local de los cambios DEMO.
- Diseño adaptable para navegador y teléfonos Android.

## Credenciales DEMO

Administrador:
- Correo: `admin@demac.demo`
- Contraseña: `demac2026`

Los demás perfiles pueden abrirse desde los accesos rápidos de la pantalla de inicio.

## Ejecutar

```bash
npm install
npm run web
```

Para Android:

```bash
npm run android
```

También puede abrirse con Expo Go en un Samsung mientras el equipo y el teléfono estén en la misma red.

## Verificación de tipos

```bash
npx tsc --noEmit
```

## Estado actual

Este paquete es un MVP funcional con datos ficticios y almacenamiento local. Antes de producción deben conectarse Firebase Authentication, Cloud Firestore, Cloud Storage, reglas de seguridad, dominio, cuenta Google Play y documentos oficiales de DEMAC.
