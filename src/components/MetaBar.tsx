import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMeta } from '../hooks';
import { apiGet, type Meta } from '../api';
import { dateTime } from '../format';

// Endpoints que se re-piden con fresh=1 al hacer Refresh (cebamos la cache del backend).
const REFRESHABLE = ['/owners', '/pipelines', '/contacts', '/deals', '/tasks', '/activities'];

type Stage = 'queued' | 'loading' | 'done' | 'error';

interface ReqLog {
  path: string;
  stage: Stage;
  ms?: number;
  realCalls?: number;   // llamadas reales a HubSpot que disparó esta request
  cacheHits?: number;   // páginas servidas desde cache
  count?: number;       // registros devueltos
  error?: string;
}

const STAGE_META: Record<Stage, { label: string; cls: string }> = {
  queued: { label: 'en cola', cls: '' },
  loading: { label: 'llamando…', cls: 'yellow' },
  done: { label: 'ok', cls: 'green' },
  error: { label: 'error', cls: 'red' },
};

export default function MetaBar() {
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const [log, setLog] = useState<ReqLog[] | null>(null);

  const running = log?.some((r) => r.stage === 'queued' || r.stage === 'loading') ?? false;

  async function refresh() {
    const rows: ReqLog[] = REFRESHABLE.map((path) => ({ path, stage: 'queued' }));
    setLog([...rows]);

    // Las corremos de a una para que se vea cada etapa (en una demo es más claro).
    let prev = await apiGet<Meta>('/_meta');
    for (let i = 0; i < REFRESHABLE.length; i++) {
      rows[i] = { ...rows[i], stage: 'loading' };
      setLog([...rows]);
      const t0 = performance.now();
      try {
        const data = await apiGet<{ results?: unknown[] }>(REFRESHABLE[i], true);
        const ms = Math.round(performance.now() - t0);
        const now = await apiGet<Meta>('/_meta');
        rows[i] = {
          ...rows[i],
          stage: 'done',
          ms,
          realCalls: now.realCalls - prev.realCalls,
          cacheHits: now.cacheHits - prev.cacheHits,
          count: Array.isArray(data?.results) ? data.results.length : undefined,
        };
        prev = now;
      } catch (e) {
        rows[i] = { ...rows[i], stage: 'error', ms: Math.round(performance.now() - t0), error: (e as Error).message };
      }
      setLog([...rows]);
    }
    await qc.invalidateQueries();
  }

  const calls = meta?.realCalls ?? 0;
  const hits = meta?.cacheHits ?? 0;
  const total = calls + hits;
  const hitRate = total ? Math.round((hits / total) * 100) : 0;

  const totalReal = log?.reduce((a, r) => a + (r.realCalls ?? 0), 0) ?? 0;
  const totalHits = log?.reduce((a, r) => a + (r.cacheHits ?? 0), 0) ?? 0;
  const totalMs = log?.reduce((a, r) => a + (r.ms ?? 0), 0) ?? 0;

  return (
    <div className="metabar">
      <div className="stat">
        <span className="val bad">{calls}</span>
        <span className="lbl">llamadas reales a HubSpot</span>
      </div>
      <div className="stat">
        <span className="val ok">{hits}</span>
        <span className="lbl">servidas desde cache</span>
      </div>
      <div className="stat">
        <span className={`val ${hitRate > 50 ? 'ok' : 'warn'}`}>{hitRate}%</span>
        <span className="lbl">cache hit rate</span>
      </div>
      <div className="stat">
        <span className={`val ${meta?.rateLimited ? 'bad' : ''}`}>{meta?.rateLimited ?? 0}</span>
        <span className="lbl">429 (rate limited)</span>
      </div>
      <div className="stat">
        <span className="val" style={{ fontSize: 13 }}>{dateTime(meta?.lastCallAt)}</span>
        <span className="lbl">última llamada real</span>
      </div>
      <div className="grow" />
      <button onClick={refresh} disabled={running}>
        {running ? 'Actualizando…' : '↻ Refresh (datos frescos)'}
      </button>

      {log && (
        <div className="modal-overlay" onClick={() => { if (!running) setLog(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Refresh de datos frescos</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Cada fila es una request a nuestro proxy con <code>fresh=1</code>. El proxy paginá y pega
              contra la API de HubSpot (con throttling y reintentos ante 429); lo que ya está cacheado no
              se vuelve a pedir. Mostramos cuántas llamadas reales a HubSpot disparó cada una.
            </p>

            <div className="req-row" style={{ fontWeight: 600, color: 'var(--muted)' }}>
              <span>Endpoint</span><span>Etapa</span><span className="num">HubSpot / cache</span><span className="num">Tiempo · regs</span>
            </div>
            {log.map((r) => {
              const sm = STAGE_META[r.stage];
              return (
                <div className="req-row" key={r.path}>
                  <code>GET /api{r.path}</code>
                  <span><span className={`badge ${sm.cls}`}>{sm.label}</span></span>
                  <span className="num">
                    {r.stage === 'done'
                      ? <>{r.realCalls ? <span className="badge red">{r.realCalls} real</span> : <span className="badge green">cache</span>}
                          {r.cacheHits ? <span className="muted" style={{ marginLeft: 6 }}>{r.cacheHits} cache</span> : null}</>
                      : <span className="muted">—</span>}
                  </span>
                  <span className="num muted">
                    {r.stage === 'error' ? <span className="badge red" title={r.error}>falló</span>
                      : r.stage === 'done' ? `${r.ms} ms${r.count != null ? ` · ${r.count}` : ''}`
                      : '—'}
                  </span>
                </div>
              );
            })}

            <div className="req-row" style={{ fontWeight: 600, borderBottom: 'none', marginTop: 4 }}>
              <span>Total</span>
              <span>{running ? <span className="badge yellow">corriendo…</span> : <span className="badge green">listo</span>}</span>
              <span className="num"><span className="badge red">{totalReal} real</span> <span className="muted">{totalHits} cache</span></span>
              <span className="num muted">{totalMs} ms</span>
            </div>

            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <button className="ghost" onClick={() => setLog(null)} disabled={running}>
                {running ? 'Esperá a que termine…' : 'Cerrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
