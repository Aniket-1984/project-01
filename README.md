# Campus Leave Portal

A responsive student leave management application with a React/Tailwind client, an Express API, and a MySQL database. Students submit and track leave; assigned faculty review requests in order; administrators manage access and monitor campus-wide activity.

## Features

- Student self-registration, sign-in, leave application and history.
- Editable profile details and role-specific dashboards for students, faculty, and administrators.
- Inclusive calendar-day calculation, date validation, and optional PDF/JPEG/PNG uploads (maximum 5 MB).
- Class teacher → HOD → administrator approval, with remarks, status history, and notifications.
- Faculty queues limited to the students and approval stage assigned to them.
- Admin dashboard, account enable/disable, account creation, and CSV leave reports.
- Final admin approvals, student/faculty assignments, and department/semester setup.
- Department and semester tables and protected management endpoints.
- JWT authentication, bcrypt password hashes, role checks, validation, parameterized SQL, request throttling, and security headers.
- Responsive blue-and-white dashboard, status filters, search, notifications, and dark mode.

## Requirements

- Node.js 20.19+ and npm.
- MySQL 8.0.16+ (for enforced `CHECK` constraints).

## Setup

1. Create a local database and tables:

   ```sh
   mysql -u root -p < backend/sql/schema.sql
   ```

2. Copy `.env.example` to `.env`, set the MySQL credentials, and replace `JWT_SECRET` with a randomly generated secret (at least 32 characters). Example:

   ```sh
   cp .env.example .env
   ```

3. Optional: load demonstration accounts and sample leave requests:

   ```sh
   mysql -u root -p < backend/sql/sample-data.sql
   ```

   All sample accounts use `CampusDemo!2026`:

   | Role | Email |
   | --- | --- |
   | Admin | `admin@campus.test` |
   | Class teacher | `teacher@campus.test` |
   | HOD | `hod@campus.test` |
   | Student | `student@campus.test` |

4. Install and start the API and frontend in separate terminals:

   ```sh
   cd backend && npm install && npm run dev
   ```

   ```sh
   cd frontend && npm install && npm run dev
   ```

   The API runs on `http://localhost:4000`; Vite serves the frontend on `http://localhost:5173`. The API reads database and port settings from the root `.env`. Set `VITE_API_URL` in `frontend/.env.local` only when the API is hosted at a different URL.

5. Check the API and database connection at `http://localhost:4000/api/health`.

## Database and assignments

The schema creates users, student and faculty profiles, departments, semesters, leave applications, uploaded-document metadata, approval history, and notifications. Upload contents are stored in the ignored `backend/uploads/` directory; they are only returned through an authenticated, authorized download route.

Student and faculty accounts can be created by an administrator or through student registration. To assign a class teacher and HOD to each student, set the `students.class_teacher_id` and `students.hod_id` fields to the corresponding rows in `faculty`. Set department and semester IDs on the student and faculty rows as appropriate. These assignments determine which faculty may review each stage.

Students must have an active class teacher and HOD before they can submit a leave request. The admin interface supports these assignments and prevents clearing them while a request depends on that review stage.

The admin API provides account, department, and semester listing/creation operations; the SQL tables can also be populated or maintained with the institution's existing provisioning process. Do not expose MySQL to the public internet.

## API overview

All routes are prefixed with `/api`. Protected routes require a bearer token in the `Authorization` header.

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/health` | Public, checks MySQL |
| `POST` | `/auth/register`, `/auth/login` | Public |
| `GET` | `/auth/me`, `/profile` | Signed-in user |
| `PATCH` | `/profile` | Signed-in user |
| `GET` | `/dashboard`, `/leaves`, `/notifications` | Role-scoped |
| `GET` | `/faculty/students` | Faculty |
| `POST` | `/leaves` | Student |
| `PATCH` | `/leaves/:id/decision` | Assigned faculty or admin at final stage |
| `GET` | `/leaves/:id/document` | Authorized student, current reviewer, or admin |
| `PATCH` | `/notifications/read` | Signed-in user |
| `GET`, `POST` | `/admin/users`, `/admin/departments`, `/admin/semesters` | Admin |
| `PATCH` | `/admin/users/:id` | Admin |
| `PATCH` | `/admin/students/:id` | Admin |

## Validation

```sh
cd backend && npm test
cd frontend && npm run lint && npm run build
```

The backend tests cover date-duration edge cases and approval-stage authorization. The server requires a running MySQL instance and the schema above to exercise authenticated API flows.
