# Clientes, propiedades y agenda real

El acceso real usa estas colecciones de Cloud Firestore:

- `clients`: información general del cliente o empresa.
- `properties`: casas, apartamentos, oficinas y locales asociados a cada cliente.
- `workOrders`: citas, asignación de van, dirección, estado y reporte técnico.
- `users`: perfiles del personal autenticado.

## Requisito obligatorio

Publica el archivo `firestore.rules` del repositorio en Firebase Console antes de probar guardados reales.

En Firebase Console:

1. Abre el proyecto `demac-corporation`.
2. Entra a **Firestore Database**.
3. Abre la pestaña **Rules**.
4. Reemplaza las reglas actuales por el contenido de `firestore.rules`.
5. Presiona **Publish**.

Sin este paso, Firebase permite iniciar sesión, pero rechazará guardar clientes, propiedades y citas.

## Prueba recomendada

1. Inicia sesión con acceso real.
2. Abre **Clientes** y registra un cliente con su primera propiedad.
3. Agrega una segunda propiedad al mismo cliente.
4. Abre **Agenda**, selecciona ese cliente y una de sus propiedades.
5. Guarda una cita.
6. Cierra sesión y vuelve a entrar para confirmar que todo permanece guardado.
