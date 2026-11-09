# Compras de DEMAC

## Primera entrega

Desde Purchasing se prepara una factura con varias líneas. El borrador se puede descargar y volver a abrir de forma explícita. Contiene los datos comerciales introducidos por el usuario. Al reabrir el archivo se solicitan nuevamente las confirmaciones de precio. La sesión autenticada del ERP protege la entrada normal de Compras. El borrador en archivo pertenece al operador y su contenido se valida al abrirlo.

El cálculo compartido se encuentra en `functions/supplierBillCosting.js`, reexportado por `lib/supplier-bill-draft.ts`. El editor recibe campos de texto y muestra el resultado por unidad y el total de la factura. La estimación y la distribución se calculan en centavos enteros. Se redondea cada cargo por unidad antes de multiplicar la cantidad. Las diferencias de centavos frente a una liquidación por embarque deberán conciliarse al registrar el costo real.

| Decisión | Regla aplicada |
| --- | --- |
| Compra internacional | Convertir USD a Afl a 1.80. El wire estimado parte del 2% del costo convertido. |
| Importación | El porcentaje general se ingresa manualmente. La base incluye el wire. Cada línea hereda el porcentaje del encabezado hasta que se personaliza. Cero es un valor válido. Se puede volver a usar el general. |
| Compra local | Ingresar directamente el costo en Afl. |
| Precio | Porcentajes comerciales individuales y reserva del 7%. El sugerido divide el costo por la fracción disponible para reposición. El operador introduce y confirma su precio final. Operaciones recibe el remanente de ese precio y la pantalla advierte si resulta negativo. |
| Uso interno | Insumos de uso interno y herramientas tienen costo de compra. Solo las líneas vendibles habilitan precio y distribución. |

## Guardado compartido preparado — 9 de noviembre de 2026

`Facturas guardadas` abre una lista y permite crear, guardar, reabrir y corregir borradores con historial. El servidor vuelve a calcular los costos, comprueba el rol vigente y exige motivo para cada corrección. Dos ediciones simultáneas no se sobrescriben. Si se pierde la respuesta del guardado, `Comprobar guardado` repite la misma solicitud incluso después de recargar, sin crear otra factura.

La función está desactivada por defecto y no ha sido desplegada ni habilitada por esta entrega. Los proveedores y artículos son textos del borrador, pendientes de vincular a identidades canónicas. La prevención de duplicados compara proveedor escrito y número normalizados; no detecta nombres alternativos del mismo proveedor. Guardar no recibe mercancía ni publica precios ni envía a QuickBooks. Los permisos de aprobación financiera para Christian, administrador y Yerika siguen pendientes de implementación.

Prueba visual reproducible: instalar `esbuild@0.25.9` en un directorio de herramientas aislado, definir `SUPPLIER_TEST_TOOLS` y `SUPPLIER_PREVIEW_OUTPUT`, y ejecutar `node apps/erp-next/scripts/supplier-bill-preview.cjs` desde la raíz. El resultado usa el editor, transporte y servicio reales con sesión ficticia y almacén transaccional en memoria. Sus botones simulan fallo después del commit, edición simultánea y lectura financiera; nunca usan Firebase real. Los datos duran hasta reiniciar ese servidor de prueba. En Work Mode se inicia únicamente mediante el servicio de preview administrado.

## Siguientes entregas y límites de autoridad

1. **Registro compartido.** Vincular proveedor, factura, originador y líneas a identidades verificadas del catálogo. Conservar tanto el porcentaje general como la excepción aplicada y la versión confirmada de cada costo y precio. La publicación de precio al catálogo corresponde a su autoridad actual. El editor de esta primera entrega opera exclusivamente sobre borradores.
2. **Promoción del borrador.** El comando de borradores ya valida permisos, estructura, versión e identidad de solicitud y conserva revisiones. La futura promoción comprobará además el proveedor y los artículos canónicos, los datos obligatorios para recibir y los permisos de aprobación. Las revisiones de borrador no equivalen a una factura contable confirmada.
3. **Recepción y cierre.** La recepción parcial validará cantidades abiertas y actualizará existencias en la autoridad de inventario. El cierre del embarque asignará el costo documentado a sus líneas y conservará la estimación anterior. La diferencia se distribuirá entre unidades entregadas y existencias. Los comprobantes logísticos y el pago tendrán referencias independientes.
4. **Contabilidad.** QuickBooks conservará el libro oficial. Antes de habilitar envíos se verificarán cuentas, modalidad de recepción y enlaces de proveedor y artículo en un entorno de prueba. Hace falta conciliar los efectos de factura, recepción y cierre de importación para que el mismo costo o cantidad se reconozca una sola vez.

La fecha de corte, el conteo por ubicación y las cuentas contables reales son requisitos para la apertura y conciliación. Las pruebas de cálculo usan datos de ejemplo.

[Autoridades del ERP](../../../docs/ai/AUTHORITY_MATRIX.md) · [Reglas del negocio](../../../docs/ai/BUSINESS_RULES.md)
