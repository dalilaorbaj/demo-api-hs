import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hsGet, hsPost, stats } from './hubspot.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ---- Propiedades que pedimos en cada listado (claves útiles) ----
const CONTACT_PROPS = [
  'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle',
  'lifecyclestage', 'hs_lead_status', 'createdate', 'lastmodifieddate',
  'hubspot_owner_id',
];
const DEAL_PROPS = [
  'dealname', 'amount', 'dealstage', 'pipeline', 'closedate',
  'createdate', 'hs_lastmodifieddate', 'hubspot_owner_id',
];
const TASK_PROPS = [
  'hs_task_subject', 'hs_task_status', 'hs_task_priority', 'hs_task_type',
  'hs_timestamp', 'hubspot_owner_id', 'hs_createdate',
];
const ACTIVITY_DEFS = [
  { type: 'calls', props: ['hs_call_title', 'hs_call_body', 'hs_call_direction', 'hs_call_duration', 'hs_timestamp', 'hubspot_owner_id'], title: 'hs_call_title', body: 'hs_call_body' },
  { type: 'emails', props: ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_timestamp', 'hubspot_owner_id'], title: 'hs_email_subject', body: 'hs_email_text' },
  { type: 'meetings', props: ['hs_meeting_title', 'hs_meeting_body', 'hs_meeting_start_time', 'hs_timestamp', 'hubspot_owner_id'], title: 'hs_meeting_title', body: 'hs_meeting_body' },
  { type: 'notes', props: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'], title: null, body: 'hs_note_body' },
];

const isFresh = (req) => req.query.fresh === '1';

function listPath(object, props, { limit = 100, after, history } = {}) {
  const p = encodeURIComponent(props.join(','));
  let path = `/crm/v3/objects/${object}?limit=${limit}&properties=${p}&archived=false`;
  if (history) path += `&propertiesWithHistory=${encodeURIComponent(history)}`;
  if (after) path += `&after=${encodeURIComponent(after)}`;
  return path;
}

// Sigue el cursor `paging.next.after` y agrega todas las páginas (hasta maxPages).
// Cada página se cachea por su URL en hsGet, así que repetir es barato.
async function listAll(object, props, { fresh, history, limit = 100, maxPages = 10 } = {}) {
  const results = [];
  let after;
  for (let i = 0; i < maxPages; i++) {
    const data = await hsGet(listPath(object, props, { limit, after, history }), { fresh });
    for (const r of data.results || []) results.push(r);
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return { results };
}

// Wrapper que captura errores async y los devuelve como JSON
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    res.status(err.status || 500).json({
      error: err.message,
      details: err.body || null,
    });
  });
};

// ---- Meta / estado de cache y rate limit ----
app.get('/api/_meta', (req, res) => {
  res.json(stats);
});

// ---- Datos casi estáticos (TTL largo) ----
app.get('/api/pipelines', wrap(async (req, res) => {
  const data = await hsGet('/crm/v3/pipelines/deals', { ttl: 3600, fresh: isFresh(req) });
  res.json(data);
}));

app.get('/api/owners', wrap(async (req, res) => {
  const data = await hsGet('/crm/v3/owners?limit=100', { ttl: 3600, fresh: isFresh(req) });
  res.json(data);
}));

app.get('/api/properties/:object', wrap(async (req, res) => {
  const data = await hsGet(`/crm/v3/properties/${req.params.object}`, { ttl: 3600, fresh: isFresh(req) });
  res.json(data);
}));

// ---- Listados (TTL 5 min) · paginados ----
app.get('/api/contacts', wrap(async (req, res) => {
  const data = await listAll('contacts', CONTACT_PROPS, { fresh: isFresh(req) });
  res.json(data);
}));

app.get('/api/deals', wrap(async (req, res) => {
  // propertiesWithHistory=dealstage trae el historial completo de cambios de etapa
  // (con timestamp y sourceType) para medir avances reales de pipeline.
  // HubSpot limita a 50 objetos por request cuando se pide historial.
  const data = await listAll('deals', DEAL_PROPS, { fresh: isFresh(req), history: 'dealstage', limit: 50 });
  res.json(data);
}));

app.get('/api/tasks', wrap(async (req, res) => {
  const data = await listAll('tasks', TASK_PROPS, { fresh: isFresh(req) });
  res.json(data);
}));

// ---- Actividades unificadas (calls + emails + meetings + notes) ----
// Tolerante a fallos: si falta el scope de un tipo, lo saltea y sigue con los demás.
app.get('/api/activities', wrap(async (req, res) => {
  const fresh = isFresh(req);
  const merged = [];
  const unavailable = [];
  for (const def of ACTIVITY_DEFS) {
    try {
      const data = await listAll(def.type, def.props, { fresh, maxPages: 5 });
      for (const item of data.results || []) {
        const props = item.properties || {};
        merged.push({
          id: item.id,
          type: def.type,
          title: (def.title && props[def.title]) || '(sin título)',
          body: (def.body && props[def.body]) || '',
          ownerId: props.hubspot_owner_id || null,
          timestamp: props.hs_timestamp || props.hs_meeting_start_time || item.createdAt,
          raw: props,
        });
      }
    } catch (err) {
      unavailable.push({ type: def.type, status: err.status || 500 });
    }
  }
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json({ results: merged, unavailable });
}));

// ---- Detalle de un objeto: TODAS las propiedades + asociaciones ----
async function detail(object, id, associations, fresh) {
  // 1. lista de nombres de todas las propiedades (cache larga)
  const propsDef = await hsGet(`/crm/v3/properties/${object}`, { ttl: 3600, fresh });
  const allNames = (propsDef.results || []).map((p) => p.name);

  // 2. batch read para traer TODAS las propiedades (sin límite de URL)
  const batch = await hsPost(
    `/crm/v3/objects/${object}/batch/read`,
    { properties: allNames, inputs: [{ id }] },
    { fresh },
  );
  const record = (batch.results || [])[0] || { id, properties: {} };

  // 3. asociaciones (ids) para mostrar relaciones
  const assocParam = associations.join(',');
  const withAssoc = await hsGet(
    `/crm/v3/objects/${object}/${id}?associations=${assocParam}&properties=createdate`,
    { fresh },
  );

  return {
    id,
    properties: record.properties,
    propertyDefs: propsDef.results,
    associations: withAssoc.associations || {},
  };
}

app.get('/api/contacts/:id', wrap(async (req, res) => {
  const data = await detail('contacts', req.params.id, ['deals', 'companies', 'tasks'], isFresh(req));
  res.json(data);
}));

app.get('/api/deals/:id', wrap(async (req, res) => {
  const data = await detail('deals', req.params.id, ['contacts', 'companies', 'line_items'], isFresh(req));
  res.json(data);
}));

// ---- Servir el build de producción si existe ----
const distDir = join(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[server] HubSpot proxy escuchando en http://localhost:${PORT}`);
  console.log('[server] El frontend (vite) corre en http://localhost:5173 y proxea /api hacia acá.');
});
