# Portal del Técnico v2 — Mapa funcional

## Objetivo

Separar lo programado por la oficina del trabajo realmente ejecutado por el equipo de campo y permitir que técnico y ayudante trabajen simultáneamente sobre el mismo aire acondicionado sin sobrescribir información.

## Jerarquía operacional

```text
Cita / Work Order
└── Visita real
    ├── Aire incluido en la visita
    │   ├── Intervención principal
    │   ├── Intervenciones adicionales
    │   ├── Secciones del reporte
    │   └── Evidencias
    ├── Cambios de alcance
    └── Autorizaciones
```

La cita conserva siempre el alcance programado. La visita registra lo que realmente ocurrió.

## Diez pantallas

### 1. Mis trabajos

Muestra trabajos de hoy y mañana, horario, cliente, dirección, alcance programado, van, técnicos y estado.

Acciones:
- Abrir trabajo.
- Maps / llamada / WhatsApp.
- En camino.
- Llegué.

### 2. Resumen de la visita

Muestra:
- Información programada.
- Descripción del cliente.
- Instrucciones internas.
- Contacto de llegada.
- Equipo asignado.
- Historial del cliente y del equipo.

Acción principal: **Iniciar visita**.

### 3. Construir trabajo real

Opciones:
- Escanear QR.
- Seleccionar aire registrado.
- Registrar aire nuevo.
- Abrir aire agregado por otro miembro del equipo.

La cantidad real de aires no queda limitada por el booking.

### 4. QR y registro del equipo

Un QR representa el sistema completo. Indoor y outdoor permanecen como componentes separados dentro del sistema.

El QR solo contiene un identificador aleatorio y no contiene información personal.

### 5. Seleccionar trabajo

Tipos iniciales:
- Servicio estándar.
- Servicio profundo.
- Reparación.
- Instalación.
- Diagnóstico.
- Chequeo.

Cada aire puede tener una intervención principal y varias intervenciones adicionales.

### 6. Panel del aire

Muestra:
- Nombre o ubicación.
- QR.
- Tipo de trabajo.
- Estado.
- Progreso Indoor.
- Progreso Outdoor.
- Mediciones.
- Hallazgos.
- Materiales.
- Usuario activo en cada sección.

### 7. Indoor

El técnico o ayudante registra identificación, fotos, condición inicial, proceso, condición final, temperaturas y hallazgos de la unidad interior.

### 8. Outdoor

El técnico o ayudante registra identificación, fotos, coil, bracket, disconnect, cableado, presiones, amperaje, proceso y condición final.

### 9. Trabajo adicional y autorización

Todo cambio registra:
- Origen.
- Motivo.
- Usuario.
- Hora.
- Alcance anterior.
- Alcance propuesto.
- Estado de autorización.
- Resolución.

### 10. Cierre de la visita

Muestra el resumen de todos los aires, trabajos realizados, pendientes, hallazgos urgentes, segunda visita y receptor del trabajo.

Solo el técnico responsable puede cerrar la visita.

## Roles y permisos

### Técnico responsable

Puede agregar aires, registrar equipos, crear intervenciones, cambiar alcance real, completar secciones, completar unidades, solicitar autorizaciones y cerrar la visita.

### Técnico

Puede realizar trabajo técnico completo y completar unidades. No puede cerrar toda la visita cuando no es el responsable designado.

### Ayudante

Puede abrir unidades existentes, completar secciones asignadas, registrar fotos, mediciones y hallazgos. No puede cambiar alcance, eliminar unidades, aprobar trabajos adicionales ni cerrar la visita.

### Oficina y supervisor

Pueden revisar alcance, aprobar trabajos adicionales, devolver reportes y solicitar información adicional. La oficina no modifica silenciosamente las mediciones del técnico.

## Colaboración simultánea

Las secciones deben almacenarse como documentos independientes.

Ejemplo:

```text
Miguel → Indoor
José → Outdoor
```

Cada documento guarda usuario, empleado, fecha, versión y estado. Una escritura sobre Indoor no reemplaza Outdoor.

## Colecciones previstas

```text
workOrders
workVisits
equipmentSystems
visitUnits
workInterventions
workReportSections
workOrderEvidence
scopeChanges
visitApprovals
workActivity
```

## Reglas de implementación

1. No reemplazar el portal actual hasta completar las pruebas.
2. Mantener el estilo visual existente de DEMAC.
3. Proteger cada cambio con permisos de rol y asignación a la orden o van.
4. Utilizar sincronización en tiempo real para unidades, secciones, evidencias y hallazgos.
5. Mantener cola local cuando no haya internet.
6. Registrar auditoría y versión en cada documento colaborativo.
7. Guardar `templateId` y `templateVersion` en cada intervención.
8. No involucrar IA hasta que el flujo operacional y los contratos sean estables.

## Orden de PRs

1. Vista piloto visual.
2. Contratos y plantillas versionadas.
3. Persistencia de visitas, unidades e intervenciones.
4. QR y registro de equipos.
5. Secciones colaborativas Indoor/Outdoor.
6. Cambios de alcance y autorizaciones.
7. Cierre de visita y revisión de oficina.
8. Plantillas completas y validaciones.
9. Generación de reportes mediante IA.
