import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { z } from 'zod'
import { jwtSecret } from './config.js'
import { allow, authenticate } from './auth.js'
import { pool, query } from './db.js'
import { approvalStageFor, calculateLeaveDays } from './domain.js'

const app = express()
const here = path.dirname(fileURLToPath(import.meta.url))
export const uploadsDirectory = path.resolve(here, '../uploads')

app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
app.use(express.json({ limit: '100kb' }))

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false })
const uploadExtensions = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }
app.use('/api', apiLimiter)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!Object.hasOwn(uploadExtensions, file.mimetype)) {
      return callback(new Error('Only PDF, JPEG and PNG documents are allowed.'))
    }
    callback(null, true)
  },
})

app.get('/api/faculty/students', authenticate, allow('faculty'), async (req, res) => {
  res.json(await query(
    `SELECT DISTINCT s.id, s.student_number, u.full_name, u.email, d.name AS department,
      sem.name AS semester
     FROM faculty f JOIN students s ON s.class_teacher_id = f.id OR s.hod_id = f.id
     JOIN users u ON u.id = s.user_id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN semesters sem ON sem.id = s.semester_id
     WHERE f.user_id = ? ORDER BY u.full_name`,
    [req.user.id],
  ))
})

const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  password: z.string().min(8).max(72),
  student_number: z.string().trim().min(2).max(40),
})
const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(72) })
const leaveSchema = z.object({
  leave_type: z.enum(['Medical', 'Personal', 'Emergency', 'Academic', 'Other']),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  reason: z.string().trim().min(5).max(1000),
})
const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  remarks: z.string().trim().max(1000).optional().default(''),
})

function validationError(error) {
  return error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ') || 'Invalid request.'
}

function createToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '8h' })
}

async function getFacultyAssignment(userId) {
  const rows = await query('SELECT id, designation FROM faculty WHERE user_id = ? LIMIT 1', [userId])
  return rows[0]
}

async function facultyHasDesignation(facultyId, designation) {
  const rows = await query(
    `SELECT f.id FROM faculty f JOIN users u ON u.id = f.user_id
     WHERE f.id = ? AND f.designation = ? AND u.is_active = TRUE LIMIT 1`,
    [facultyId, designation],
  )
  return rows.length > 0
}

async function loadLeave(leaveId) {
  const rows = await query(
    `SELECT l.*, s.student_number, u.full_name AS student_name,
       d.original_name AS document_name, f.user_id AS class_teacher_user_id,
       h.user_id AS hod_user_id
     FROM leave_applications l
     JOIN students s ON s.id = l.student_id
     JOIN users u ON u.id = s.user_id
     LEFT JOIN faculty f ON f.id = s.class_teacher_id
     LEFT JOIN faculty h ON h.id = s.hod_id
     LEFT JOIN leave_documents d ON d.leave_application_id = l.id
     WHERE l.id = ? LIMIT 1`,
    [leaveId],
  )
  return rows[0]
}

async function canViewLeave(user, leave) {
  if (user.role === 'admin') return true
  if (user.role === 'student') {
    const rows = await query('SELECT id FROM students WHERE user_id = ? AND id = ?', [user.id, leave.student_id])
    return rows.length > 0
  }
  const assignment = await getFacultyAssignment(user.id)
  if (!assignment) return false
  const expectedUser = leave.status === 'pending_class_teacher'
    ? leave.class_teacher_user_id
    : leave.status === 'pending_hod' ? leave.hod_user_id : null
  return expectedUser === user.id && approvalStageFor(user.role, assignment.designation, leave.status)
}

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', database: 'connected' })
})

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  const { full_name, email, password, student_number } = parsed.data
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const passwordHash = await bcrypt.hash(password, 12)
    const [result] = await connection.execute(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, "student")',
      [full_name, email.toLowerCase(), passwordHash],
    )
    await connection.execute('INSERT INTO students (user_id, student_number) VALUES (?, ?)', [result.insertId, student_number])
    await connection.commit()
    res.status(201).json({ message: 'Account created. You can now sign in.' })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email or student number is already registered.' })
    throw error
  } finally { connection.release() }
})

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address and password.' })
  const rows = await query('SELECT id, full_name, email, role, password_hash, is_active FROM users WHERE email = ? LIMIT 1', [parsed.data.email.toLowerCase()])
  const account = rows[0]
  if (!account || !account.is_active || !(await bcrypt.compare(parsed.data.password, account.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' })
  }
  const { password_hash: _passwordHash, is_active: _isActive, ...user } = account
  res.json({ token: createToken(user), user })
})

