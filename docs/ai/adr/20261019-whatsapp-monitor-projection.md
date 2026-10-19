# ADR: supervisión independiente de mensajería

- Estado: Propuesto; implementación preparada, activación pendiente.
- Fecha: 2026-10-19.
- Alcance: comunicaciones, OPS-SCHED-REFERENCES-001, panel aprobado por el propietario.

La cola existente sigue siendo la autoridad de envío. Un observador independiente registra
metadatos de notificaciones esperadas por versión del Work Order; una tarea por minuto
contrasta esos metadatos, el plan canónico diario, la cola y señales sanitizadas del poll.
Las proyecciones privadas bajo `businessSettings/whatsapp` son reconstruibles y no autorizan
envíos. El control de activación establece el corte prospectivo. Ninguna acción del panel
puede reclamar, reintentar o cancelar mensajes.

Una API verifica token, revocación y rol activo de administración/operaciones/oficina.
La atención de una incidencia es idempotente por ocurrencia y tiene auditoría; solo una
observación completa posterior puede resolverla. La ausencia de evidencia mantiene el
estado desconocido y conserva incidencias previas. El cliente comparte una sola consulta
y considera obsoletos los datos de más de tres minutos.

Se eligieron métricas y políticas externas de Cloud Monitoring porque pueden avisar sin
depender de WhatsApp ni de que el panel esté abierto. Agregar alertas al mismo sender no
cubriría su caída; un segundo sender introduciría duplicados y otra autoridad de entrega.
Los canales se activan después de comprobar un destinatario y una muestra de heartbeat.

Costes: lecturas acotadas por minuto, dependencia de logs/métricas y una proyección diaria
que debe capturarse a tiempo. El poll no demuestra recepción del destinatario. Los límites
de volumen se declaran como cobertura incompleta. Firestore IAM no permite restringir la
identidad servidor por colección: el límite se mantiene en código, pruebas y revisión.

Verificación: pruebas puras, Auth/Firestore reales emulados, navegador sobre el ERP compilado
y regresiones del sender. Desactivar el monitor no afecta los envíos. Publicación y
recuperación: `docs/WHATSAPP_MONITOR_ACTIVATION.md`. Revisión obligatoria ante cambio de
proveedor, horario diario, esquema de cola, roles o aumento sostenido de volumen.
