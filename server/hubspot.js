import 'dotenv/config';
import Bottleneck from 'bottleneck';
import { getCached, setCached } from './cache.js';

const BASE = 'https://api.hubapi.com';
const TOKEN = process.env.HS_TOKEN;

if (!TOKEN) {
  console.warn('[hubspot] WARNING: HS_TOKEN no está definido en .env — las llamadas reales fallarán.');
}

// Throttle: mantenemos la salida MUY por debajo del límite de HubSpot
// (Starter: 100 req / 10s). minTime 220ms ≈ 4.5 req/s, maxConcurrent 2.
const limiter = new Bottleneck({ maxConcurrent: 2, minTime: 220 });

export const stats = {
  realCalls: 0,
  cacheHits: 0,
  rateLimited: 0,
  errors: 0,
  lastCallAt: null,
  startedAt: new Date().toISOString(),
};

async function rawFetch(path, { method = 'GET', body } = {}) {
  return limiter.schedule(async () => {
    let attempt = 0;
    // backoff exponencial ante 429
    while (true) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      stats.realCalls += 1;
      stats.lastCallAt = new Date().toISOString();

      if (res.status === 429 && attempt < 3) {
        stats.rateLimited += 1;
        const retryAfter = Number(res.headers.get('Retry-After')) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        attempt += 1;
        continue;
      }

      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        stats.errors += 1;
        const err = new Error(`HubSpot ${res.status}: ${json.message || text}`);
        err.status = res.status;
        err.body = json;
        throw err;
      }
      return json;
    }
  });
}

export async function hsGet(path, { ttl = 300, fresh = false } = {}) {
  const key = `GET ${path}`;
  if (!fresh) {
    const cached = getCached(key, ttl);
    if (cached) {
      stats.cacheHits += 1;
      return cached;
    }
  }
  const data = await rawFetch(path);
  setCached(key, data);
  return data;
}

export async function hsPost(path, body, { ttl = 300, fresh = false } = {}) {
  // Solo para endpoints de lectura (batch/read, search). Cacheamos por body.
  const key = `POST ${path} ${JSON.stringify(body)}`;
  if (!fresh) {
    const cached = getCached(key, ttl);
    if (cached) {
      stats.cacheHits += 1;
      return cached;
    }
  }
  const data = await rawFetch(path, { method: 'POST', body });
  setCached(key, data);
  return data;
}
