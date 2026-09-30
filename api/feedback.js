import { redis, json, clientIp, underLimit, FEEDBACK_KEY } from './_lib/redis.js';

const MAX_LEN = 2000;
const MAX_STORED = 2000;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return json({ error: 'Please write something first.' }, 400);
  if (message.length > MAX_LEN) return json({ error: `Please keep it under ${MAX_LEN} characters.` }, 400);
  const page = typeof body?.page === 'string' ? body.page.slice(0, 40) : '';

  try {
    if (!(await underLimit(`rl:fb:${clientIp(request)}`, 8, 3600))) {
      return json({ error: 'Thanks! You have sent a lot of feedback already. Please try again later.' }, 429);
    }
    const entry = { id: crypto.randomUUID(), message, page, at: new Date().toISOString() };
    const r = redis();
    await r.lpush(FEEDBACK_KEY, JSON.stringify(entry));
    await r.ltrim(FEEDBACK_KEY, 0, MAX_STORED - 1);
    return json({ ok: true });
  } catch (err) {
    console.error('feedback store failed', err);
    return json({ error: 'Feedback could not be saved right now.' }, 500);
  }
}
