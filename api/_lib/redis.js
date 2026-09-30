import { Redis } from '@upstash/redis';

// The Upstash integration on the Vercel Marketplace injects either the
// UPSTASH_REDIS_REST_* or the KV_REST_API_* pair, depending on how it was set up.
let client = null;
export function redis() {
  if (!client) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
      automaticDeserialization: false,
    });
  }
  return client;
}

export const FEEDBACK_KEY = 'feedback';

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

// Fixed-window counter: returns true while the caller is under `limit` hits per `windowSec`.
export async function underLimit(key, limit, windowSec) {
  const r = redis();
  const n = Number(await r.incr(key));
  if (n === 1) await r.expire(key, windowSec);
  return n <= limit;
}
