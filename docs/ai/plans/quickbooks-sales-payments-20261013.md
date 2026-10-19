# DEMAC: diseño de integración de ventas y pagos con QuickBooks

Fecha: 2026-10-13. Estado: **propuesta de implementación; ninguna escritura activada**.
Base inspeccionada: `f4369f3a4e4835f17cb8a387596494f427af53f0`.
Alcance aprobado en conversación: continuar el diseño y las pruebas necesarias para
conectar el ERP con QuickBooks, protegiendo los datos reales. La activación de escrituras
contables reales sigue pendiente de las revisiones y pruebas acordadas.

## 1. Resultado que verá la oficina

La operadora registra el trabajo realizado, confirma sus conceptos e importe y registra
el dinero recibido en el ERP. Una integración controlada prepara la factura y sus pagos
en QuickBooks. El ERP muestra por separado el estado del registro operativo y el estado
de su registro en QuickBooks, con fecha de última consulta.

El primer piloto será **servicios, una cita y una factura**, con clientes y artículos ya
relacionados. Los productos con inventario, anticipos, sobrepagos, facturación de varias
citas y proyectos por etapas requieren sus propios casos antes de incorporarlos al piloto.
Estas restricciones son del piloto propuesto, no limitaciones permanentes del negocio.

Ejemplo sintético de aceptación: tres servicios de 125 AWG generan una factura de 375 AWG;
un pago recibido de 250 AWG se aplica a esa factura y deja 125 AWG pendientes. El ejemplo
presupone que el tratamiento fiscal aprobado conserva ese total; no prescribe un impuesto.

## 2. Fuentes que se conservan

| Información | Fuente / regla |
| --- | --- |
| Cliente y propiedad | Identidades canónicas del CRM; la propiedad continúa vinculada al cliente. |
| Trabajo y precios confirmados | `appointments.jobCharges.final`, sus líneas y evidencia de revisión, mediante la autoridad existente. No usar la proyección, un borrador local o tarifas actuales para recalcular un acuerdo guardado. |
| Dinero recibido | Recibos existentes en `payments` con `source = appointment-operational`; identidad, importe, fecha, método y estado verificados por el backend. |
| Evidencia técnica | `fieldBillingCandidates` conciliados explícitamente por la oficina. No sumar otra vez los conceptos ya incorporados al cierre. |
| Factura oficial, número, pago contabilizado y saldo contable | QuickBooks; conservar sus identificadores y leer su respuesta para confirmar resultados. |
| Existencias físicas | Las autoridades de inventario existentes: `commercialProductStock`, `warehouseInventory` y movimientos/custodia gobernados. |
| Estado del envío | Metadatos privados de coordinación de la integración, no otro libro contable. Su esquema queda por implementar y revisar. |

Las pantallas que utilizan `browser-billing.ts`, `browser-receivables.ts` o datos de demo
no se convierten en productores de contabilidad real. Deben conectarse a las fuentes
canónicas y conservar sus límites actuales hasta un cambio específico y probado.

Reglas existentes: [Authority Matrix](../AUTHORITY_MATRIX.md),
[Business Rules](../BUSINESS_RULES.md), `OPS-SCHED-CHARGES-001/002` y
`FIN-QBO-PRODUCTION-READ-001`. Este diseño no modifica esas reglas ni concede permisos.

## 3. Relación entre los datos de ambos sistemas

Actualización 2026-10-19: el lector ya permite consultas de clientes, artículos y cuentas,
y la comparación completa está en `/quickbooks/compare/`. La etapa de confirmación explícita
se implementa en `quickbooksLinks`: guarda referencias privadas con versión e historial,
sin escrituras contables. Consulta su ADR y registro de publicación para el estado desplegado.
La selección de identidades reales y la configuración contable siguiente siguen pendientes
de revisión del propietario. No inventar IDs ni aprobar identidades por nombres.

