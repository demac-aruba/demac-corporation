# Compras de DEMAC

## Primera entrega

Desde Purchasing se prepara una factura con varias líneas. El borrador se puede descargar y volver a abrir de forma explícita. Contiene los datos comerciales introducidos por el usuario. Al reabrir el archivo se solicitan nuevamente las confirmaciones de precio. La sesión autenticada del ERP protege la entrada normal de Compras. El borrador en archivo pertenece al operador y su contenido se valida al abrirlo.

El cálculo se encuentra en `lib/supplier-bill-draft.ts`. El editor recibe campos de texto y muestra el resultado por unidad y el total de la factura. La estimación y la distribución se calculan en centavos enteros. Se redondea cada cargo por unidad antes de multiplicar la cantidad. Las diferencias de centavos frente a una liquidación por embarque deberán conciliarse al registrar el costo real.

| Decisión | Regla aplicada |
| --- | --- |
| Compra internacional | Convertir USD a Afl a 1.80. El wire estimado parte del 2% del costo convertido. |
| Importación | El porcentaje general se ingresa manualmente. La base incluye el wire. Cada línea hereda el porcentaje del encabezado hasta que se personaliza. Cero es un valor válido. Se puede volver a usar el general. |
| Compra local | Ingresar directamente el costo en Afl. |
| Precio | Porcentajes comerciales individuales y reserva del 7%. El sugerido divide el costo por la fracción disponible para reposición. El operador introduce y confirma su precio final. Operaciones recibe el remanente de ese precio y la pantalla advierte si resulta negativo. |
| Uso interno | Insumos de uso interno y herramientas tienen costo de compra. Solo las líneas vendibles habilitan precio y distribución. |

## Siguiente entrega y límites de autoridad

1. **Registro compartido.** Vincular proveedor, factura, originador y líneas a identidades verificadas del catálogo. Conservar tanto el porcentaje general como la excepción aplicada y la versión confirmada de cada costo y precio. La publicación de precio al catálogo corresponde a su autoridad actual. El editor de esta primera entrega opera exclusivamente sobre borradores.
2. **Comando de registro.** La implementación en Functions comprobará permisos, tipos, moneda y cantidades. Recalculará costos en servidor. Una referencia estable por proveedor y factura impedirá duplicados. Una versión esperada, un identificador de operación y el contenido verificado permitirán distinguir un reintento de una corrección. Corregir un registro confirmado generará una revisión y motivo.
3. **Recepción y cierre.** La recepción parcial validará cantidades abiertas y actualizará existencias en la autoridad de inventario. El cierre del embarque asignará el costo documentado a sus líneas y conservará la estimación anterior. La diferencia se distribuirá entre unidades entregadas y existencias. Los comprobantes logísticos y el pago tendrán referencias independientes.
4. **Contabilidad.** QuickBooks conservará el libro oficial. Antes de habilitar envíos se verificarán cuentas, modalidad de recepción y enlaces de proveedor y artículo en un entorno de prueba. Hace falta conciliar los efectos de factura, recepción y cierre de importación para que el mismo costo o cantidad se reconozca una sola vez.

La fecha de corte, el conteo por ubicación y las cuentas contables reales son requisitos para la apertura y conciliación. Las pruebas de cálculo usan datos de ejemplo.

[Autoridades del ERP](../../../docs/ai/AUTHORITY_MATRIX.md) · [Reglas del negocio](../../../docs/ai/BUSINESS_RULES.md)
