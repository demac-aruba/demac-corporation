# Reanudación probada y permisos del observador

Deep Review / Solo Maintainer Adversarial Review. Revisión separada, no independiente.
Autorización vigente: merge/deploy del monitor, sin reprocesar mensajes antiguos.

## Evidencia y cambios

El artefacto 12222689243 del release 39328826817 acredita ambas fuentes publicadas y verificadas.
Al reanudar con otro SHA, 39330900365 se detuvo porque el transporte nuevo tiene fecha posterior
a la operación original: no satisfacía su prueba de procedencia. Se conserva la prueba original
en JSON sin datos de clientes, secretos ni contenido de mensajes. Solo puede reutilizarse si
coinciden revisión, hash completo del contenido, configuración, IAM y Scheduler. Después el
mismo verificador de operaciones exitosas vuelve a probar la fuente real. No se omite ni
relaja esa comprobación y no se realiza otro PATCH para fuentes ya publicadas.

La inspección de Firebase CLI 15.30.0 demuestra que usa la cuenta runtime también para el
trigger Eventarc. Google requiere eventarc.eventReceiver para recibir eventos de Firestore
y run.invoker sobre el servicio destino (https://docs.cloud.google.com/eventarc/docs/roles-permissions).
Los cuatro roles iniciales están efectivos, pero falta el primero en la cuenta creada por
el propietario. Se incorpora al preflight y al script administrativo opcional. CI no puede
ni intenta escribir IAM de proyecto. Tras desplegar, añade y verifica invocación privada
solo de la cuenta dedicada sobre whatsappmessagingobserveorder; nunca sobre todo el proyecto.

El mismo CLI exige confirmar la política de reintentos nueva en modo no interactivo. Se
acepta esa política ya revisada mediante --force con selectores exactos de las tres funciones,
inventario completo que rechaza funciones ajenas/otras regiones/reservas y guardia de retención.
La auditoría 39331297394 confirma que ya existe firebase-functions-cleanup. Antes de ejecutar
se exige una política/opt-out preexistente, y después se compara que permanezca igual. No
se autoriza borrado de funciones ni creación de políticas de limpieza por este cambio.

## Revisión adversarial

Se revisaron el diff completo, manifiesto aislado, invocadores y prueba de publicación del
helper compartido. El helper de operaciones exitosas permanece intacto. Los tests reprodujeron
reanudación entre commits y ausencia de prueba; rechazan cambios de revisión/contenido/IAM,
funciones/regiones ajenas, reservas, retención ausente, invocadores públicos y permisos
condicionales. La comprobación estática de IAM se precisa a escrituras de proyecto porque
ahora existe una mutación de servicio explícita, construida con parámetros cerrados y
probada por separado. Esto no permite ampliar privilegios del deployer ni usar una identidad
predeterminada. El trigger debe utilizar la misma cuenta dedicada antes de activar.

No cambia código de negocio, cola, corte prospectivo ni control de activación. El panel
continúa apagado; no hay destinatario externo verificado. El nuevo permiso Eventarc requiere
al administrador porque la identidad CI carece de resourcemanager.projects.setIamPolicy.

Validación: sintaxis Node/Bash y diff sin errores; 26 pruebas de release, transporte y
recuperación aprobadas. CI requerido antes de merge. No declarar el monitor activo sin
snapshot y heartbeat verificados.