| Relación necesaria | Verificación antes de permitir un envío |
| --- | --- |
| Cliente ERP → `CustomerRef` | Mismo cliente, compañía y moneda; confirmar coincidencias ambiguas. No fusionar automáticamente por nombre o teléfono. |
| Artículo ERP → `ItemRef` | Servicio/producto, capacidad cuando aplique, estado activo y unidad compatibles. Mantener el precio acordado de la línea ERP. |
| Tratamiento fiscal | Leer preferencias/códigos aplicables a la compañía de Aruba y comprobar inclusión, exclusión y redondeo contra ejemplos aprobados. No trasladar una configuración de impuestos de EE. UU. ni sumar un porcentaje por memoria. |
| Moneda | Piloto AWG; bloquear otra moneda hasta validar su flujo completo. |
| Efectivo | Relación explícita con método y cuenta de destino; no elegir una cuenta por defecto silenciosamente. |
| Transferencia | Relación explícita con la cuenta receptora y referencia del recibo. |
| POS / SUAVE | Distinguir cobro del cliente, liquidación y comisiones. El importe cobrado no se sustituye por el neto depositado. Relacionar las cuentas de tránsito/destino según el flujo aprobado. |
| Fechas y numeración | Fecha contable explícita en zona de Aruba; no derivarla ciegamente de la fecha UTC. QuickBooks conserva la numeración oficial. |
| Inicio de sincronización | Fecha de corte y conjunto de operaciones elegibles aprobados. Las anteriores requieren conciliación individual; no importar automáticamente la historia. |

Las relaciones deben tener versión, ambiente, compañía, estado y autor/fecha de aprobación.
Cambiar una relación invalida las preparaciones no enviadas que la utilizaban. Nunca
reinterpreta una operación ya contabilizada.

## 4. Flujo propuesto de una factura

1. Leer en servidor la cita, su cierre guardado, cliente/propiedad, revisión Field y los
   bloqueos de conciliación. Verificar rol actual, versión y vínculos históricos.
2. Preparar una vista previa con las líneas reales, total, impuestos, cliente, fecha,
   relaciones y ambiente. Si falta información, indicar el motivo concreto y no enviar.
3. En el piloto, el propietario revisa y confirma ese envío específico. La operación
   queda ligada a un cierre y configuración determinados. Abrir una cita nunca factura.
4. Reservar una identidad única del documento de negocio y una operación de envío con
   control transaccional. La versión identifica el contenido; cambiar la versión no
   autoriza crear una segunda factura para el mismo documento.
5. Ejecutar desde el backend, fuera de la transacción de Firestore y sin bloquear la
   agenda. Antes del POST, volver a comprobar permisos, ambiente, compañía y vigencia
   de la preparación. Persistir el inicio del intento antes de contactar al proveedor.
6. Guardar la relación con el `Invoice.Id` devuelto y verificar cliente, moneda, líneas,
   total y fecha. Si hay diferencias o una respuesta incierta, conservar el resultado
   conocido y pasar a revisión; no crear otra factura ni aplicar pagos todavía.
7. Mostrar el número y estado confirmados por QuickBooks. Deshabilitar los envíos
   automáticos si el piloto revela diferencias. No emitir correos, WhatsApp ni PDFs
   al cliente como efecto secundario de esta prueba; revisar también las automatizaciones
   de la compañía antes del piloto real.

Una factura creada con un total diferente no se elimina ni se modifica automáticamente
para forzar la coincidencia. Se bloquea el siguiente paso y se concilia la causa.

## 5. Flujo propuesto de un pago

Cada recibo mantiene su identidad propia y se relaciona como máximo con un registro de
pago de QuickBooks dentro del piloto. No enviar el total acumulado de recibos como si
fuera un pago nuevo en cada actualización.

Antes de enviar: verificar recibo vigente, cliente, moneda, factura confirmada, importe,
saldo recién leído y cuenta/método de destino. Crear `Payment` con aplicación explícita
a la factura; registrar un cobro ya recibido no ejecuta un cargo bancario ni de tarjeta.
La integración no utiliza procesamiento de pagos en esta fase.

