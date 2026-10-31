import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createStore } from './store.js';
import { makeAdminToken, verifyAdminToken, SESSION_MS } from './auth.js';

const app = new Hono();
const api = new Hono();

api.use('*', async (c, next) => { c.set('store', createStore(c.env.DB)); await next(); });

const stripId = (body) => { if (!body || typeof body !== 'object') return {}; const { id, ...rest } = body; return rest; };
async function isAdmin(c) {
  const token = getCookie(c, 'admin_token');
  return token ? verifyAdminToken(token, c.env.COOKIE_SECRET) : false;
}
async function requireAdmin(c, next) {
  if (!(await isAdmin(c))) return c.json({ code: 'invalid_argument', error: 'admin required' }, 403);
  await next();
}

api.get('/me', async (c) => c.json({ isAdmin: await isAdmin(c), aiEnabled: !!c.env.ANTHROPIC_API_KEY }));

api.post('/admin/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.password !== (c.env.ADMIN_PASSWORD || 'teacher123')) return c.json({ code: 'invalid_argument', error: 'wrong password' }, 403);
  const token = await makeAdminToken(c.env.COOKIE_SECRET);
  setCookie(c, 'admin_token', token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MS / 1000 });
  return c.json({ ok: true });
});
api.post('/admin/logout', async (c) => { deleteCookie(c, 'admin_token', { path: '/' }); return c.json({ ok: true }); });

api.get('/questions', async (c) => c.json(await c.get('store').list('questions')));
api.get('/questions/:id', async (c) => c.json(await c.get('store').find('questions', c.req.param('id'))));
api.put('/questions/:id', requireAdmin, async (c) => c.json(await c.get('store').upsert('questions', c.req.param('id'), stripId(await c.req.json().catch(() => ({}))))));
api.patch('/questions/:id', requireAdmin, async (c) => {
  const d = await c.get('store').patch('questions', c.req.param('id'), stripId(await c.req.json().catch(() => ({}))));
  return d ? c.json(d) : c.json({ code: 'invalid_argument' }, 404);
});
api.delete('/questions/:id', requireAdmin, async (c) => { await c.get('store').remove('questions', c.req.param('id')); return c.body(null, 204); });

api.get('/students', async (c) => {
  const store = c.get('store');
  if (await isAdmin(c)) return c.json(await store.list('students'));
  const name = c.req.query('name');
  return c.json(name ? await store.list('students', { name }) : []);
});
api.put('/students/:id', requireAdmin, async (c) => c.json(await c.get('store').upsert('students', c.req.param('id'), stripId(await c.req.json().catch(() => ({}))))));
api.patch('/students/:id', requireAdmin, async (c) => {
  const d = await c.get('store').patch('students', c.req.param('id'), stripId(await c.req.json().catch(() => ({}))));
  return d ? c.json(d) : c.json({ code: 'invalid_argument' }, 404);
});
api.delete('/students/:id', requireAdmin, async (c) => { await c.get('store').remove('students', c.req.param('id')); return c.body(null, 204); });

api.get('/examPapers', async (c) => {
  const store = c.get('store');
  if (await isAdmin(c)) return c.json(await store.list('examPapers'));
  const sid = c.req.query('studentIds');
  return c.json(sid ? await store.list('examPapers', { studentIds: sid }) : []);
});
api.put('/examPapers/:id', requireAdmin, async (c) => c.json(await c.get('store').upsert('examPapers', c.req.param('id'), stripId(await c.req.json().catch(() => ({}))))));
api.patch('/examPapers/:id', requireAdmin, async (c) => {
  const d = await c.get('store').patch('examPapers', c.req.param('id'), stripId(await c.req.json().catch(() => ({}))));
  return d ? c.json(d) : c.json({ code: 'invalid_argument' }, 404);
});
api.delete('/examPapers/:id', requireAdmin, async (c) => { await c.get('store').remove('examPapers', c.req.param('id')); return c.body(null, 204); });

api.get('/results', async (c) => {
  const store = c.get('store');
  if (await isAdmin(c)) return c.json(await store.list('results'));
  const studentId = c.req.query('studentId');
  return c.json(studentId ? await store.list('results', { studentId }) : []);
});
api.get('/results/:id', requireAdmin, async (c) => c.json(await c.get('store').find('results', c.req.param('id'))));
api.put('/results/:id', async (c) => c.json(await c.get('store').upsert('results', c.req.param('id'), stripId(await c.req.json().catch(() => ({})))))); // open, matches original
api.patch('/results/:id', async (c) => { // open, matches original
  const d = await c.get('store').patch('results', c.req.param('id'), stripId(await c.req.json().catch(() => ({}))));
  return d ? c.json(d) : c.json({ code: 'invalid_argument' }, 404);
});
api.delete('/results/:id', requireAdmin, async (c) => { await c.get('store').remove('results', c.req.param('id')); return c.body(null, 204); });

api.get('/config', async (c) => c.json(await c.get('store').getConfig()));
api.put('/config', requireAdmin, async (c) => c.json(await c.get('store').setConfig(await c.req.json().catch(() => ({})))));

api.post('/ai/grade', async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ code: 'capability_disabled' }, 503);
  try {
    const body = await c.req.json().catch(() => ({}));
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: c.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 4096, messages: [{ role: 'user', content: body.prompt || '' }] }),
    });
    if (!resp.ok) return c.json({ code: 'rate_limited' }, 502);
    const data = await resp.json();
    const text = (data.content || []).map((cc) => cc.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    return c.json({ result: JSON.parse(match ? match[0] : text) });
  } catch (e) {
    return c.json({ code: 'rate_limited', error: String((e && e.message) || e) }, 500);
  }
});

app.route('/api', api);
app.get('/', (c) => c.env.ASSETS.fetch(new URL('/local.html', c.req.url)));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw)); // safety net; shouldn't normally be hit given run_worker_first scoping

export default app;
