import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine, ArrowRight, Bell, BookOpen, CalendarDays, Check, CheckCheck,
  ChevronDown, CircleHelp, ClipboardCheck, Clock3, FileText, LayoutDashboard,
  LogOut, Menu, Moon, Plus, Search, Settings, ShieldCheck, Sun, Users, X,
} from 'lucide-react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
const initialForm = { leave_type: 'Medical', start_date: '', end_date: '', reason: '' }

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', 'Bearer ' + token)
  if (!(options.body instanceof FormData) && options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  })
  const payload = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null
  if (!response.ok) throw new Error(payload?.error || 'Something went wrong. Please try again.')
  return payload
}

const statusNames = {
  pending_class_teacher: 'Class teacher review',
  pending_hod: 'HOD review',
  pending_admin: 'Final review',
  approved: 'Approved',
  rejected: 'Rejected',
}

function dateLabel(value) {
  if (!value) return '—'
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('campus-token'))
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('Overview')
  const [leaves, setLeaves] = useState([])
  const [stats, setStats] = useState({})
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [semesters, setSemesters] = useState([])
  const [assignedStudents, setAssignedStudents] = useState([])
  const [notifications, setNotifications] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('campus-theme') === 'dark')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All status')
  const [showApply, setShowApply] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [supportingFile, setSupportingFile] = useState(null)
  const [registering, setRegistering] = useState(false)
  const [showUserForm, setShowUserForm] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [newAccount, setNewAccount] = useState({ role: 'student', full_name: '', email: '', password: '', student_number: '', title: '', designation: 'class_teacher', department_id: '', semester_id: '', class_teacher_id: '', hod_id: '' })
  const [departmentForm, setDepartmentForm] = useState({ name: '', code: '' })
  const [semesterForm, setSemesterForm] = useState({ name: '', starts_on: '', ends_on: '' })
  const [now] = useState(() => new Date())
  const currentRole = user?.role

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const [dashboard, applications, inbox] = await Promise.all([
        request('/dashboard', { token }),
        request('/leaves', { token }),
        request('/notifications', { token }),
      ])
      setStats(dashboard)
      setLeaves(applications)
      setNotifications(inbox)
      if (currentRole === 'admin') {
        const [accounts, departmentsList, semestersList] = await Promise.all([
          request('/admin/users', { token }),
          request('/admin/departments', { token }),
          request('/admin/semesters', { token }),
        ])
        setUsers(accounts)
        setDepartments(departmentsList)
        setSemesters(semestersList)
      } else if (currentRole === 'faculty') {
        setAssignedStudents(await request('/faculty/students', { token }))
      }
      setError('')
    } catch (problem) {
      setError(problem.message)
    }
  }, [token, currentRole])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('campus-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    if (!token) {
      localStorage.removeItem('campus-token')
      return
    }
    localStorage.setItem('campus-token', token)
    request('/auth/me', { token })
      .then(setUser)
      .catch(() => {
        setToken(null)
        setError('Your session expired. Please sign in again.')
      })
  }, [token])

  useEffect(() => {
    // Load server data when the signed-in user changes.
    // oxlint-disable-next-line react/set-state-in-effect
    if (user) refresh()
  }, [user, refresh])

  const visibleLeaves = useMemo(() => leaves.filter((item) => {
    const matchesText = `${item.student_name || ''} ${item.leave_type} ${item.reason}`.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = filter === 'All status' || item.status === filter
    return matchesText && matchesStatus
  }), [leaves, search, filter])

  function signOut() {
    setToken(null)
    setUser(null)
    setPage('Overview')
    setError('')
  }

  async function submitAuth(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const payload = Object.fromEntries(data.entries())
    try {
      if (registering) {
        payload.role = 'student'
        await request('/auth/register', { method: 'POST', body: payload })
      }
      const result = await request('/auth/login', { method: 'POST', body: payload })
      setToken(result.token)
      setUser(result.user)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitLeave(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const body = new FormData()
    Object.entries(form).forEach(([key, value]) => body.append(key, value))
    if (supportingFile) body.append('document', supportingFile)
    try {
      await request('/leaves', { method: 'POST', token, body })
      setShowApply(false)
      setForm(initialForm)
      setSupportingFile(null)
      setNotice('Your leave application has been submitted.')
      await refresh()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  async function decide(item, decision) {
    const remarks = window.prompt(`${decision === 'approved' ? 'Approval' : 'Rejection'} remarks (optional):`, '')
    if (remarks === null) return
    if (decision === 'rejected' && !remarks.trim()) {
      setError('Please include a reason when rejecting an application.')
      return
    }
    try {
      await request(`/leaves/${item.id}/decision`, {
        method: 'PATCH', token, body: { decision, remarks },
      })
      setNotice(`Application ${decision}.`)
      await refresh()
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function toggleUser(account) {
    try {
      await request(`/admin/users/${account.id}`, {
        method: 'PATCH', token, body: { is_active: !account.is_active },
      })
      setUsers(await request('/admin/users', { token }))
      setNotice(`${account.full_name}'s account was ${account.is_active ? 'disabled' : 'enabled'}.`)
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function createAccount(event) {
    event.preventDefault()
    const body = { ...newAccount }
    for (const key of ['department_id', 'semester_id', 'class_teacher_id', 'hod_id']) {
      body[key] = body[key] ? Number(body[key]) : null
    }
    if (body.role === 'student') {
      delete body.title
      delete body.designation
    } else {
      delete body.student_number
      delete body.semester_id
      delete body.class_teacher_id
      delete body.hod_id
    }
    try {
      await request('/admin/users', { method: 'POST', token, body })
      setShowUserForm(false)
      setNewAccount({ role: 'student', full_name: '', email: '', password: '', student_number: '', title: '', designation: 'class_teacher', department_id: '', semester_id: '', class_teacher_id: '', hod_id: '' })
      setNotice('Campus account created.')
      await refresh()
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function saveStudentAssignment(event) {
    event.preventDefault()
    const body = Object.fromEntries(new FormData(event.currentTarget).entries())
    for (const key of Object.keys(body)) body[key] = body[key] ? Number(body[key]) : null
    try {
      await request(`/admin/students/${editingStudent.student_id}`, { method: 'PATCH', token, body })
      setEditingStudent(null)
      setNotice('Student assignments updated.')
      await refresh()
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function createCatalogItem(event, kind) {
    event.preventDefault()
    const body = kind === 'departments' ? departmentForm : semesterForm
    try {
      await request(`/admin/${kind}`, { method: 'POST', token, body })
      if (kind === 'departments') setDepartmentForm({ name: '', code: '' })
      else setSemesterForm({ name: '', starts_on: '', ends_on: '' })
      setNotice(`${kind === 'departments' ? 'Department' : 'Semester'} created.`)
      await refresh()
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function downloadDocument(item) {
    try {
      const response = await fetch(`${API_URL}/leaves/${item.id}/document`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!response.ok) throw new Error('Document could not be downloaded.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = item.document_name || 'leave-document'
      link.click()
      URL.revokeObjectURL(url)
    } catch (problem) {
      setError(problem.message)
    }
  }

  function exportReport() {
    const rows = [['Student', 'Leave type', 'Start date', 'End date', 'Days', 'Status']]
    visibleLeaves.forEach((item) => rows.push([
      item.student_name || '', item.leave_type, item.start_date, item.end_date, item.days, item.status,
    ]))
    const csv = rows.map((row) => row.map((cell) => {
      const value = String(cell)
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
      return `"${safe.replaceAll('"', '""')}"`
    }).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = 'leave-report.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!token || !user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark"><BookOpen size={23} /></div>
          <p className="eyebrow">CAMPUS PORTAL</p>
          <h1>{registering ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">{registering ? 'Start managing your leave requests in one place.' : 'Sign in to your leave management workspace.'}</p>
          <form onSubmit={submitAuth} className="stack-form">
            {registering && <>
              <label>Full name<input name="full_name" required autoComplete="name" placeholder="e.g. Alex Morgan" /></label>
              <label>Student number<input name="student_number" required placeholder="e.g. STU2026001" /></label>
            </>}
            <label>Email address<input name="email" type="email" required autoComplete="username" placeholder="you@college.edu" /></label>
            <label>Password<input name="password" type="password" required minLength="8" autoComplete={registering ? 'new-password' : 'current-password'} placeholder="At least 8 characters" /></label>
            <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></button>
          </form>
          {error && <p className="alert error">{error}</p>}
          <button className="text-button centered" onClick={() => { setRegistering(!registering); setError('') }}>
            {registering ? 'Already have an account? Sign in' : 'New student? Create an account'}
          </button>
          <p className="auth-foot"><ShieldCheck size={14} /> Secure access for your campus community</p>
        </section>
      </main>
    )
  }

  const roleLabel = user.role === 'admin' ? 'Administrator' : user.role === 'faculty' ? 'Faculty' : 'Student'
  const reviewMode = user.role === 'faculty' && page === 'Reviews'
  const isStudent = user.role === 'student'
  const pendingCount = stats.pending ?? 0
  const navItems = [
    { name: 'Overview', icon: LayoutDashboard },
    ...(isStudent ? [{ name: 'My applications', icon: FileText }] : []),
    ...(user.role === 'faculty' ? [{ name: 'Reviews', icon: ClipboardCheck }, { name: 'Students', icon: Users }] : []),
    ...(user.role === 'admin' ? [{ name: 'Final decisions', icon: ClipboardCheck }, { name: 'People', icon: Users }, { name: 'Catalog', icon: BookOpen }, { name: 'Reports', icon: CalendarDays }] : []),
    { name: 'Profile', icon: Settings },
  ]

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="brand"><div className="brand-mark"><BookOpen size={21} /></div><div><b>Campus</b><span>LEAVE PORTAL</span></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {navItems.map(({ name, icon: Icon }) => (
            <button key={name} className={`nav-link ${page === name ? 'active' : ''}`} onClick={() => { setPage(name); setMobileMenu(false) }}>
              <Icon size={18} /><span>{name}</span>{name === 'Reviews' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><CircleHelp size={17} /><div><strong>Need a hand?</strong><span>Contact your campus office</span></div></div>
          <button className="nav-link" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span>{dark ? 'Light mode' : 'Dark mode'}</span></button>
          <button className="nav-link" onClick={signOut}><LogOut size={18} /><span>Sign out</span></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-only" aria-label="Open menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20} /></button>
          <div className="breadcrumb">Campus portal <span>/</span> <b>{page}</b></div>
          <div className="top-actions">
            <div className="notification-wrap"><button className="icon-button notification-button" aria-label="Notifications" onClick={async () => {
              const next = !notificationsOpen
              setNotificationsOpen(next)
              if (!next || !notifications.some((item) => !item.is_read)) return
              try {
                await request('/notifications/read', { method: 'PATCH', token })
                setNotifications(notifications.map((item) => ({ ...item, is_read: true })))
              } catch (problem) { setError(problem.message) }
            }}><Bell size={19} />{notifications.some((item) => !item.is_read) && <i />}</button>
            {notificationsOpen && <div className="notification-popover"><div className="notification-heading"><b>Notifications</b><button className="text-button" onClick={() => setNotificationsOpen(false)}>Close</button></div>{notifications.length ? notifications.slice(0, 6).map((item) => <div className="notification-item" key={item.id}><b>{item.title}</b><span>{item.message}</span><small>{dateLabel(item.created_at)}</small></div>) : <p className="muted notification-empty">You're all caught up.</p>}</div>}</div>
            <div className="profile-chip"><div className="avatar">{initials(user.full_name)}</div><div className="profile-copy"><b>{user.full_name}</b><span>{roleLabel}</span></div><ChevronDown size={15} /></div>
          </div>
        </header>

        <div className="content">
          {(error || notice) && <div className={`alert ${error ? 'error' : 'success'}`} role="status">{error || notice}<button aria-label="Dismiss" onClick={() => { setError(''); setNotice('') }}><X size={15} /></button></div>}
          <div className="page-heading">
            <div><p className="eyebrow">{now.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1>{page === 'Overview' ? `Good ${now.getHours() < 12 ? 'morning' : 'afternoon'}, ${user.full_name.split(' ')[0]}` : page}</h1><p className="muted">{isStudent ? 'Keep track of your time away from campus.' : 'Your campus leave management at a glance.'}</p></div>
            {isStudent && <button className="button primary" onClick={() => setShowApply(true)}><Plus size={18} /> Apply for leave</button>}
            {user.role === 'admin' && page === 'People' && <button className="button primary" onClick={() => setShowUserForm(true)}><Plus size={18} /> Add account</button>}
            {user.role === 'admin' && page === 'Reports' && <button className="button secondary" onClick={exportReport}><ArrowDownToLine size={17} /> Export CSV</button>}
          </div>

          {page === 'Final decisions' && user.role === 'admin' ? (
            <section className="panel"><div className="panel-heading"><div><h2>Requests awaiting final decision</h2><p>Review applications that have completed faculty approval.</p></div><span className="count-pill">{leaves.filter((item) => item.status === 'pending_admin').length} requests</span></div>
              <LeaveTable rows={leaves.filter((item) => item.status === 'pending_admin')} mode="admin-review" onDecision={decide} onDocument={downloadDocument} />
              {!leaves.some((item) => item.status === 'pending_admin') && <EmptyState title="No final decisions pending" copy="Applications appear here after class teacher and HOD approval." />}
            </section>
          ) : page === 'Profile' ? (
            <section className="panel profile-panel"><div className="panel-heading"><div><h2>Your profile</h2><p>Keep your account details up to date.</p></div></div><form className="profile-form" onSubmit={async (event) => {
              event.preventDefault()
              try {
                const result = await request('/profile', { method: 'PATCH', token, body: { full_name: new FormData(event.currentTarget).get('full_name') } })
                setUser({ ...user, full_name: result.full_name })
                setNotice('Your profile was updated.')
              } catch (problem) { setError(problem.message) }
            }}><label>Full name<input name="full_name" required minLength="2" maxLength="120" defaultValue={user.full_name} /></label><label>Email address<input disabled value={user.email} /></label><label>Role<input disabled value={roleLabel} /></label>{user.student_number && <label>Student number<input disabled value={user.student_number} /></label>}<button className="button primary">Save profile</button></form></section>
          ) : page === 'Students' && user.role === 'faculty' ? (
            <section className="panel"><div className="panel-heading"><div><h2>Assigned students</h2><p>Students connected to your classes and department.</p></div><span className="count-pill">{assignedStudents.length} students</span></div><div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>EMAIL</th><th>DEPARTMENT</th><th>SEMESTER</th></tr></thead><tbody>{assignedStudents.map((student) => <tr key={student.id}><td><div className="person-cell"><div className="avatar small">{initials(student.full_name)}</div><div><b>{student.full_name}</b><span>{student.student_number}</span></div></div></td><td>{student.email}</td><td>{student.department || '—'}</td><td>{student.semester || '—'}</td></tr>)}</tbody></table></div>{!assignedStudents.length && <EmptyState title="No assigned students" copy="Ask your administrator to assign students to your faculty profile." />}</section>
          ) : page === 'Catalog' && user.role === 'admin' ? (
            <div className="catalog-grid">
              <section className="panel"><div className="panel-heading"><div><h2>Departments</h2><p>Maintain campus departments.</p></div><span className="count-pill">{departments.length} departments</span></div>
                <form className="catalog-form" onSubmit={(event) => createCatalogItem(event, 'departments')}><label>Name<input required minLength="2" maxLength="120" value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} placeholder="Department name" /></label><label>Code<input required minLength="2" maxLength="20" value={departmentForm.code} onChange={(event) => setDepartmentForm({ ...departmentForm, code: event.target.value })} placeholder="e.g. ENG" /></label><button className="button primary small-button"><Plus size={15} /> Add department</button></form>
                <div className="catalog-list">{departments.map((item) => <div key={item.id}><b>{item.name}</b><span>{item.code}</span></div>)}</div>
              </section>
              <section className="panel"><div className="panel-heading"><div><h2>Semesters</h2><p>Set the active academic periods.</p></div><span className="count-pill">{semesters.length} semesters</span></div>
                <form className="catalog-form" onSubmit={(event) => createCatalogItem(event, 'semesters')}><label>Semester name<input required minLength="2" maxLength="60" value={semesterForm.name} onChange={(event) => setSemesterForm({ ...semesterForm, name: event.target.value })} placeholder="e.g. Spring 2027" /></label><div className="form-row"><label>Starts<input required type="date" value={semesterForm.starts_on} onChange={(event) => setSemesterForm({ ...semesterForm, starts_on: event.target.value })} /></label><label>Ends<input required type="date" min={semesterForm.starts_on} value={semesterForm.ends_on} onChange={(event) => setSemesterForm({ ...semesterForm, ends_on: event.target.value })} /></label></div><button className="button primary small-button"><Plus size={15} /> Add semester</button></form>
                <div className="catalog-list">{semesters.map((item) => <div key={item.id}><b>{item.name}</b><span>{dateLabel(item.starts_on)} – {dateLabel(item.ends_on)}</span></div>)}</div>
              </section>
            </div>
          ) : page === 'People' && user.role === 'admin' ? (
            <section className="panel">
              <div className="panel-heading"><div><h2>Campus accounts</h2><p>Manage access for students and faculty.</p></div><span className="count-pill">{users.length} accounts</span></div>
              <div className="table-scroll"><table><thead><tr><th>PERSON</th><th>ROLE</th><th>EMAIL</th><th>STATUS</th><th>ASSIGNMENTS</th><th>ACTION</th></tr></thead><tbody>
                {users.map((account) => <tr key={account.id}><td><div className="person-cell"><div className="avatar small">{initials(account.full_name)}</div><div><b>{account.full_name}</b><span>{account.student_number || account.title || 'Campus account'}</span></div></div></td><td className="capitalize">{account.role}</td><td>{account.email}</td><td><span className={`status ${account.is_active ? 'approved' : 'rejected'}`}>{account.is_active ? 'Active' : 'Disabled'}</span></td><td>{account.role === 'student' && <button className="text-button" onClick={() => setEditingStudent(account)}>Assign faculty</button>}</td><td>{account.role === 'admin' ? <span className="muted">Protected</span> : <button className="text-button" onClick={() => toggleUser(account)}>{account.is_active ? 'Disable' : 'Enable'}</button>}</td></tr>)}
              </tbody></table></div>
              {users.length === 0 && <EmptyState title="No campus accounts yet" copy="Registered student and faculty accounts will appear here." />}
            </section>
          ) : page === 'Reports' && user.role === 'admin' ? (
            <><StatsCards stats={stats} role={user.role} /><section className="panel report-panel"><div className="panel-heading"><div><h2>Leave activity report</h2><p>Export the filtered table as a CSV spreadsheet.</p></div><button className="button primary small-button" onClick={exportReport}><ArrowDownToLine size={16} /> Download report</button></div><div className="table-toolbar"><label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applications" /></label><select aria-label="Filter by status" value={filter} onChange={(event) => setFilter(event.target.value)}><option>All status</option>{Object.entries(statusNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></div><LeaveTable rows={visibleLeaves} mode="admin-table" onDocument={downloadDocument} /></section></>
          ) : (
            <>
              <StatsCards stats={stats} role={user.role} />
              <div className="dashboard-grid">
                <section className="panel applications-panel">
                  <div className="panel-heading">
                    <div><h2>{reviewMode ? 'Applications awaiting review' : 'Recent applications'}</h2><p>{reviewMode ? 'Review requests assigned to your stage.' : 'Your latest leave activity.'}</p></div>
                    <button className="text-button" onClick={() => setPage(isStudent ? 'My applications' : user.role === 'faculty' ? 'Reviews' : 'Reports')}>View all <ArrowRight size={15} /></button>
                  </div>
                  <div className="table-toolbar">
                    <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applications" /></label>
                    <select aria-label="Filter by status" value={filter} onChange={(event) => setFilter(event.target.value)}><option>All status</option>{Object.entries(statusNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select>
                  </div>
                  <LeaveTable rows={(page === 'My applications' || reviewMode || user.role === 'admin') ? visibleLeaves : visibleLeaves.slice(0, 5)} mode={reviewMode ? 'review' : user.role === 'admin' ? 'admin-table' : 'table'} onDecision={decide} onDocument={downloadDocument} />
                  {visibleLeaves.length === 0 && <EmptyState title="No applications found" copy={isStudent ? 'When you apply for leave, it will appear here.' : 'No applications match this view right now.'} />}
                </section>
                <section className="panel workflow-panel">
                  <div className="panel-heading"><div><h2>Approval journey</h2><p>Every request moves through these steps.</p></div></div>
                  <div className="workflow">
                    {[['01', 'Class teacher', 'Initial review'], ['02', 'Head of department', 'Department approval'], ['03', 'Final decision', 'Campus administration']].map(([number, title, copy], index) => <div className="workflow-step" key={number}><div className={`step-number ${index === 0 ? 'current' : ''}`}>{number}</div><div><b>{title}</b><span>{copy}</span></div>{index < 2 && <div className="step-line" />}</div>)}
                  </div>
                  <div className="workflow-note"><ShieldCheck size={17} /><span>You'll receive a notification whenever your application status changes.</span></div>
                </section>
              </div>
              {user.role === 'admin' && <StatusChart leaves={leaves} />}
              {page === 'My applications' && <section className="panel history-panel"><div className="panel-heading"><div><h2>Leave history</h2><p>Your full application record.</p></div></div><LeaveTable rows={visibleLeaves} mode="table" onDocument={downloadDocument} />{visibleLeaves.length === 0 && <EmptyState title="No leave history yet" copy="Submitted applications will be listed here." />}</section>}
            </>
          )}
        </div>
        <footer className="footer">© {now.getFullYear()} Campus Leave Portal <span>•</span> Your campus, in sync.</footer>
      </main>

      {showApply && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowApply(false) }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="apply-title">
        <div className="modal-title"><div><p className="eyebrow">NEW REQUEST</p><h2 id="apply-title">Apply for leave</h2><p className="muted">Your request will be sent to your class teacher.</p></div><button className="icon-button" onClick={() => setShowApply(false)} aria-label="Close"><X size={19} /></button></div>
        <form className="stack-form" onSubmit={submitLeave}>
          <label>Leave type<select required value={form.leave_type} onChange={(event) => setForm({ ...form, leave_type: event.target.value })}><option>Medical</option><option>Personal</option><option>Emergency</option><option>Academic</option><option>Other</option></select></label>
          <div className="form-row"><label>Start date<input type="date" required value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} /></label><label>End date<input type="date" required min={form.start_date} value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} /></label></div>
          <div className="days-preview"><CalendarDays size={17} /><span>Leave duration</span><b>{form.start_date && form.end_date && form.end_date >= form.start_date ? Math.floor((new Date(`${form.end_date}T00:00:00`) - new Date(`${form.start_date}T00:00:00`)) / 86400000) + 1 : '—'} days</b></div>
          <label>Reason<textarea required minLength="5" maxLength="1000" rows="4" placeholder="Please share a brief reason for your request…" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
          <label className="file-field">Supporting document <span>Optional · PDF, JPG or PNG · max 5 MB</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setSupportingFile(event.target.files?.[0] || null)} />{supportingFile && <small>{supportingFile.name}</small>}</label>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowApply(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}<ArrowRight size={16} /></button></div>
        </form>
      </section></div>}
      {showUserForm && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><div className="modal-title"><div><p className="eyebrow">CAMPUS ADMIN</p><h2 id="account-title">Create account</h2></div><button className="icon-button" onClick={() => setShowUserForm(false)} aria-label="Close"><X size={19} /></button></div>
        <form className="stack-form" onSubmit={createAccount}>
          <label>Account type<select value={newAccount.role} onChange={(event) => setNewAccount({ ...newAccount, role: event.target.value })}><option value="student">Student</option><option value="faculty">Faculty</option></select></label>
          <label>Full name<input required minLength="2" value={newAccount.full_name} onChange={(event) => setNewAccount({ ...newAccount, full_name: event.target.value })} /></label>
          <label>Email<input type="email" required value={newAccount.email} onChange={(event) => setNewAccount({ ...newAccount, email: event.target.value })} /></label>
          <label>Temporary password<input type="password" autoComplete="new-password" required minLength="8" value={newAccount.password} onChange={(event) => setNewAccount({ ...newAccount, password: event.target.value })} /></label>
          {newAccount.role === 'student' ? <label>Student number<input required value={newAccount.student_number} onChange={(event) => setNewAccount({ ...newAccount, student_number: event.target.value })} /></label> : <>
            <label>Title<input value={newAccount.title} onChange={(event) => setNewAccount({ ...newAccount, title: event.target.value })} placeholder="Faculty member" /></label>
            <label>Approval role<select value={newAccount.designation} onChange={(event) => setNewAccount({ ...newAccount, designation: event.target.value })}><option value="class_teacher">Class teacher</option><option value="hod">HOD</option></select></label>
          </>}
          <label>Department<select value={newAccount.department_id} onChange={(event) => setNewAccount({ ...newAccount, department_id: event.target.value })}><option value="">Unassigned</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {newAccount.role === 'student' && <><label>Semester<select value={newAccount.semester_id} onChange={(event) => setNewAccount({ ...newAccount, semester_id: event.target.value })}><option value="">Unassigned</option>{semesters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="form-row">
            <label>Class teacher<select value={newAccount.class_teacher_id} onChange={(event) => setNewAccount({ ...newAccount, class_teacher_id: event.target.value })}><option value="">Unassigned</option>{users.filter((item) => item.role === 'faculty' && item.designation === 'class_teacher' && item.is_active).map((item) => <option key={item.id} value={item.faculty_id}>{item.full_name}</option>)}</select></label>
            <label>HOD<select value={newAccount.hod_id} onChange={(event) => setNewAccount({ ...newAccount, hod_id: event.target.value })}><option value="">Unassigned</option>{users.filter((item) => item.role === 'faculty' && item.designation === 'hod' && item.is_active).map((item) => <option key={item.id} value={item.faculty_id}>{item.full_name}</option>)}</select></label>
          </div></>}
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowUserForm(false)}>Cancel</button><button className="button primary">Create account</button></div>
        </form></section></div>}
      {editingStudent && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="assignment-title"><div className="modal-title"><div><p className="eyebrow">STUDENT PROFILE</p><h2 id="assignment-title">Faculty &amp; academic assignments</h2><p className="muted">{editingStudent.full_name}</p></div><button className="icon-button" onClick={() => setEditingStudent(null)} aria-label="Close"><X size={19} /></button></div>
        <form className="stack-form" onSubmit={saveStudentAssignment}>
          <label>Department<select name="department_id" defaultValue={editingStudent.department_id || ''}><option value="">Unassigned</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Semester<select name="semester_id" defaultValue={editingStudent.semester_id || ''}><option value="">Unassigned</option>{semesters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Class teacher<select name="class_teacher_id" defaultValue={editingStudent.class_teacher_id || ''}><option value="">Unassigned</option>{users.filter((item) => item.role === 'faculty' && item.designation === 'class_teacher' && item.is_active).map((item) => <option key={item.id} value={item.faculty_id}>{item.full_name}</option>)}</select></label>
          <label>Head of department<select name="hod_id" defaultValue={editingStudent.hod_id || ''}><option value="">Unassigned</option>{users.filter((item) => item.role === 'faculty' && item.designation === 'hod' && item.is_active).map((item) => <option key={item.id} value={item.faculty_id}>{item.full_name}</option>)}</select></label>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditingStudent(null)}>Cancel</button><button className="button primary">Save assignments</button></div>
        </form></section></div>}
    </div>
  )
}

function StatsCards({ stats, role }) {
  const metrics = role === 'admin'
    ? [['Total students', stats.students ?? 0, Users, 'campus enrollment'], ['Faculty members', stats.faculty ?? 0, BookOpen, 'teaching staff'], ['Pending requests', stats.pending ?? 0, Clock3, 'awaiting review'], ['Approved leaves', stats.approved ?? 0, CheckCheck, 'all time']]
    : role === 'faculty'
      ? [['To review', stats.pending ?? 0, Clock3, 'assigned to you'], ['Approved', stats.approved ?? 0, CheckCheck, 'this term'], ['Rejected', stats.rejected ?? 0, X, 'this term'], ['Students', stats.students ?? 0, Users, 'assigned to you']]
      : [['Total requests', stats.total ?? 0, FileText, 'applications made'], ['Awaiting review', stats.pending ?? 0, Clock3, 'in the approval flow'], ['Approved', stats.approved ?? 0, CheckCheck, 'leave requests'], ['Days on leave', stats.days ?? 0, CalendarDays, 'approved days']]
  return <section className="stats-grid">{metrics.map(([label, value, Icon, caption], index) => <article className="stat-card" key={label}><div className={`stat-icon icon-${index}`}><Icon size={18} /></div><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-caption">{caption}</span></article>)}</section>
}

function LeaveTable({ rows, mode, onDecision, onDocument }) {
  const reviewMode = mode === 'review' || mode === 'admin-review'
  const showStudent = reviewMode || mode === 'admin-table'
  return <div className="table-scroll"><table><thead><tr>{showStudent && <th>STUDENT</th>}<th>LEAVE TYPE</th><th>DATES</th><th>DAYS</th><th>STATUS</th><th>{reviewMode ? 'REVIEW' : 'DETAILS'}</th></tr></thead><tbody>
    {rows.map((item) => <tr key={item.id}>
      {showStudent && <td><div className="person-cell"><div className="avatar small">{initials(item.student_name)}</div><div><b>{item.student_name}</b><span>{item.student_number}</span></div></div></td>}
      <td><span className={`type-dot ${item.leave_type.toLowerCase()}`} />{item.leave_type}</td>
      <td><div className="date-range">{dateLabel(item.start_date)}<span>to {dateLabel(item.end_date)}</span></div></td>
      <td>{item.days} {item.days === 1 ? 'day' : 'days'}</td>
      <td><span className={`status ${item.status === 'approved' ? 'approved' : item.status === 'rejected' ? 'rejected' : 'pending'}`}>{statusNames[item.status] || item.status}</span></td>
      <td>{((mode === 'review' && ['pending_class_teacher', 'pending_hod'].includes(item.status)) || (mode === 'admin-review' && item.status === 'pending_admin')) ? <div className="review-actions">{item.document_name && <button className="document-link" onClick={() => onDocument(item)} aria-label="Download supporting document"><ArrowDownToLine size={15} /></button>}<div className="row-actions"><button className="approve-button" aria-label="Approve application" onClick={() => onDecision(item, 'approved')}><Check size={15} /></button><button className="reject-button" aria-label="Reject application" onClick={() => onDecision(item, 'rejected')}><X size={15} /></button></div></div> : item.document_name ? <button className="document-link" onClick={() => onDocument(item)}><ArrowDownToLine size={15} /> Document</button> : <span className="muted">—</span>}</td>
    </tr>)}
  </tbody></table></div>
}

function StatusChart({ leaves }) {
  const categories = [
    ['Class teacher', 'pending_class_teacher', '#e5a84c'],
    ['HOD', 'pending_hod', '#9279df'],
    ['Final review', 'pending_admin', '#4196da'],
    ['Approved', 'approved', '#45a382'],
    ['Rejected', 'rejected', '#ed7370'],
  ].map(([label, status, color]) => ({
    label,
    color,
    count: leaves.filter((item) => item.status === status).length,
  }))
  const max = Math.max(1, ...categories.map((item) => item.count))
  return <section className="panel status-chart"><div className="panel-heading"><div><h2>Request status</h2><p>Applications grouped by their current decision stage.</p></div></div><div className="chart-bars">{categories.map((item) => <div className="chart-row" key={item.label}><span>{item.label}</span><div className="chart-track"><i style={{ width: `${Math.max(item.count ? 8 : 0, (item.count / max) * 100)}%`, background: item.color }} /></div><b>{item.count}</b></div>)}</div></section>
}

function EmptyState({ title, copy }) {
  return <div className="empty-state"><div><FileText size={22} /></div><b>{title}</b><span>{copy}</span></div>
}

export default App