app.get('/api/auth/me', authenticate, async (req, res) => {
  const profile = await query(
    `SELECT u.id, u.full_name, u.email, u.role,
      s.student_number, d.name AS department, sem.name AS semester,
      f.designation AS faculty_designation
     FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN semesters sem ON sem.id = s.semester_id
     LEFT JOIN faculty f ON f.user_id = u.id
     WHERE u.id = ? LIMIT 1`,
    [req.user.id],
  )
  res.json(profile[0])
})

app.get('/api/profile', authenticate, async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.role, s.student_number,
      d.name AS department, sem.name AS semester, f.designation
     FROM users u LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN semesters sem ON sem.id = s.semester_id
     LEFT JOIN faculty f ON f.user_id = u.id WHERE u.id = ?`,
    [req.user.id],
  )
  res.json(rows[0])
})

app.patch('/api/profile', authenticate, async (req, res) => {
  const parsed = z.object({ full_name: z.string().trim().min(2).max(120) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  await query('UPDATE users SET full_name = ? WHERE id = ?', [parsed.data.full_name, req.user.id])
  res.json({ full_name: parsed.data.full_name })
})

app.get('/api/dashboard', authenticate, async (req, res) => {
  let result
  if (req.user.role === 'student') {
    const rows = await query(
      `SELECT COUNT(*) AS total,
        SUM(status IN ('pending_class_teacher', 'pending_hod', 'pending_admin')) AS pending,
        SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN days ELSE 0 END), 0) AS days
       FROM leave_applications WHERE student_id = (SELECT id FROM students WHERE user_id = ?)`,
      [req.user.id],
    )
    result = rows[0]
  } else if (req.user.role === 'faculty') {
    const rows = await query(
      `SELECT
        (SELECT COUNT(*) FROM students s JOIN faculty f ON (s.class_teacher_id = f.id OR s.hod_id = f.id) WHERE f.user_id = ?) AS students,
        (SELECT COUNT(*) FROM leave_applications l JOIN students s ON s.id = l.student_id JOIN faculty f ON
          (f.designation = 'class_teacher' AND s.class_teacher_id = f.id AND l.status = 'pending_class_teacher')
          OR (f.designation = 'hod' AND s.hod_id = f.id AND l.status = 'pending_hod')
          WHERE f.user_id = ?) AS pending,
        (SELECT COUNT(*) FROM leave_applications l JOIN students s ON s.id = l.student_id JOIN faculty f ON
          (s.class_teacher_id = f.id OR s.hod_id = f.id)
          WHERE f.user_id = ? AND l.status = 'approved') AS approved,
        (SELECT COUNT(*) FROM leave_applications l JOIN students s ON s.id = l.student_id JOIN faculty f ON
          (s.class_teacher_id = f.id OR s.hod_id = f.id)
          WHERE f.user_id = ? AND l.status = 'rejected') AS rejected`,
      [req.user.id, req.user.id, req.user.id, req.user.id],
    )
    result = rows[0]
  } else {
    const rows = await query(
      `SELECT (SELECT COUNT(*) FROM students) AS students,
        (SELECT COUNT(*) FROM faculty) AS faculty,
        SUM(status IN ('pending_class_teacher', 'pending_hod', 'pending_admin')) AS pending,
        SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected
       FROM leave_applications`,
    )
    result = rows[0]
  }
  for (const key of Object.keys(result || {})) result[key] = Number(result[key] || 0)
  res.json(result || {})
})

app.get('/api/leaves', authenticate, async (req, res) => {
  let sql = `SELECT l.id, l.leave_type, l.start_date, l.end_date, l.days, l.reason, l.status,
      l.created_at, s.student_number, u.full_name AS student_name,
      d.original_name AS document_name
    FROM leave_applications l JOIN students s ON s.id = l.student_id
    JOIN users u ON u.id = s.user_id LEFT JOIN leave_documents d ON d.leave_application_id = l.id`
  const values = []
  if (req.user.role === 'student') {
    sql += ' WHERE s.user_id = ?'
    values.push(req.user.id)
  } else if (req.user.role === 'faculty') {
    const assignment = await getFacultyAssignment(req.user.id)
    if (!assignment) return res.json([])
    sql += assignment.designation === 'hod'
      ? ' WHERE s.hod_id = ? AND l.status = "pending_hod"'
      : ' WHERE s.class_teacher_id = ? AND l.status = "pending_class_teacher"'
    values.push(assignment.id)
  }
  sql += ' ORDER BY l.created_at DESC'
  res.json(await query(sql, values))
})

app.post('/api/leaves', authenticate, allow('student'), upload.single('document'), async (req, res) => {
  const storedName = req.file ? `${crypto.randomUUID()}${uploadExtensions[req.file.mimetype]}` : null
  const storedPath = storedName ? path.join(uploadsDirectory, storedName) : null
  if (req.file) {
    const bytes = req.file.buffer.subarray(0, 8)
    const validSignature = req.file.mimetype === 'application/pdf'
      ? bytes.subarray(0, 5).toString() === '%PDF-'
      : req.file.mimetype === 'image/jpeg'
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : req.file.mimetype === 'image/png' && bytes.length === 8
          && bytes.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (!validSignature) {
      return res.status(400).json({ error: 'The uploaded file is not a valid PDF, JPEG or PNG document.' })
    }
  }
  const parsed = leaveSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  let days
  try { days = calculateLeaveDays(parsed.data.start_date, parsed.data.end_date) } catch (error) {
    return res.status(400).json({ error: error.message })
  }
  const students = await query(
    `SELECT s.id, active_teacher.id AS class_teacher_user_id, active_hod.id AS hod_user_id
     FROM students s
     LEFT JOIN faculty teacher ON teacher.id = s.class_teacher_id AND teacher.designation = 'class_teacher'
     LEFT JOIN users active_teacher ON active_teacher.id = teacher.user_id AND active_teacher.is_active = TRUE
     LEFT JOIN faculty hod ON hod.id = s.hod_id AND hod.designation = 'hod'
     LEFT JOIN users active_hod ON active_hod.id = hod.user_id AND active_hod.is_active = TRUE
     WHERE s.user_id = ? LIMIT 1`,
    [req.user.id],
  )
  if (!students.length) return res.status(400).json({ error: 'Complete your student profile before applying for leave.' })
  if (!students[0].class_teacher_user_id || !students[0].hod_user_id) {
    return res.status(400).json({ error: 'An active class teacher and HOD must be assigned before you can apply for leave.' })
  }
  let connection
  let transactionStarted = false
  let fileWritten = false
  try {
    if (req.file) {
      await fs.mkdir(uploadsDirectory, { recursive: true })
      const file = await fs.open(storedPath, 'wx')
      fileWritten = true
      try { await file.writeFile(req.file.buffer) } finally { await file.close() }
    }
    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true
    const [result] = await connection.execute(
      `INSERT INTO leave_applications
        (student_id, leave_type, start_date, end_date, days, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending_class_teacher')`,
      [students[0].id, parsed.data.leave_type, parsed.data.start_date, parsed.data.end_date, days, parsed.data.reason],
    )
    await connection.execute(
      `INSERT INTO approval_history (leave_application_id, actor_user_id, stage, decision, remarks)
       VALUES (?, ?, 'submitted', 'submitted', 'Application submitted by student')`,
      [result.insertId, req.user.id],
    )
    if (req.file) {
      await connection.execute(
        'INSERT INTO leave_documents (leave_application_id, original_name, stored_name, mime_type, file_size) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, path.basename(req.file.originalname.replaceAll('\\', '/')).slice(0, 255), storedName, req.file.mimetype, req.file.size],
      )
    }
    if (students[0].class_teacher_user_id) await connection.execute(
      'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
      [students[0].class_teacher_user_id, 'Leave application for review', `${req.user.full_name} submitted a leave request.`],
    )
    await connection.commit()
    res.status(201).json({ id: result.insertId, days, status: 'pending_class_teacher' })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    if (fileWritten) await fs.unlink(storedPath).catch(() => {})
    throw error
  } finally { connection?.release() }
})

