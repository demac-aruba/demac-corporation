# Guía de prueba del MVP

## 1. Administrador

Use `admin@demac.demo` / `demac2026`.

Pruebe:
- Panel principal y alertas.
- Crear una cita desde Agenda.
- Crear un cliente.
- Revisar y aprobar órdenes.
- Registrar pagos.
- Ajustar inventario.
- Cambiar a otros roles cerrando sesión.

## 2. Técnico

Desde la pantalla de inicio seleccione **Carlos Rodríguez** o use:
- Correo: `carlos@demac.demo`
- Contraseña: `demo123`

Pruebe:
- Cambiar una orden a En camino, En el sitio y En proceso.
- Registrar mediciones.
- Completar diagnóstico, trabajo realizado y recomendación.
- Seleccionar fotografías desde el Samsung o navegador.
- Escribir el nombre del cliente como conformidad.
- Completar el trabajo.

## 3. Persistencia

Los cambios se guardan localmente con AsyncStorage. En Configuración, el administrador puede restablecer los datos ficticios.

## Limitaciones de este MVP

- No está conectado todavía a Firebase ni a un servidor real.
- Los usuarios y contraseñas son ficticios y están incluidos solo para pruebas.
- La firma es una conformidad por nombre escrito; la firma manuscrita se añadirá en la fase de producción.
- El reporte puede revisarse y marcarse como generado, pero el PDF final con plantilla oficial se conectará al recibir el formato de DEMAC.
- No se ha publicado en Google Play.
