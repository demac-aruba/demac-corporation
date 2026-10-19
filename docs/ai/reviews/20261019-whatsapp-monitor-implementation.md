# Implementación del monitor de mensajería

Solicitud: implementar el diseño y conservar la captura aprobada el 19 de octubre.
Modo: Deep Review, con pase adversarial separado realizado por el mismo mantenedor.
Referencia visual: `docs/ai/previews/whatsapp-monitoring/index.html`.

## Alcance y autoridades

Monitor de servidor, proyecciones privadas, alertas agrupadas y panel ERP Next. La cola
de WhatsApp conserva la autoridad de envío; Booking mantiene citas y Work Orders.
La observación no reenvía, reclama, borra ni modifica mensajes. El descarte autorizado
de hoy es terminal. Se respetan OPS-SCHED-REFERENCES-001 e históricos silenciosos.

Las únicas modificaciones del envío previstas son metadatos de correlación y una señal
sanitizada de poll exitoso/fallido; no se cambia la selección ni la entrega. La planificación
de agendas se comparte como función pura con el monitor para evitar reglas duplicadas.
Las proyecciones nuevas se mantienen bajo subcolecciones privadas de la configuración
de WhatsApp, accesibles por una API con verificación de sesión y rol en servidor.

## Criterios de aceptación

- [x] La vista implementada conserva la distribución, colores y jerarquía aprobados.
- [x] Detecta interrupción, cola detenida, fallo terminal, paquete parcial y mensaje ausente.
- [x] Los eventos duplicados/desordenados no producen falso verde ni incidencias duplicadas.
- [x] La falta de datos, de permisos, de cobertura o del propio monitor queda visible.
- [x] La operadora puede atender una incidencia sin declararla resuelta ni reenviar mensajes.
- [x] Los avisos externos se preparan fuera de WhatsApp con destinos explícitamente configurados.
- [x] Ninguna prueba envía mensajes reales ni modifica producción.
- [x] Gates de autorización, concurrencia, recuperación, interfaz y funciones existentes pasan.

## Publicación y recuperación

La implementación se prepara en una rama de función. Activación, destinatarios externos
y despliegue requieren configuración concreta y la autorización aplicable; la autorización
anterior correspondía a la corrección del incidente. No se abre un flujo de permisos antes
de tener código y resultados revisables. Desactivar solo el monitor constituye recuperación;
nunca restaurar o reenviar la cola descartada.

## Verificación y revisión

Resultados y riesgos: `20261019-whatsapp-monitor-adversarial.md`. Activación: `../../WHATSAPP_MONITOR_ACTIVATION.md`. CI y paquete aislado preparados; ningún despliegue ni canal externo activado.