app.patch('/api/leaves/:id/decision', authenticate, allow('faculty', 'admin'), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  const leave = await loadLeave(req.params.id)
  if (!leave) return res.status(404).json({ error: 'Leave application not found.' })
  const permitted = req.user.role === 'admin'
    ? approvalStageFor(req.user.role, null, leave.status)
    : await canViewLeave(req.user, leave)
  if (!permitted) return res.status(403).json({ error: 'This application is not assigned to you for review.' })
  if (parsed.data.decision === 'rejected' && !parsed.data.remarks) {
    return res.status(400).json({ error: 'Please provide a reason when rejecting an application.' })
  }
  const nextStatus = parsed.data.decision === 'rejected'
    ? 'rejected'
    : leave.status === 'pending_class_teacher' ? 'pending_hod'
      : leave.status === 'pending_hod' ? 'pending_admin' : 'approved'
  const stage = leave.status.replace('pending_', '')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute(
      'UPDATE leave_applications SET status = ? WHERE id = ? AND status = ?',
      [nextStatus, leave.id, leave.status],
    )
    if (result.affectedRows !== 1) {
      await connection.rollback()
      return res.status(409).json({ error: 'This application has already been updated. Refresh and try again.' })
    }
    await connection.execute(
      'INSERT INTO approval_history (leave_application_id, actor_user_id, stage, decision, remarks) VALUES (?, ?, ?, ?, ?)',
      [leave.id, req.user.id, stage, parsed.data.decision, parsed.data.remarks],
    )
    const [student] = await connection.execute('SELECT user_id FROM students WHERE id = ?', [leave.student_id])
    const outcome = nextStatus === 'approved' ? 'approved' : nextStatus === 'rejected' ? 'rejected' : 'moved to the next review stage'
    await connection.execute(
      'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
      [student[0].user_id, 'Leave application update', `Your leave request was ${outcome}.`],
    )
    if (nextStatus === 'pending_hod' || nextStatus === 'pending_admin') {
      const reviewerUser = nextStatus === 'pending_hod' ? leave.hod_user_id : null
      if (reviewerUser) await connection.execute(
        'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
        [reviewerUser, 'Leave application for review', `${leave.student_name}'s leave request is ready for your review.`],
      )
      if (nextStatus === 'pending_admin') {
        await connection.execute(
          `INSERT INTO notifications (user_id, title, message)
           SELECT id, 'Leave application for final review', ?
           FROM users WHERE role = 'admin' AND is_active = TRUE`,
          [`${leave.student_name}'s leave request is ready for final review.`],
        )
      }
    }
    await connection.commit()
    res.json({ id: leave.id, status: nextStatus })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { connection.release() }
})

