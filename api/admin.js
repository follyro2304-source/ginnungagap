import { timingSafeEqual, createHash } from 'node:crypto';
import { redis, json, clientIp, underLimit, FEEDBACK_KEY } from './_lib/redis.js';

// The password lives in the ADMIN_PASSWORD environment variable, never in the repository.
function passwordOk(given) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof given !== 'string') return false;
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  try {
    if (!(await underLimit(`rl:admin:${clientIp(request)}`, 10, 900))) {
      return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    }
    if (!passwordOk(body?.password)) return json({ error: 'Wrong password.' }, 401);

    const r = redis();
    let raw = await r.lrange(FEEDBACK_KEY, 0, -1);
    if (typeof body.remove === 'string') {
      const hit = raw.find((x) => JSON.parse(x).id === body.remove);
      if (hit) { await r.lrem(FEEDBACK_KEY, 1, hit); raw = raw.filter((x) => x !== hit); }
    }
    return json({ items: raw.map((x) => JSON.parse(x)) });
  } catch (err) {
    console.error('admin read failed', err);
    return json({ error: 'Could not load feedback.' }, 500);
  }
}