Después de enviar: guardar el `Payment.Id`, leer su aplicación y actualizar la lectura
del saldo de QuickBooks. Mostrar “Registrado en ERP; pendiente de QuickBooks” hasta
verificación, y “Requiere revisión” si existe incertidumbre o discrepancia.

| Situación | Conducta del primer piloto |
| --- | --- |
| Dos abonos distintos a una factura | Dos pagos identificados, cada uno enviado una sola vez. |
| Pago antes de confirmar factura | Conservar el recibo operativo; excluir del envío automático hasta definir y probar anticipos. No cambiar su fecha ni inventar una factura. |
| Pago superior al saldo | Bloquear la aplicación automática y revisar sobrepago/crédito o pago ya registrado directamente en QuickBooks. |
| Pago ya registrado en QuickBooks | Relacionar el registro existente mediante revisión; nunca recrearlo por falta de relación local. |
| Recibo anulado antes del envío | Cancelar la preparación si se demuestra que no hubo envío; conservar el historial. |
| Recibo anulado después del envío o durante un intento incierto | Marcar conciliación pendiente. La anulación operativa no implica devolución ni anulación automática en QuickBooks. |
| Cierre corregido después de facturar | Congelar nuevos envíos del documento y preparar una corrección gobernada; no sobrescribir QuickBooks ni crear otra venta. |

## 6. Entrega, interrupciones y cambios simultáneos

Estados propuestos: `blocked`, `prepared`, `queued`, `sending`, `verifying`, `synced`,
`uncertain`, `needs_reconciliation` y `cancelled_before_send`. Son estados de transporte,
no estados nuevos de verdad contable. Un estado operativo “pagado” no demuestra `synced`.

- Identidad persistente por documento/recibo + operación/payload inmutables + exclusión
  transaccional. Un doble clic, dos sesiones o un worker repetido no crean identidades nuevas.
- Resolver la deduplicación soportada por el endpoint Intuit durante la implementación,
  verificar sus límites actuales y probarla en Sandbox. No asumir retención ilimitada
  de una clave de idempotencia ni tratar `DocNumber` como prueba suficiente de identidad.
- Un timeout después del POST es `uncertain`, no “no se creó”. Tras caída del worker o
  pérdida de respuesta, consultar y conciliar antes de cualquier nuevo intento. Solo
  reintentar cuando la estrategia validada permita hacerlo sin duplicar operaciones.
- Si la factura existe pero falló el pago, conservar la factura y reanudar únicamente
  la operación de pago pendiente. No prometer una transacción atómica entre Firestore y QBO.
- Si el usuario modifica el cierre mientras hay un envío, la revisión debe quedar
  explícita. La preparación y la reserva leen su versión dentro de una transacción;
  antes del POST se comprueba otra vez. Si el cierre cambia después de esa comprobación,
  no se puede deshacer un POST en vuelo: guardar su resultado contra la versión original,
  marcar conciliación y bloquear pagos/nuevos envíos. Nunca presentar ese resultado como
  la contabilización de la nueva versión. Cambios posteriores
  en QBO se detectan por lectura del objeto/versionado antes de cualquier modificación.
- Las respuestas QBO se contrastan con el intento guardado. Un total o cliente distinto
  bloquea la continuación; ningún código de recuperación “arregla” cifras sin revisión.
- Reutilizar la autoridad de credenciales y su exclusión actual. Reports, OAuth y futuros
  envíos no pueden refrescar en paralelo ni revivir credenciales antiguas. Un lease vencido
  no resuelve por sí solo un POST de resultado desconocido.
- Reintentos con espera acotada para fallos demostrablemente recuperables; sin bucles de
  polling rápido. Desconexión, cambio de compañía, revocación o rol inactivo detienen envíos.