app.get('/api/leaves/:id/document', authenticate, async (req, res) => {
  const leave = await loadLeave(req.params.id)
  if (!leave) return res.status(404).json({ error: 'Leave application not found.' })
  if (!(await canViewLeave(req.user, leave))) return res.status(403).json({ error: 'You cannot access this document.' })
  const documents = await query('SELECT stored_name, original_name, mime_type FROM leave_documents WHERE leave_application_id = ? LIMIT 1', [leave.id])
  const item = documents[0]
  if (!item) return res.status(404).json({ error: 'No document was uploaded for this application.' })
  const storedName = item.stored_name
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png)$/i.test(storedName)) {
    return res.status(404).json({ error: 'The stored document is unavailable.' })
  }
  return res.download(path.join(uploadsDirectory, storedName), item.original_name, { dotfiles: 'deny' })
})

app.get('/api/notifications', authenticate, async (req, res) => {
  res.json(await query('SELECT id, title, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]))
})

app.patch('/api/notifications/read', authenticate, async (req, res) => {
  await query('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [req.user.id])
  res.json({ updated: true })
})

app.get('/api/admin/users', authenticate, allow('admin'), async (_req, res) => {
  res.json(await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.is_active,
      s.id AS student_id, s.student_number, s.department_id, s.semester_id,
      s.class_teacher_id, s.hod_id, f.title, f.designation,
      f.department_id AS faculty_department_id, f.id AS faculty_id
     FROM users u LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN faculty f ON f.user_id = u.id ORDER BY u.full_name`,
  ))
})

app.post('/api/admin/users', authenticate, allow('admin'), async (req, res) => {
  const schema = z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    password: z.string().min(8).max(72),
    role: z.enum(['student', 'faculty']),
    student_number: z.string().trim().min(2).max(40).optional(),
    title: z.string().trim().max(120).optional(),
    designation: z.enum(['class_teacher', 'hod']).optional(),
    department_id: z.number().int().positive().nullable().optional(),
    semester_id: z.number().int().positive().nullable().optional(),
    class_teacher_id: z.number().int().positive().nullable().optional(),
    hod_id: z.number().int().positive().nullable().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  if (parsed.data.role === 'student' && !parsed.data.student_number) return res.status(400).json({ error: 'Student number is required.' })
  if (parsed.data.role === 'faculty' && !parsed.data.designation) return res.status(400).json({ error: 'Faculty designation is required.' })
  if (parsed.data.role === 'student' && parsed.data.class_teacher_id
    && !(await facultyHasDesignation(parsed.data.class_teacher_id, 'class_teacher'))) {
    return res.status(400).json({ error: 'Select a faculty member designated as a class teacher.' })
  }
  if (parsed.data.role === 'student' && parsed.data.hod_id
    && !(await facultyHasDesignation(parsed.data.hod_id, 'hod'))) {
    return res.status(400).json({ error: 'Select a faculty member designated as an HOD.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [parsed.data.full_name, parsed.data.email.toLowerCase(), await bcrypt.hash(parsed.data.password, 12), parsed.data.role],
    )
    if (parsed.data.role === 'student') {
      await connection.execute(
        `INSERT INTO students (user_id, student_number, department_id, semester_id, class_teacher_id, hod_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, parsed.data.student_number, parsed.data.department_id ?? null,
          parsed.data.semester_id ?? null, parsed.data.class_teacher_id ?? null, parsed.data.hod_id ?? null],
      )
    } else {
      await connection.execute(
        'INSERT INTO faculty (user_id, title, designation, department_id) VALUES (?, ?, ?, ?)',
        [result.insertId, parsed.data.title || 'Faculty member', parsed.data.designation, parsed.data.department_id ?? null],
      )
    }
    await connection.commit()
    res.status(201).json({ id: result.insertId, message: 'Account created.' })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email or student number is already in use.' })
    throw error
  } finally { connection.release() }
})

app.patch('/api/admin/students/:id', authenticate, allow('admin'), async (req, res) => {
  const assignmentId = z.number().int().positive().nullable().optional()
  const parsed = z.object({
    department_id: assignmentId,
    semester_id: assignmentId,
    class_teacher_id: assignmentId,
    hod_id: assignmentId,
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  const updates = parsed.data
  if (Object.hasOwn(updates, 'class_teacher_id') && updates.class_teacher_id === null) {
    const pending = await query(
      'SELECT COUNT(*) AS total FROM leave_applications WHERE student_id = ? AND status = "pending_class_teacher"',
      [req.params.id],
    )
    if (Number(pending[0].total) > 0) return res.status(409).json({ error: 'Reassign this student’s pending class-teacher applications before clearing the class teacher.' })
  }
  if (Object.hasOwn(updates, 'hod_id') && updates.hod_id === null) {
    const pending = await query(
      `SELECT COUNT(*) AS total FROM leave_applications
       WHERE student_id = ? AND status IN ('pending_class_teacher', 'pending_hod')`,
      [req.params.id],
    )
    if (Number(pending[0].total) > 0) return res.status(409).json({ error: 'Reassign this student’s pending applications before clearing the HOD.' })
  }
  if (updates.class_teacher_id && !(await facultyHasDesignation(updates.class_teacher_id, 'class_teacher'))) {
    return res.status(400).json({ error: 'Select a faculty member designated as a class teacher.' })
  }
  if (updates.hod_id && !(await facultyHasDesignation(updates.hod_id, 'hod'))) {
    return res.status(400).json({ error: 'Select a faculty member designated as an HOD.' })
  }
  const fields = Object.keys(updates)
  if (!fields.length) return res.status(400).json({ error: 'Choose at least one profile field to update.' })
  const result = await query(
    `UPDATE students SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`,
    [...fields.map((field) => updates[field] ?? null), req.params.id],
  )
  if (!result.affectedRows) return res.status(404).json({ error: 'Student profile not found.' })
  res.json({ updated: true })
})

app.patch('/api/admin/users/:id', authenticate, allow('admin'), async (req, res) => {
  const parsed = z.object({ is_active: z.boolean() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  if (!parsed.data.is_active) {
    const pending = await query(
      `SELECT COUNT(*) AS total
       FROM leave_applications l JOIN students s ON s.id = l.student_id
       JOIN faculty f ON
         (f.designation = 'class_teacher' AND s.class_teacher_id = f.id AND l.status = 'pending_class_teacher')
         OR (f.designation = 'hod' AND s.hod_id = f.id AND l.status = 'pending_hod')
       WHERE f.user_id = ?`,
      [req.params.id],
    )
    if (Number(pending[0].total) > 0) {
      return res.status(409).json({ error: 'Reassign or review this faculty member’s pending applications before disabling the account.' })
    }
  }
  const result = await query('UPDATE users SET is_active = ? WHERE id = ? AND role != "admin"', [parsed.data.is_active, req.params.id])
  if (!result.affectedRows) return res.status(404).json({ error: 'Account not found or cannot be changed.' })
  res.json({ updated: true })
})

app.get('/api/admin/departments', authenticate, allow('admin'), async (_req, res) => {
  res.json(await query('SELECT id, name, code FROM departments ORDER BY name'))
})

app.post('/api/admin/departments', authenticate, allow('admin'), async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(120), code: z.string().trim().min(2).max(20) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  try {
    const result = await query('INSERT INTO departments (name, code) VALUES (?, ?)', [parsed.data.name, parsed.data.code.toUpperCase()])
    res.status(201).json({ id: result.insertId })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Department name or code already exists.' })
    throw error
  }
})

app.get('/api/admin/semesters', authenticate, allow('admin'), async (_req, res) => {
  res.json(await query('SELECT id, name, starts_on, ends_on FROM semesters ORDER BY starts_on DESC'))
})

app.post('/api/admin/semesters', authenticate, allow('admin'), async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(60), starts_on: z.iso.date(), ends_on: z.iso.date() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: validationError(parsed.error) })
  if (parsed.data.ends_on < parsed.data.starts_on) return res.status(400).json({ error: 'Semester end date must be after its start date.' })
  const result = await query('INSERT INTO semesters (name, starts_on, ends_on) VALUES (?, ?, ?)', [parsed.data.name, parsed.data.starts_on, parsed.data.ends_on])
  res.status(201).json({ id: result.insertId })
})

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Documents must be 5 MB or smaller.' : 'Invalid document upload.' })
  if (error.message === 'Only PDF, JPEG and PNG documents are allowed.') return res.status(400).json({ error: error.message })
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) return res.status(400).json({ error: 'Request body must contain valid JSON.' })
  console.error(error)
  res.status(500).json({ error: 'The request could not be completed. Please try again.' })
})

export default app
