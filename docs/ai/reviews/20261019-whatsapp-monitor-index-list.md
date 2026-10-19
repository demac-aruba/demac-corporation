# Compatibilidad de consulta de índices de Firestore

Deep Review / Solo Maintainer Adversarial Review; revisión separada, no independiente.
Continúa la autorización del propietario para merge/deploy. Cambio limitado al tooling.

El release 39328021654 verificó la cuenta dedicada, los cuatro roles y Monitoring API.
Se detuvo en el primer GET de índices con HTTP 400, antes de crear índices, configurar
TTL, actualizar fuentes operacionales o activar el monitor. La auditoría de solo lectura
39328362775 reprodujo `Invalid page size. Only 0 is supported.` tanto para el grupo concreto
como para `-`; la misma consulta al grupo concreto sin pageSize devolvió HTTP 200.

Se omite únicamente pageSize, como hace Firebase CLI 15.30.0, y se mantiene la continuación
por pageToken si el servidor la devuelve. La lectura continúa limitada al grupo requerido;
la creación sigue siendo aditiva y no cambia su especificación. No se modifica ninguna
identidad, permiso, productor, cola, corte de activación ni condición para habilitar el panel.

Revisión adversarial: se inspeccionaron el diff, la espera READY y la detección de índices
existentes. Un error sigue deteniendo la publicación; una lista vacía solo permite crear el
índice aprobado. La regresión reproduce el rechazo por pageSize y comprueba múltiples páginas,
token con caracteres especiales, lista vacía y propagación de errores. Los checks requeridos
siguen vigentes; no se cambia ningún gate para aceptar un resultado fallido.

Validación: sintaxis y diff sin errores; 22 pruebas de release/transporte/recuperación aprobadas.
El CI debe completar antes de merge. Activación y panel aún pendientes de publicación real.
