# Task: preparar integración gobernada de ventas y pagos

## Context

- Request/source: propietario, 2026-10-13, «ok continuemos» tras acordar comenzar
  planificación de ventas/pagos y completar pruebas de lectura.
- Product surface: ERP Next y futura integración privilegiada QuickBooks.
- Base: `f4369f3a4e4835f17cb8a387596494f427af53f0`, incluye PR #594 y #596.
- Evidencia: comparación de los P&L reales confirmada en conversación; Balance Sheet
  rechazado por el validador. Registros operativos de citas aún no se contabilizan en QBO.

## Scope

- In scope: diseño concreto, relaciones requeridas, casos de aceptación, diagnóstico
  acotado de Balance Sheet y actualización de evidencia documental.
- Out of scope: escrituras QBO, nuevos permisos, datos reales en pruebas, deploy,
  migración histórica, crear un libro contable, cambiar agenda/importes o credenciales.
- Files/boundaries: solo documentación; [plan](../plans/quickbooks-sales-payments-20261013.md).

## Governance

- Authorities: CRM/Pricing/Booking/Field/Inventory existentes; QBO conserva contabilidad.
- Rules: OPS-SCHED-CHARGES-001/002; FIN-QBO-PRODUCTION-READ-001; Authority Matrix.
- Security/privacy: no importar PDFs, cifras reales ni payloads a GitHub; no ampliar scopes.
- Legacy parity: conservar compatibilidad y bloqueos por vínculos financieros antiguos.
- Review: revisión adversarial separada del diseño; no representa aprobación de código
  de escritura ni aceptación de una nueva autoridad. No hay ADR aceptado ni cambios de reglas.

## Acceptance criteria

- [x] Flujo concreto cita confirmada → factura → pagos → consulta del saldo QBO.
- [x] Fuentes y relaciones explicadas sin usar demos/borradores como contabilidad real.
- [x] Doble envío, timeout, pagos parciales, correcciones y cambios externos contemplados.
- [x] Antecedentes de lectura actualizados sin guardar informes financieros.
- [x] Fallo Balance Sheet documentado sin atribuir una causa que no se ha probado.
- [x] Casos de Sandbox y gates de activación explícitos, identificados como pendientes.
- [ ] Implementar y ejecutar S01-S21: siguiente entrega, no logrado por esta documentación.
- [ ] Diagnóstico y corrección de Balance Sheet verificados en producción.
- [ ] Comparar los tres informes adicionales y verificar renovación real de autorización.

## Plan and risk

Progresar por lectura de relaciones, preparación sin POST, pruebas aisladas, revisión y
piloto real. Mantener deshabilitada la escritura hasta cumplir los gates acordados.
Anticipos, inventario, sobrepagos e históricos no deben quedar incluidos accidentalmente.
No hay migración ni rollback de runtime en esta entrega documental.

## Verification

- Gates aplicables: vínculos/rutas locales, revisión de consistencia y `git diff --check`.
- Resultado: cuatro archivos documentales, nueve vínculos locales válidos, 21 casos
  consecutivos y únicos; diff sin errores de whitespace ni cambios de runtime.
- Tests/build de runtime: N/A; ningún archivo ejecutable, permiso o configuración cambia.
- Pruebas Sandbox/producción de escrituras: NOT RUN; esta entrega solo define sus casos.
- Resultado de revisión: [registro separado](../reviews/quickbooks-sales-payments-design-20261013.md).
