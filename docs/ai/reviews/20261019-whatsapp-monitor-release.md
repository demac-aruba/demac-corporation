# Publicación del monitor de mensajería — 2026-10-19

Modo: Deep Review, Solo Maintainer Adversarial Review. Esta revisión separada no es independiente.
Autorización: el propietario solicitó explícitamente “puedes hacer merge y deploy”.

## Alcance y autoridades

- Integrar main 78f7ac5 (PR608/609, mejoras de direcciones/textos) en PR607; conservar QBO.
- Modificar únicamente los metadatos de correlación de queueAppointmentConfirmation y las
  señales sanitarias de wacliOutboundPoll, a partir de sus archivos desplegados reales.
- Tres funciones nuevas en codebase messaging-monitor con identidad dedicada; Firestore
  conserva su autoridad operacional y el monitor escribe solo proyecciones privadas.
- Índice aditivo status/createdAt de la cola; TTL e índices excluidos solo en grupos del monitor.
- Activación desde el instante confirmado en transacción, sin expectativas retrospectivas.
- El descarte anterior owner-requested-20261019-cutover permanece terminal. No hay envíos,
  reclamos de cola, reintentos históricos ni nuevas notificaciones externas en este release.

## Revisión adversarial posterior a la implementación

Se inspeccionaron el diff integrado, wrappers, entradas de release y utilidades transitivas
existentes de fuente/ZIP/transporte. Se cuestionaron colisiones de funciones, pérdida de ACK,
fuente concurrente, despliegue parcial, cambio de identidad, pérdida de cutover y exposición
accidental de secretos en errores. Se añadió detección inversa del parche para reanudar una
publicación parcial sin aplicar dos veces metadatos. Las pruebas rechazan cambios ajenos,
transportes no privados, identidades equivocadas y controles desactivados o de otro propietario.

Los dos candidatos se validan con sus dependencias archivadas, tests seleccionados y arranque
real sin conexiones externas antes de modificar producción. Fuente, configuración, IAM y
tráfico se comparan después; el workflow comparte exclusión mutua con las otras publicaciones.
El paquete nuevo solo exporta tres funciones y no puede eliminar otro codebase. El control
se crea una sola vez y nunca restablece su corte en una reanudación. API anónima debe devolver
401; snapshot vigente, cobertura completa y heartbeat deben existir antes de marcar activo.

## Evidencia previa a merge

- 136 pruebas transaccionales: PASS.
- 46 pruebas de monitor, gateway y referencias: PASS.
- 20 pruebas del release, transporte privado y recuperación de operaciones: PASS.
- Aplicación del parche original sobre main actual, igualdad byte a byte con la integración
  y prueba inversa de reanudación: PASS.
- CI del commit final debe completar validación Firebase, Auth/Firestore emulator,
  compilación ERP y verificación de navegador ya requeridas por whatsapp-monitor.yml.

## Riesgos y verificación posterior

Firestore IAM no restringe datastore.user por colección: la identidad dedicada sigue teniendo
ese alcance técnico. El servicio no expone escrituras arbitrarias y sus pruebas verifican la
frontera; no se le conceden Owner, Editor ni secretos del bridge. La publicación puede fallar
cerrada por permisos o configuración del proveedor; no habilitar el frontend hasta verificar
el backend. La supervisión no acredita lectura/entrega de WhatsApp ni anticipa toda avería.
Las alertas externas permanecen pendientes de destinatario y de una prueba real de recepción.
No declarar vigilancia externa operativa ni sistema infalible sin esa evidencia.
