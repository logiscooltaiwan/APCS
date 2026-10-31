const TABLES = { questions: 'questions', students: 'students', results: 'results', examPapers: 'exam_papers' };
const DEFAULT_CONFIG = { CSA: { mcqMin: 90, frqMin: 90 }, CSP: { mcqMin: 90 } };

export function createStore(db) {
  async function list(name, filter) {
    const table = TABLES[name];
    let sql = `SELECT data FROM ${table}`;
    const binds = [];
    if (name === 'students' && filter?.name) { sql += ` WHERE name = ?`; binds.push(filter.name); }
    else if (name === 'results' && filter?.studentId) { sql += ` WHERE student_id = ?`; binds.push(filter.studentId); }
    else if (name === 'examPapers' && filter?.studentIds) {
      sql += ` WHERE EXISTS (SELECT 1 FROM json_each(data, '$.studentIds') WHERE value = ?)`;
      binds.push(filter.studentIds);
    }
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results.map((r) => JSON.parse(r.data));
  }

  async function find(name, id) {
    const row = await db.prepare(`SELECT data FROM ${TABLES[name]} WHERE id = ?`).bind(id).first();
    return row ? JSON.parse(row.data) : null;
  }

  async function upsert(name, id, data) {
    const doc = { ...data, id };
    const json = JSON.stringify(doc);
    if (name === 'students') {
      await db.prepare(`INSERT INTO students (id, name, data) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data`)
        .bind(id, doc.name ?? null, json).run();
    } else if (name === 'results') {
      await db.prepare(`INSERT INTO results (id, student_id, data) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET student_id = excluded.student_id, data = excluded.data`)
        .bind(id, doc.studentId ?? null, json).run();
    } else {
      await db.prepare(`INSERT INTO ${TABLES[name]} (id, data) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
        .bind(id, json).run();
    }
    return doc;
  }

  async function patch(name, id, partial) {
    const existing = await find(name, id);
    if (!existing) return null;
    return upsert(name, id, { ...existing, ...partial, id }); // shallow merge, same as server/store.js
  }

  async function remove(name, id) {
    await db.prepare(`DELETE FROM ${TABLES[name]} WHERE id = ?`).bind(id).run();
    return true;
  }

  async function getConfig() {
    const row = await db.prepare(`SELECT data FROM config WHERE id = 'exams'`).first();
    return row ? JSON.parse(row.data) : DEFAULT_CONFIG;
  }
  async function setConfig(cfg) {
    const merged = { CSA: { ...DEFAULT_CONFIG.CSA, ...(cfg.CSA || {}) }, CSP: { ...DEFAULT_CONFIG.CSP, ...(cfg.CSP || {}) } };
    await db.prepare(`INSERT INTO config (id, data) VALUES ('exams', ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data`).bind(JSON.stringify(merged)).run();
    return merged;
  }

  return { list, find, upsert, patch, remove, getConfig, setConfig };
}
