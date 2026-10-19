# Identidad del monitor creada por el propietario

Deep Review / Solo Maintainer Adversarial Review. Revisión separada, no independiente.
Continúa la autorización de merge y deploy del monitor; no cambia autoridades ni reglas de negocio.

## Alcance y evidencia

El propietario confirmó mediante captura IAM del 2026-10-19 17:23 UTC-4 la cuenta
`demac-messaging-health-monitor@demac-corporation.iam.gserviceaccount.com`, con Cloud Datastore
User, Firebase Authentication Viewer, Logs Viewer y Monitoring Metric Writer. El nombre
creado difiere del propuesto inicialmente. Se ajustan únicamente la cuenta esperada en el
release y el script administrativo opcional. Antes de modificar producción se comprueba
también mediante lectura que Cloud Monitoring API esté habilitada.

Base: main adfa534, incluyendo el editor de mensajes y el formulario de pago de un paso.
No se reescriben las fuentes de esos cambios: el release operacional conserva el parche
original de metadatos/observación sobre la fuente real desplegada y rechaza incompatibilidades.

## Revisión adversarial

Se revisaron el diff completo, las verificaciones de identidad y sus consumidores: generación
del entorno de las tres funciones, comprobación posterior, script administrativo y documentación.
La identidad sigue siendo exacta y dedicada; no hay fallback a una identidad amplia, creación
de claves ni escrituras IAM desde CI. La lectura de Service Usage no habilita servicios.
Los roles faltantes, condicionados o amplios siguen rechazados. El fallo de la API ocurre
antes del índice, TTL, fuentes operacionales, despliegue o activación.

El corte prospectivo y su protección ante reintentos permanecen iguales. No se modifica
ningún mensaje, cola ni tombstone del descarte previo. Las alertas externas continúan
pendientes de destinatario verificado; el monitor no garantiza anticipar todas las averías.

## Validación

Sintaxis Node/Bash y diff sin errores; las 21 pruebas de release, transporte privado e
idempotencia completaron correctamente. CI debe aprobar el commit antes de merge.
La captura acredita la selección de roles; CI comprobará la política efectiva, estado de
la cuenta y API. Este registro no acredita todavía despliegue ni activación.
