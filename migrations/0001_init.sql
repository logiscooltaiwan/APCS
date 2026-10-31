CREATE TABLE questions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT, data TEXT NOT NULL);
CREATE TABLE results (id TEXT PRIMARY KEY, student_id TEXT, data TEXT NOT NULL);
CREATE TABLE exam_papers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE config (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE INDEX idx_students_name ON students(name);
CREATE INDEX idx_results_student_id ON results(student_id);
