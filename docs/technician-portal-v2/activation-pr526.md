# PR 526 — activación y recuperación

Estado al preparar el candidato del 8 de octubre: implementación en rama;
**merge y despliegue autorizados expresamente por el propietario**, todavía no
ejecutados. La prueba física se hará después en live por indicación del propietario.
La activación de artículos concretos del catálogo sigue separada y pendiente.
La evidencia vigente está en `docs/ai/tasks/technician-completion-20261007.md`.
Los documentos de septiembre describen sus puntos de control históricos; este
archivo actualiza el plan operativo, incluido el grabador de audio integrado.

## Antes de activar

1. Confirmar el commit candidato y sus verificaciones obligatorias. Comparar
   nuevamente con `main` si cambió después de la integración de `c45d51d0`.
2. Al publicar, completar la prueba física de abajo y registrar modelo del teléfono, sistema,
   navegador, cuenta de prueba, fecha y resultado. Chromium/WebKit automatizados
   no prueban la cámara, micrófono ni administración de memoria de un teléfono.
3. Autorización expresa recibida el 8 de octubre, 18:08 -04: hacer merge y deploy
   en live para comenzar pruebas reales, conservando el diseño existente del ERP.
   La pantalla compartida de login se restaura exactamente a `main`; los estilos
   globales y la navegación administrativa permanecen como en el ERP actual.
4. Desplegar primero el frontend compatible con las capacidades proyectadas;
   después el backend Field compatible y sus lectores de revisiones congeladas.
   Verificar la compatibilidad antes de conceder la capacidad de venta al ayudante.
5. Solo con autorización separada, habilitar los artículos de Standard Service
   elegidos mediante `fieldExecutionDefinition` versión 1 y protocolo
   `demac-standard-service-v1`. El nombre de un servicio no activa el protocolo.
   Los demás servicios conservan su flujo existente.
6. Revisar un caso acotado con técnico, ayudante y oficina: una visita, un equipo,
   un servicio, dos partes, constancia verbal del cliente y revisión de oficina.
   Capturar y aprobar el reporte no debe crear factura, mover inventario ni enviar
   comunicaciones automáticamente.

## Prueba física pendiente

- [ ] Abrir el mismo servicio en dos cuentas asignadas; tomar partes diferentes.
- [ ] Capturar fotos antes/durante/después; abrir miniatura y ampliación; comprobar
      orientación, legibilidad, cierre y retorno a la pantalla correcta.
- [ ] Grabar audio con el micrófono: conceder/rechazar permiso, detener, escuchar,
      cambiar de aplicación y recuperar el original sin atribuirlo a otra cuenta.
- [ ] Adjuntar video real del teléfono y reproducirlo después del vínculo privado.
- [ ] Escribir notas, activar modo avión, recargar y recuperar el texto guardado;
      reconectar y confirmar explícitamente los archivos pendientes.
- [ ] Probar almacenamiento insuficiente: conservar la pantalla/original, ver el
      aviso y reintentar; nunca aceptar un mensaje de guardado que no ocurrió.
- [ ] Completar ambas partes; coordinar físicamente el equipo y registrar la prueba
      final. Un resultado "No enfría" debe conservarse como tal.
- [ ] Proponer adicional del catálogo, registrar decisión verbal y ejecución real.
- [ ] Registrar quién recibió/revisó el reporte. La constancia implementada es
      verbal, con autor y fecha; no es una firma dibujada ni certificada.
- [ ] Enviar a oficina, devolver con motivo, corregir, reenviar y aprobar; comprobar
      que la revisión previa permanece inmutable.

## Recuperación operativa

- El borrador local no es un registro confirmado por el servidor. Ante desconexión
  o error, conservar el dispositivo y la cuenta original; reintentar la misma
  solicitud cuando se restablezca el acceso.
- Un conflicto entre pestañas exige comparar ambos textos. No copiar una nota
  antigua sobre una versión nueva sin la decisión explícita mostrada por la app.
- Las confirmaciones físicas de competencia, aislamiento y seguridad no se
  restauran como permisos de trabajo al recuperar un borrador.
- Si cambió la coordinación durante una subida, usar la recuperación documental
  con motivo. Eso no elimina riesgos ni autoriza reenergizar el equipo.
- Si falta una reserva del compañero, el responsable/oficina debe usar el flujo
  auditado correspondiente. No inventar una foto ni borrar el historial.
- Los selectores antiguos de fotos del registro de equipo/reporte conservan texto
  y bloquean la salida mientras hay archivos seleccionados. No se afirma que esos
  selectores antiguos recuperen sus archivos tras forzar el cierre del navegador;
  la recuperación binaria completa corresponde a la captura por procedimiento.

## Reversión

Antes de crear registros del protocolo se puede revertir el código del candidato
con una revisión y autorización de despliegue. Después de usar el protocolo,
detener nuevas activaciones de catálogo y mantener lectores de protocolos,
originales privados, revisiones congeladas y restricciones de cierre. No borrar
capturas, borradores, reservas, documentos de intervención ni revisiones para
revertir una pantalla. Resolver servicios en curso con el backend compatible.

No hay migración destructiva, cambio de reglas Firebase, IAM o secretos en este
plan. Cualquier acción adicional de producción requiere su autorización concreta.

## Publicación acotada del 8 de octubre

Destino verificado: `https://demac-aruba.com` y `https://www.demac-aruba.com`,
proyecto Vercel `demac-corporation-web` (`prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7`).
El proyecto secundario `demac-corporation.vercel.app` no es el ERP live.

Después de todos los controles del candidato, integrar PR #526 con `[merge-only]`
para mantener las protecciones existentes y evitar el despliegue automático amplio.
Crear `release/technician-pr526-20261008` desde el merge y añadir un único commit
de autorización documental cuyo padre sea el `main` vigente. Publicar ese SHA en
Vercel producción con la configuración existente. El workflow dedicado exige que
ambos dominios sirvan exactamente ese SHA y el login original antes de obtener
credenciales o actualizar únicamente el código de `fieldOperationsAuthority`.

El publicador conserva el lock de dependencias de la función en ejecución, compara
toda su configuración y verifica los bytes de fuente publicados. Comprueba además
que seis funciones vecinas y el programador diario no cambien. Rechaza otra rama,
otro repositorio, código diferente de `main`, dependencias incompatibles, movimiento
concurrente de fuente/configuración y accesos anónimos aceptados. El resumen registra
la revisión/fuente anterior para recuperación sin exponer configuración o secretos.
No escribe datos de clientes, servicios ni catálogo. La versión frontend anterior
es `dpl_7E94hXZQwhJQn5WRFdmM59dvxWKS`; después de crear datos de protocolo, conservar
lectores/backend compatibles según la sección de reversión.
