require('dotenv').config()

const cors = require('cors')
const crypto = require('crypto')
const pool = require('./db')
const express = require('express')

const app = express()
const port = Number(process.env.PORT) || 3000
const sessions = new Map()
const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true)
      }

      return callback(new Error('Origin not allowed by CORS'))
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
)
app.use(express.json())

function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  const session = sessions.get(token)

  if (!session) {
    return res.status(401).json({ error: 'Debes iniciar sesión como docente' })
  }

  req.teacher = session
  next()
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, database: 'connected' })
  } catch (error) {
    console.error('Database health check failed:', error.message)
    res.status(503).json({ ok: false, database: 'unavailable' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : ''
  const clave = typeof req.body.clave === 'string' ? req.body.clave : ''

  if (!usuario || !clave) {
    return res.status(400).json({ error: 'El usuario y la clave son obligatorios' })
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, usuario, clave, nombre_completo FROM docentes WHERE usuario = ? LIMIT 1',
      [usuario],
    )
    const teacher = rows[0]

    if (!teacher || teacher.clave !== clave) {
      return res.status(401).json({ error: 'Usuario o clave incorrectos' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    sessions.set(token, {
      id: teacher.id,
      usuario: teacher.usuario,
      nombre_completo: teacher.nombre_completo,
    })

    res.json({
      token,
      docente: sessions.get(token),
    })
  } catch (error) {
    console.error('Could not authenticate teacher:', error.message)
    res.status(500).json({ error: 'No se pudo iniciar sesión' })
  }
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = (req.get('authorization') || '').slice('Bearer '.length)
  sessions.delete(token)
  res.status(204).end()
})

app.get('/api/actividades', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, descripcion, nivel, categoria, icono_url FROM actividades ORDER BY nivel, id',
    )
    res.json(rows)
  } catch (error) {
    console.error('Could not retrieve activities:', error.message)
    res.status(500).json({ error: 'No se pudieron obtener las actividades' })
  }
})

app.get('/api/estudiantes/public', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, edad FROM estudiantes ORDER BY nombre',
    )
    res.json(rows)
  } catch (error) {
    console.error('Could not retrieve public student profiles:', error.message)
    res.status(500).json({ error: 'No se pudieron cargar los perfiles' })
  }
})

app.get('/api/estudiantes', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, edad, fecha_registro FROM estudiantes ORDER BY nombre',
    )
    res.json(rows)
  } catch (error) {
    console.error('Could not retrieve students:', error.message)
    res.status(500).json({ error: 'No se pudieron obtener los estudiantes' })
  }
})

app.post('/api/estudiantes', requireAuth, async (req, res) => {
  const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : ''
  const edad = Number(req.body.edad)

  if (!nombre || !Number.isInteger(edad) || edad < 1 || edad > 14) {
    return res.status(400).json({
      error: 'El nombre es obligatorio y la edad debe ser un entero entre 1 y 14',
    })
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO estudiantes (nombre, edad) VALUES (?, ?)',
      [nombre, edad],
    )
    const [rows] = await pool.execute(
      'SELECT id, nombre, edad, fecha_registro FROM estudiantes WHERE id = ?',
      [result.insertId],
    )
    res.status(201).json(rows[0])
  } catch (error) {
    console.error('Could not create student:', error.message)
    res.status(500).json({ error: 'No se pudo registrar el estudiante' })
  }
})

app.get('/api/progresos', requireAuth, async (req, res) => {
  const studentId = req.query.estudiante_id
  const hasStudentFilter = studentId !== undefined

  if (hasStudentFilter && (!/^\d+$/.test(String(studentId)) || Number(studentId) < 1)) {
    return res.status(400).json({ error: 'El estudiante_id no es válido' })
  }

  try {
    const query = `
      SELECT
        p.id,
        p.estudiante_id,
        e.nombre AS estudiante,
        p.actividad_id,
        a.nombre AS actividad,
        p.puntuacion,
        p.aciertos,
        p.errores,
        p.fecha_juego
      FROM progresos p
      INNER JOIN estudiantes e ON e.id = p.estudiante_id
      INNER JOIN actividades a ON a.id = p.actividad_id
      ${hasStudentFilter ? 'WHERE p.estudiante_id = ?' : ''}
      ORDER BY p.fecha_juego DESC
    `
    const [rows] = await pool.execute(
      query,
      hasStudentFilter ? [Number(studentId)] : [],
    )
    res.json(rows)
  } catch (error) {
    console.error('Could not retrieve progress:', error.message)
    res.status(500).json({ error: 'No se pudo obtener el progreso' })
  }
})

app.post('/api/progresos', async (req, res) => {
  const estudianteId = Number(req.body.estudiante_id)
  const actividadId = Number(req.body.actividad_id)
  const puntuacion = Number(req.body.puntuacion)
  const aciertos = Number(req.body.aciertos)
  const errores = Number(req.body.errores)

  const valuesAreValid = [
    estudianteId,
    actividadId,
    puntuacion,
    aciertos,
    errores,
  ].every((value) => Number.isInteger(value) && value >= 0)

  if (
    !valuesAreValid ||
    estudianteId < 1 ||
    actividadId < 1
  ) {
    return res.status(400).json({
      error: 'Los datos del progreso deben ser enteros no negativos válidos',
    })
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO progresos
        (estudiante_id, actividad_id, puntuacion, aciertos, errores)
       VALUES (?, ?, ?, ?, ?)`,
      [estudianteId, actividadId, puntuacion, aciertos, errores],
    )
    res.status(201).json({ id: result.insertId })
  } catch (error) {
    console.error('Could not create progress:', error.message)
    res.status(500).json({ error: 'No se pudo guardar el progreso' })
  }
})

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`)
})
