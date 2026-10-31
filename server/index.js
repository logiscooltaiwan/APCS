"use strict";
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const store = require('./store');

const PORT = process.env.PORT || 4173;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'teacher123';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const SESSION_MS = 12 * 3600 * 1000;

const sessions = new Map(); // token -> expiry timestamp

function newToken(){ return crypto.randomBytes(24).toString('hex'); }
function isAdmin(req){
  const t = req.cookies && req.cookies.admin_token;
  if(!t) return false;
  const exp = sessions.get(t);
  if(!exp || exp < Date.now()){ sessions.delete(t); return false; }
  return true;
}
function requireAdmin(req, res, next){
  if(!isAdmin(req)) return res.status(403).json({ code:'invalid_argument', error:'admin required' });
  next();
}
function stripId(body){ const { id, ...rest } = body || {}; return rest; }

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'app', 'local.html')));
app.use(express.static(path.join(__dirname, '..', 'app')));

/* ---------- auth ---------- */
app.get('/api/me', (req, res) => res.json({ isAdmin: isAdmin(req), aiEnabled: !!ANTHROPIC_API_KEY }));

app.post('/api/admin/login', (req, res) => {
  if((req.body && req.body.password) !== ADMIN_PASSWORD) return res.status(403).json({ code:'invalid_argument', error:'wrong password' });
  const token = newToken();
  sessions.set(token, Date.now() + SESSION_MS);
  res.cookie('admin_token', token, { httpOnly:true, sameSite:'lax', maxAge: SESSION_MS });
  res.json({ ok:true });
});
app.post('/api/admin/logout', (req, res) => {
  const t = req.cookies && req.cookies.admin_token;
  if(t) sessions.delete(t);
  res.clearCookie('admin_token');
  res.json({ ok:true });
});

/* ---------- questions: public read, admin write ---------- */
app.get('/api/questions', (req, res) => res.json(store.list('questions')));
app.get('/api/questions/:id', (req, res) => res.json(store.find('questions', req.params.id)));
app.put('/api/questions/:id', requireAdmin, (req, res) => res.json(store.upsert('questions', req.params.id, stripId(req.body))));
app.patch('/api/questions/:id', requireAdmin, (req, res) => {
  const d = store.patch('questions', req.params.id, stripId(req.body));
  if(!d) return res.status(404).json({ code:'invalid_argument' });
  res.json(d);
});
app.delete('/api/questions/:id', requireAdmin, (req, res) => { store.remove('questions', req.params.id); res.status(204).end(); });

/* ---------- students: admin gets the full roster; anyone may look up by exact name (needed for login) ---------- */
app.get('/api/students', (req, res) => {
  if(isAdmin(req)) return res.json(store.list('students'));
  const name = req.query.name;
  if(!name) return res.json([]);
  res.json(store.list('students').filter(s => s.name === name));
});
app.put('/api/students/:id', requireAdmin, (req, res) => res.json(store.upsert('students', req.params.id, stripId(req.body))));
app.patch('/api/students/:id', requireAdmin, (req, res) => {
  const d = store.patch('students', req.params.id, stripId(req.body));
  if(!d) return res.status(404).json({ code:'invalid_argument' });
  res.json(d);
});
app.delete('/api/students/:id', requireAdmin, (req, res) => { store.remove('students', req.params.id); res.status(204).end(); });

/* ---------- examPapers: admin manages freely; a student may only fetch papers whose studentIds include them ---------- */
app.get('/api/examPapers', (req, res) => {
  if(isAdmin(req)) return res.json(store.list('examPapers'));
  const sid = req.query.studentIds;
  if(!sid) return res.json([]);
  res.json(store.list('examPapers').filter(p => Array.isArray(p.studentIds) && p.studentIds.includes(sid)));
});
app.put('/api/examPapers/:id', requireAdmin, (req, res) => res.json(store.upsert('examPapers', req.params.id, stripId(req.body))));
app.patch('/api/examPapers/:id', requireAdmin, (req, res) => {
  const d = store.patch('examPapers', req.params.id, stripId(req.body));
  if(!d) return res.status(404).json({ code:'invalid_argument' });
  res.json(d);
});
app.delete('/api/examPapers/:id', requireAdmin, (req, res) => { store.remove('examPapers', req.params.id); res.status(204).end(); });

/* ---------- results: admin sees all; a student sees only their own (by studentId); writing your own run is open, same trust model as the original practice system ---------- */
app.get('/api/results', (req, res) => {
  if(isAdmin(req)) return res.json(store.list('results'));
  const studentId = req.query.studentId;
  if(!studentId) return res.json([]);
  res.json(store.list('results').filter(r => r.studentId === studentId));
});
app.get('/api/results/:id', requireAdmin, (req, res) => res.json(store.find('results', req.params.id)));
app.put('/api/results/:id', (req, res) => res.json(store.upsert('results', req.params.id, stripId(req.body))));
app.patch('/api/results/:id', (req, res) => {
  const d = store.patch('results', req.params.id, stripId(req.body));
  if(!d) return res.status(404).json({ code:'invalid_argument' });
  res.json(d);
});
app.delete('/api/results/:id', requireAdmin, (req, res) => { store.remove('results', req.params.id); res.status(204).end(); });

/* ---------- config/exams: public read, admin write ---------- */
app.get('/api/config', (req, res) => res.json(store.getConfig()));
app.put('/api/config', requireAdmin, (req, res) => res.json(store.setConfig(req.body || {})));

/* ---------- optional AI grading of FRQ answers (needs ANTHROPIC_API_KEY) ---------- */
app.post('/api/ai/grade', async (req, res) => {
  if(!ANTHROPIC_API_KEY) return res.status(503).json({ code:'capability_disabled' });
  try{
    const prompt = (req.body && req.body.prompt) || '';
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-api-key':ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 4096, messages:[{ role:'user', content: prompt }] })
    });
    if(!resp.ok) return res.status(502).json({ code:'rate_limited' });
    const data = await resp.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    res.json({ result: parsed });
  }catch(e){
    res.status(500).json({ code:'rate_limited', error:String(e && e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`AP CS Mock Exam server: http://localhost:${PORT}`);
  console.log(`Examiner admin password: ${ADMIN_PASSWORD}${process.env.ADMIN_PASSWORD?'':' (default — set ADMIN_PASSWORD to change)'}`);
  console.log(`AI grading: ${ANTHROPIC_API_KEY ? 'enabled ('+ANTHROPIC_MODEL+')' : 'disabled (set ANTHROPIC_API_KEY to enable; manual grading in 考官後台 still works)'}`);
});
