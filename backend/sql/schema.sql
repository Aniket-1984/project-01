CREATE DATABASE IF NOT EXISTS campus_leave
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE campus_leave;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  code VARCHAR(20) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS semesters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_semester_dates CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student', 'faculty', 'admin') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS faculty (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  title VARCHAR(120) NOT NULL DEFAULT 'Faculty member',
  designation ENUM('class_teacher', 'hod') NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  CONSTRAINT fk_faculty_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_faculty_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  student_number VARCHAR(40) NOT NULL UNIQUE,
  department_id BIGINT UNSIGNED NULL,
  semester_id BIGINT UNSIGNED NULL,
  class_teacher_id BIGINT UNSIGNED NULL,
  hod_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_students_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_students_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE SET NULL,
  CONSTRAINT fk_students_teacher FOREIGN KEY (class_teacher_id) REFERENCES faculty(id) ON DELETE SET NULL,
  CONSTRAINT fk_students_hod FOREIGN KEY (hod_id) REFERENCES faculty(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS leave_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  leave_type ENUM('Medical', 'Personal', 'Emergency', 'Academic', 'Other') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days SMALLINT UNSIGNED NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('pending_class_teacher', 'pending_hod', 'pending_admin', 'approved', 'rejected') NOT NULL DEFAULT 'pending_class_teacher',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_leave_days CHECK (days > 0),
  CONSTRAINT fk_leave_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  INDEX idx_leave_status_created (status, created_at),
  INDEX idx_leave_student_created (student_id, created_at)
);

CREATE TABLE IF NOT EXISTS leave_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  leave_application_id BIGINT UNSIGNED NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(100) NOT NULL UNIQUE,
  mime_type ENUM('application/pdf', 'image/jpeg', 'image/png') NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_leave FOREIGN KEY (leave_application_id) REFERENCES leave_applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approval_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  leave_application_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  stage ENUM('submitted', 'class_teacher', 'hod', 'admin') NOT NULL,
  decision ENUM('submitted', 'approved', 'rejected') NOT NULL,
  remarks VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_leave FOREIGN KEY (leave_application_id) REFERENCES leave_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_history_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_history_leave_created (leave_application_id, created_at)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(500) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notification_user_created (user_id, created_at)
);
