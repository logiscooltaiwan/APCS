import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(__dirname, '..', 'migrations', '0002_seed_data.sql');

const esc = (s) => s.replace(/'/g, "''");
const sqlStr = (v) => (v == null ? 'NULL' : `'${esc(String(v))}'`);

function rowsFor(table, extraCols, docs) {
  return docs.map((doc) => {
    const json = esc(JSON.stringify(doc));
    const extraNames = extraCols.map((c) => c.name);
    const extraVals = extraCols.map((c) => sqlStr(doc[c.field]));
    const cols = ['id', ...extraNames, 'data'].join(', ');
    const vals = [sqlStr(doc.id), ...extraVals, `'${json}'`].join(', ');
    return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
  });
}

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const questions = read('questions.json');
const students = read('students.json');
const results = read('results.json');
const examPapers = read('examPapers.json');
const config = read('config.json');

const lines = [
  ...rowsFor('questions', [], questions),
  ...rowsFor('students', [{ name: 'name', field: 'name' }], students),
  ...rowsFor('results', [{ name: 'student_id', field: 'studentId' }], results),
  ...rowsFor('exam_papers', [], examPapers),
  `INSERT INTO config (id, data) VALUES ('exams', '${esc(JSON.stringify(config))}');`,
];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log(`Wrote ${lines.length} INSERT statements to ${OUT}`);