La cola debe conservar el mínimo necesario para reconciliar intentos: referencias de
origen, versiones, ambiente/compañía, identidad de operación, huella del contenido,
estado, identificadores QBO y evidencia de intentos. El contrato definitivo del contenido
congelado, retención y acceso privado requiere revisión de seguridad antes de implementarse.
No volcar payloads, informes, clientes ni credenciales en logs públicos o GitHub.

## 7. Pruebas de aceptación que faltan ejecutar

Los siguientes casos están **diseñados, no ejecutados**. Las pruebas unitarias existentes
de lectura no acreditan escritura ni conciliación de ventas/pagos.

| ID | Caso | Resultado exigido |
| --- | --- | --- |
| S01 | Ejemplo sintético 375 / 250 / 125 | Una factura, un pago aplicado y saldo exacto; mismas líneas, fechas, moneda e impuestos. |
| S02 | Dos abonos de 100 y 150 | Dos pagos; saldo 125; repetir cada solicitud no altera cantidades. |
| S03 | Dos clics/sesiones/workers | Una sola factura y un solo pago por identidad de origen. |
| S04 | Respuesta perdida después de creación | Recuperar la operación sin una segunda factura/pago. |
| S05 | Caída antes del POST y después del POST | Distinguir no enviado de incierto; recuperación determinista. |
| S06 | Factura aceptada y pago rechazado | Conservar factura; pago pendiente, nunca factura repetida. |
| S07 | Cliente/artículo/cuenta no relacionado o inactivo | Bloquear antes de enviar y mostrar el dato que falta. |
| S08 | Revisión de cierre, impuesto o relación durante preparación | Invalidar la preparación obsoleta; no cambiar el precio histórico. |
| S09 | Cambio/pago directo en QuickBooks | Leer, detectar conflicto y conciliar; no sobrescribir ni duplicar. |
| S10 | Anticipo, sobrepago y factura de otra moneda | Excluir del piloto con motivo claro; conservar el recibo operativo. |
| S11 | Anulación/corrección antes y después de enviar | Historial conservado, sin reembolso ni borrado automático. |
| S12 | Fecha cerca de medianoche UTC; cierre retroactivo | Fecha Aruba correcta; respetar corte y períodos contables bloqueados. |
| S13 | Token vencido y consultas simultáneas | Una renovación coordinada, sin perder autorización ni repetir el POST. |
| S14 | Cambio de rol, compañía, configuración o desconexión | Denegar antes de enviar; ninguna filtración entre ambientes. |
| S15 | Trabajo Field y cierre de oficina con los mismos conceptos | Facturar cada concepto una vez, incluyendo apoyos no facturables. |
| S16 | Cita con vínculos financieros antiguos | Bloqueo de conciliación; cero importación masiva o segunda venta. |
| S17 | Fallo de QuickBooks mientras se usa Scheduling | Agenda, borrador y recibos permanecen utilizables; envío pendiente visible. |
| S18 | Respuesta con total/impuesto distinto | Retener ID recibido, bloquear pagos y abrir conciliación. |
| S19 | POS/SUAVE con comisión y liquidación neta | Cobro íntegro correcto, cuentas aprobadas; comisión no deducida silenciosamente del pago. |
| S20 | Artículo de inventario en el primer piloto | Bloquear hasta validar su flujo, evitando ajustes dobles de existencias/costo. |
| S21 | Cantidades fraccionarias, cero explícito y redondeo fiscal | Preservar cantidades y céntimos aprobados; distinguir cero de precio desconocido; bloquear diferencias. |

## 8. Secuencia concreta de trabajo

1. Cerrar diagnóstico de Balance Sheet y las comparaciones manuales pendientes de
   Balance Sheet, A/R Aging Summary y A/P Aging Summary. Verificar renovación real
   de la autorización; no confundir una prueba sintética con esa evidencia.
2. Implementar lectura acotada de la configuración y catálogos para preparar relaciones
   reales. Revisar la ampliación de acceso; el lector actual de informes permanece aislado.
3. Construir preparación/validación sin POST contable y presentar las relaciones pendientes.
   El propietario confirma decisiones de negocio concretas después de ver las opciones reales.
