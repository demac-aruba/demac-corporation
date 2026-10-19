# Monitor de mensajería: publicación y activación

Estado: publicación autorizada por el propietario el 2026-10-19 (merge y deploy).
La evidencia del despliegue se registra por separado; los canales externos siguen pendientes de destinatario.
La captura aprobada se conserva en `docs/ai/previews/whatsapp-monitoring/`.
El monitor no envía WhatsApps, no reclama la cola y no tiene una acción de reintento.

## Componentes que deben publicarse juntos

- ERP Next: `/settings/system/messaging`, indicador global, campana y aviso en Scheduling.
- `whatsappMessagingMonitor`: API con sesión revocada comprobada y perfil activo actualizado.
- `whatsappMessagingMonitorTick`: comprobación cada minuto, horario Aruba.
- `whatsappMessagingObserveOrder`: observador independiente de las escrituras en Work Orders.
- `queueAppointmentConfirmation`: metadatos `monitoringSourceVersionMs` y destinatario en los
  nuevos mensajes. Incluye el servicio compartido de cambios de agenda.
- `wacliOutboundPoll`: señal sanitaria estructurada, sin contenido ni destinatarios.
- `scheduleDailyVanGroups`: únicamente la extracción equivalente del plan compartido si se
  publica el paquete operacional completo. No necesita cambiarse para activar el monitor.

El paquete aislado se genera con `node functions/whatsappMonitorPackage.cjs <directorio-vacío-externo>`.
Solo exporta las tres funciones nuevas. Los servicios de dominio incluidos se utilizan para
leer las mismas reglas del productor; no se invoca ningún método de envío desde el monitor.
El artefacto de CI conserva el código y la resolución de dependencias. El workflow `whatsapp-monitor.yml` valida; `whatsapp-monitor-release.yml` publica únicamente
desde `release/whatsapp-monitor-20261019`, con HEAD igual a main. Revisar otros workflows antes de fusionar;
usar `[merge-only]` donde los workflows existentes lo requieran para separar publicación.

## Preparación revisable, antes de activar

1. Autorización de publicación recibida. Confirmar destinatario antes de configurar canales
   externos; esa parte permanece `externalAlertsVerified:false` y visible como pendiente.
2. Crear una identidad de ejecución dedicada: lectura de las fuentes necesarias, escritura de
   proyecciones del monitor, lectura de logs y escritura de métricas. Firestore IAM no separa
   escrituras por colección; documentar este límite y mantener el código sin mutaciones de cola.
   Necesita también validar tokens revocados mediante Firebase Auth. No reutilizar secretos del bridge.
3. Crear el índice adicional descrito en `firestore.messaging-monitor.indexes.json`, de manera
   aditiva. No reemplazar ni eliminar los índices existentes. Esperar a que esté listo.
4. Habilitar TTL de `expiresAt` para los grupos `monitorExpectations`, `monitorDays`,
   `monitorIncidents`, `monitorAudit` (45 días) y `monitorSnapshots` (2 días). Excluir de índices
   los arrays `items`, `queue`, `incidents`, `unverifiedIncidents`, `entries`, `targets` donde
   corresponda. No se necesitan reglas nuevas: estas subcolecciones privadas ya se deniegan.
5. Preparar el paquete aislado y la identidad dedicada, y actualizar solo los dos productores
   listados conservando sus identidades. Publicar las nuevas funciones con el flag de runtime
   habilitado y el control privado aún ausente: ambos controles son necesarios para ejecutarse.
   Comprobar eventos, Scheduler, API autenticada, IAM y logs sin realizar envíos de prueba.
6. Configurar canales verificados de Cloud Monitoring. Generar cuatro documentos revisables:
   `node functions/whatsappMonitorAlertPlan.cjs demac-corporation projects/demac-corporation/notificationChannels/ID`.
   La utilidad solo produce JSON: no aplica políticas ni crea suscripciones. Registrar las IDs
   creadas y destinatarios en evidencia de publicación; nunca sobrescribir políticas ajenas.

## Corte de activación

Tras comprobar las configuraciones, establecer `startedAtMs` al instante de activación y
`enabled:true` en `businessSettings/whatsapp/monitorControl/active`. Habilitar el flag de las
tres funciones nuevas y construir el ERP con `NEXT_PUBLIC_WHATSAPP_MONITOR_ENABLED=true`.
No copiar expectativas antiguas. La selección de pendientes queda acotada por este corte;
los tombstones del descarte `owner-requested-20261019-cutover` permanecen terminales.
Activar antes de las 07:45 para obtener la primera revisión completa de la jornada siguiente.
Una activación posterior a las 08:00 no exige retrospectivamente las agendas de ese día.

Verificar un primer snapshot vigente, métricas y recepción del aviso de prueba en el canal
externo autorizado. La alerta por ausencia necesita una muestra recibida después de crear la
política: no declarar vigilancia independiente operativa antes de esa comprobación. Registrar
evidencia de fallo/recuperación con una señal sintética exclusiva de monitor, nunca mensajes a
clientes o técnicos. Solo entonces establecer `externalAlertsVerified:true` en el control.
El panel no afirma que un correo fue recibido ni que un WhatsApp fue leído.

## Recuperación y límites

Desactivar el control y el flag detiene únicamente la supervisión; no deshabilita el sender.
Resolver las políticas de ausencia asociadas a una parada planificada para evitar ruido.
No restaurar mensajes borrados, no reabrir cancelados, no enviar un lote histórico.

La lectura está acotada a 400 documentos por consulta y un presupuesto aproximado de 2.000
documentos por ejecución (las consultas iniciales concurrentes pueden excederlo por su
última respuesta). La saturación se muestra como cobertura incompleta y exige revisar volumen,
índices o partición, no subir límites silenciosamente. Se muestran 60 incidencias, 100 registros
por incidencia y 50 entradas de historial; el exceso queda indicado. La revisión puede detectar
fallos en torno al minuto siguiente; no puede garantizar anticipar todo fallo instantáneo.
La señal de poll acredita consulta autenticada de la cola, no sesión de WhatsApp ni entrega.
Un lote diario completo acredita generación, no entrega: el avance se comprueba por registros.
La primera captura diaria posterior a las 08:02 se marca incompleta; no reconstruye con certeza
lo que debía salir antes de una interrupción. Los fallos del observador tienen una política
de logs independiente; su trigger e identidad deben verificarse en cada publicación.
