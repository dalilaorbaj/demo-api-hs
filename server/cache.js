import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const CACHE_DIR = join(process.cwd(), '.cache');
mkdirSync(CACHE_DIR, { recursive: true });

function keyToFile(key) {
  const hash = createHash('sha1').update(key).digest('hex');
  return join(CACHE_DIR, `${hash}.json`);
}

export function getCached(key, ttlSeconds) {
  const file = keyToFile(key);
  if (!existsSync(file)) return null;
  try {
    const { ts, data } = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - ts > ttlSeconds * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export function setCached(key, data) {
  try {
    writeFileSync(keyToFile(key), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // cache write failures should never break a request
  }
}