4. Implementar y ejecutar S01-S21 en entorno aislado, con entidades sintéticas y una
   compañía Sandbox explícita; verificar que el tráfico no puede alcanzar producción.
5. Revisar con evidencia el conjunto, restauración/pausa y conflictos con el ERP vigente.
6. Tras aceptación y autorización concreta, piloto real de pocas operaciones nuevas
   elegidas y revisadas. Luego decidir activación automática; no sincronizar el histórico.

Los gastos, compras, productos con inventario, transferencias entre depósito/vans y
consultas ChatGPT/MCP son etapas posteriores. Una transferencia física entre vans no se
trata automáticamente como venta ni gasto. La valoración contable sigue perteneciendo a
QuickBooks; el diseño futuro conciliará el evento físico con su efecto contable sin duplicarlo.
MCP no es requisito para la sincronización ERP→QBO; el acceso de ChatGPT será una
superficie autorizada aparte y no queda habilitado por este documento.

## 9. Balance Sheet: diagnóstico abierto

Observación de la comprobación anterior (2026-10-13): corte 2026-09-30, Accrual;
`invalid-report-response`, sin cifras renderizadas. P&L Cash/Accrual y ambos aging
sí respondieron. Esto identifica la validación de respuesta como el lugar del rechazo,
pero no identifica aún cuál condición falla.

La versión desplegada de `quickbooksReportsFormat.js` colapsa en el mismo código discrepancias de nombre, moneda,
fecha, base, columnas, celdas, profundidad, opciones y filas. No existe un subcódigo que
permita distinguirlas en `quickbooksReportsHttp.js` o en el audit del servicio. No se
capturó el payload real. La inspección de navegador adicional de esta sesión quedó
restringida por la protección de credenciales del entorno; no es evidencia de un fallo de Intuit.

Siguiente corrección de diagnóstico propuesta: causas enumeradas y cerradas, sin datos
del proveedor (p. ej. `header_end_period`, `column_count`, `cell_shape`), solo detrás
de autorización y con tests de no filtración. Identificar la causa en una lectura explícita,
reproducir su estructura mínima con datos sintéticos, corregir únicamente el caso probado
y repetir los cuatro informes. No relajar la validación de fechas, rellenar importes con
cero, omitir filas ni almacenar el informe real como fixture.

El instalador actual de reports es de primera instalación y rechaza una función existente.
Cualquier diagnóstico/corrección de backend exige una ruta de actualización revisada,
pin de revisión/origen y verificación posterior; no quitar esa protección para desplegar.

## Referencias

Avance de implementación (mismo día): se añadió una vista previa de solo lectura a
Importes y pagos. Usa una consulta autenticada nueva, exige la misma versión y sesión,
muestra líneas confirmadas y recibos vigentes, y mantiene pendientes todas las relaciones
con QuickBooks. No produce un payload enviable ni guarda estado de integración. También
se implementaron subcódigos de diagnóstico cerrados; el backend desplegado sigue sin
ellos hasta contar con una ruta de actualización revisada. Véase la
[revisión de esta etapa](../reviews/quickbooks-preparation-20261013.md).

- [Servicio operativo de importes y recibos](../../../functions/appointmentCharges.js).
- [Lector de informes actual](../../../functions/quickbooksReportsService.js).
- [Validador actual](../../../functions/quickbooksReportsFormat.js).
- [Evidencia de lectura](../QUICKBOOKS_PRODUCTION_REPORTS_20261013.md).
- [Intuit: Invoice](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice).
- [Intuit: Payment](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/Payment).
- [Intuit: BillPayment](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/billpayment).

Referencias Intuit consultadas el 2026-10-13. Invoice documenta CustomerRef, líneas y
numeración del proveedor; Payment documenta aplicaciones a Invoice, pagos no aplicados,
cuenta de destino y operaciones/versionado. Las decisiones del piloto y sus bloqueos
son propuestas DEMAC, no afirmaciones de que todas ellas sean restricciones de la API.
