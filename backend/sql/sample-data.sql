USE campus_leave;

INSERT IGNORE INTO departments (id, name, code) VALUES
  (1, 'Computer Science', 'CS'),
  (2, 'Business Administration', 'BUS');

INSERT IGNORE INTO semesters (id, name, starts_on, ends_on) VALUES
  (1, 'Fall 2026', '2026-08-24', '2026-12-18');

-- Demo password for each account: CampusDemo!2026 (bcrypt hash, 12 rounds).
INSERT IGNORE INTO users (id, full_name, email, password_hash, role) VALUES
  (1, 'Campus Administrator', 'admin@campus.test', '$2b$12$pQjo6WR4iI6P3D5CngWOA.G1jZh87EaBwdUz9mj5ZgvRqap2xQuHO', 'admin'),
  (2, 'Jordan Lee', 'teacher@campus.test', '$2b$12$pQjo6WR4iI6P3D5CngWOA.G1jZh87EaBwdUz9mj5ZgvRqap2xQuHO', 'faculty'),
  (3, 'Morgan Chen', 'hod@campus.test', '$2b$12$pQjo6WR4iI6P3D5CngWOA.G1jZh87EaBwdUz9mj5ZgvRqap2xQuHO', 'faculty'),
  (4, 'Taylor Reed', 'student@campus.test', '$2b$12$pQjo6WR4iI6P3D5CngWOA.G1jZh87EaBwdUz9mj5ZgvRqap2xQuHO', 'student');

INSERT IGNORE INTO faculty (id, user_id, title, designation, department_id) VALUES
  (1, 2, 'Class Teacher', 'class_teacher', 1),
  (2, 3, 'Head of Department', 'hod', 1);

INSERT IGNORE INTO students (id, user_id, student_number, department_id, semester_id, class_teacher_id, hod_id) VALUES
  (1, 4, 'CS2026001', 1, 1, 1, 2);

INSERT IGNORE INTO leave_applications (id, student_id, leave_type, start_date, end_date, days, reason, status) VALUES
  (1, 1, 'Medical', '2026-11-27', '2026-11-28', 2, 'Medical appointment and recovery.', 'pending_class_teacher'),
  (2, 1, 'Personal', '2026-10-12', '2026-10-12', 1, 'Family commitment.', 'approved'),
  (3, 1, 'Academic', '2026-09-04', '2026-09-05', 2, 'Academic conference attendance.', 'rejected');

INSERT IGNORE INTO approval_history (leave_application_id, actor_user_id, stage, decision, remarks) VALUES
  (1, 4, 'submitted', 'submitted', 'Application submitted by student'),
  (2, 4, 'submitted', 'submitted', 'Application submitted by student'),
  (2, 2, 'class_teacher', 'approved', 'Approved'),
  (2, 3, 'hod', 'approved', 'Approved'),
  (2, 1, 'admin', 'approved', 'Approved'),
  (3, 4, 'submitted', 'submitted', 'Application submitted by student'),
  (3, 2, 'class_teacher', 'rejected', 'Insufficient supporting details.');

INSERT IGNORE INTO notifications (id, user_id, title, message, is_read) VALUES
  (1, 4, 'Leave application update', 'Your personal leave request was approved.', FALSE),
  (2, 2, 'Leave application for review', 'Taylor Reed submitted a leave request.', FALSE);
