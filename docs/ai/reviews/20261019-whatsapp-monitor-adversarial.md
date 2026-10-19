# Revisión del monitor de mensajería

Modo: **Solo Maintainer Adversarial Review**. Autor y revisor: Codex, en pases separados.
No constituye revisión independiente. Base: main `2024b537f93aa6824f5b5e788ef24b46a2baaded`.

## Alcance comprobado

Se revisaron el diff operacional completo, sus productores y consumidores, el observador,
evaluador, API, adaptador de Google, paquete aislado, políticas externas, provider React,
panel, navegación, workflow y pruebas. Booking/Work Orders y la cola conservan autoridad.
El monitor escribe exclusivamente control/proyecciones/auditoría privadas; no dispone de
acción para enviar ni reintentar. Los permisos se verifican otra vez dentro de la transacción
de atención. No se modifican reglas, secretos, datos ni configuración de producción.

## Hallazgos y correcciones del pase adversarial

| Riesgo | Corrección y evidencia |
| --- | --- |
| Leer todo el historial de fallos hasta saturar el monitor | Consulta de pendientes limitada por el corte y nuevo índice aditivo. Saturación mantiene cobertura desconocida. |
| Ocultar un mensaje nuevo detrás de una dependencia antigua o de otro destinatario | Se marca dependencia no verificable; prueba de ambos casos. |
| Superar las escrituras/documento máximo de Firestore | Máximo de 300 expectativas reconciliadas por transacción y 300 detalles compartidos en el snapshot. Recortes explícitos. |
| Carrera entre consulta de incidencias y transacción de otro evaluador | Se conserva el snapshot anterior si aparecieron IDs que esta ejecución no leyó; comparación monotónica de fechas. |
| Interpretar lote generado como entrega | Panel separa lote registrado, registros pendientes y ACK; ningún estado afirma recepción/lectura. |
| Detectar grupo inválido solo después de las 08:00 | La comprobación preventiva crea incidencia antes del envío; prueba real emulada a las 07:46 y 07:56. |
| Considerar recuperada una incidencia cuando falló una fuente | Se conservan incidencias previas como no verificadas; prueba fallo, continuidad y recuperación. |
| Aplicar atención cuando el flag de despliegue está apagado | API verifica el flag además del control privado; no se permite mutación por cliente. |
| Contaminar el paquete aislado con funciones operacionales | Paquete resuelve dependencias locales, exporta solo tres funciones nuevas; verificación de carga del paquete. |

## Verificación local

- Typecheck ERP Next y build completo con sus prebuild gates: PASS.
- `validate:firebase` con prevalidate: PASS (23 pruebas de los hooks existentes).
- Suite de mensajería transaccional existente: 133 PASS.
- Gateway, referencias y paquetes: 34 PASS.
- Detector, límites, adaptador, políticas y paquete nuevo: 12 PASS.
- Auth/Firestore emulados: acceso anónimo y técnico denegado, oficina permitida, revocación
  de perfil inmediata, lectura directa denegada, 8 observaciones duplicadas, 4 evaluaciones
  simultáneas, 8 atenciones simultáneas con un único efecto/auditoría, versión antigua rechazada,
  recuperación, corte, cero escrituras de cola por el monitor y planificación preventiva: PASS.
- Navegador Chromium sobre el ERP compilado: cinco vistas, una consulta compartida, atención,
  cierre con Escape, estado obsoleto, error, recuperación y viewport móvil 390 px sin overflow:
  PASS. Todas las solicitudes externas interceptadas; datos sintéticos, cero envíos reales.
- Inspección visual de escritorio 1600×1160: distribución y jerarquía de la captura aprobada
  conservadas. El menú cambia según el rol real de la sesión.

## Decisión y límites

Implementación apta para revisión de publicación, con activación bloqueada hasta completar
`docs/WHATSAPP_MONITOR_ACTIVATION.md`. CI de la rama verifica Node 22, emuladores, build y
navegador; el resultado exacto se adjunta al PR. Ningún resultado local afirma configuración
operativa de canales externos, IAM, índices o triggers en producción.

Riesgos residuales: latencia y disponibilidad de logs de Google; coste de lecturas del plan
canónico; límites explícitos de volumen; captura diaria tardía incompleta; comprobación de
trigger independiente en cada despliegue; permisos IAM servidor más amplios que una colección.
Historial conserva el último episodio por causa agrupada y la auditoría de atención durante
45 días, no una transcripción de conversaciones. Las señales de poll y ACK no prueban entrega.
Responsable de cierre: mantenedor de publicación, antes de activar. El propietario define los
destinatarios y autoriza la publicación; no se le delega la revisión técnica.
