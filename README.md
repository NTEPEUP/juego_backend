# Juego Backend

API REST del sistema educativo infantil con Express, Node.js y MySQL.

## Requisitos

- Node.js 18+
- MySQL 8+
- Base de datos `edu_juegos_infantiles` existente

## Configuración

Copia `.env.example` como `.env` y completa las credenciales de tu base de datos.

## Ejecución

```powershell
npm start
```

La API se inicia en `http://localhost:3000`.

También puedes iniciar la API directamente con:

```powershell
node index.js
```

En ambos casos se cargan las variables del archivo `.env`.

## Autenticación

El docente inicia sesión con:

```text
POST /api/auth/login
```

Body:

```json
{
  "usuario": "profesor",
  "clave": "tu-clave"
}
```

La respuesta contiene un token temporal. Para acceder a estudiantes y reportes se debe enviar:

```text
Authorization: Bearer <token>
```

Rutas protegidas actualmente:

- `GET /api/estudiantes`
- `POST /api/estudiantes`
- `PATCH /api/estudiantes/:id/estado`
- `GET /api/progresos`

El endpoint público `GET /api/estudiantes/public` solo devuelve estudiantes
con `estado = 1`. El endpoint de estado recibe `{ "estado": 1 }` para activar
y `{ "estado": 0 }` para desactivar.

El token se mantiene en memoria del servidor y se invalida al reiniciar la API.
