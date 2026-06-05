import { useState } from 'react';
import {
  useContacts, useDeals, useTasks, useActivities,
  usePipelines, useOwners, useContactDetail,
  buildOwnerMap, buildStageMap,
} from '../hooks';
import type { HsRecord } from '../api';
import { money, date, dateTime, daysSince, fullName } from '../format';
import { ownerLabel } from '../owners';

function Loading() { return <div className="empty">Cargando…</div>; }
function ErrorBox({ message }: { message: string }) { return <div className="error">Error: {message}</div>; }

// ---------- Contactos ----------
function ContactsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, error } = useContacts();
  const { data: owners } = useOwners();
  const ownerMap = buildOwnerMap(owners?.results);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox message={(error as Error).message} />;

  // Orden por última modificación, de más reciente a más viejo.
  const rows = [...(data?.results || [])].sort((a, b) => {
    const ta = new Date(a.properties.lastmodifieddate || 0).getTime();
    const tb = new Date(b.properties.lastmodifieddate || 0).getTime();
    return tb - ta;
  });
  return (
    <div className="panel">
      <h2>Contactos <span className="muted">({rows.length} · orden: últ. modif. ↓)</span></h2>
      <table>
        <thead>
          <tr><th>Nombre</th><th>Email</th><th>Empresa</th><th>Etapa</th><th>Propietario</th><th>Creado</th><th>Últ. modif. ↓</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => onOpen(c.id)}>
              <td>{fullName(c.properties)}</td>
              <td className="muted">{c.properties.email || '—'}</td>
              <td>{c.properties.company || '—'}</td>
              <td>{c.properties.lifecyclestage || '—'}</td>
              <td>{ownerLabel(c.properties.hubspot_owner_id, ownerMap)}</td>
              <td className="muted">{date(c.properties.createdate)}</td>
              <td className="muted">{dateTime(c.properties.lastmodifieddate)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="empty">Sin contactos</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Drawer de detalle (todas las propiedades) ----------
function ContactDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, error } = useContactDetail(id);
  const labelMap: Record<string, string> = {};
  for (const d of data?.propertyDefs || []) labelMap[d.name] = d.label;

  const filled = Object.entries(data?.properties || {})
    .filter(([, v]) => v != null && v !== '')
    .sort((a, b) => (labelMap[a[0]] || a[0]).localeCompare(labelMap[b[0]] || b[0]));

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="ghost close" onClick={onClose}>Cerrar ✕</button>
        <h2>{data ? fullName(data.properties) : 'Contacto'}</h2>
        {isLoading && <Loading />}
        {error && <ErrorBox message={(error as Error).message} />}
        {data && (
          <>
            <h3>Asociaciones</h3>
            <div style={{ marginBottom: 16 }}>
              {Object.entries(data.associations || {}).map(([k, v]) => (
                <span key={k} className="badge blue" style={{ marginRight: 6 }}>
                  {k}: {v.results?.length ?? 0}
                </span>
              ))}
              {Object.keys(data.associations || {}).length === 0 && <span className="muted">Sin asociaciones</span>}
            </div>
            <h3>Todas las propiedades con valor ({filled.length})</h3>
            {filled.map(([k, v]) => (
              <div className="prop-row" key={k}>
                <span className="k">{labelMap[k] || k}</span>
                <span className="v">{String(v)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Deals ----------
function DealsPanel() {
  const { data, isLoading, error } = useDeals();
  const { data: pipelines } = usePipelines();
  const { data: owners } = useOwners();
  const stageMap = buildStageMap(pipelines?.results);
  const ownerMap = buildOwnerMap(owners?.results);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox message={(error as Error).message} />;
  const rows = data?.results || [];

  function stageBadge(stageId: string | null) {
    const s = stageId ? stageMap[stageId] : undefined;
    if (!s) return <span className="badge">{stageId || '—'}</span>;
    const cls = s.isWon ? 'green' : s.isLost ? 'red' : 'blue';
    return <span className={`badge ${cls}`}>{s.label}</span>;
  }

  return (
    <div className="panel">
      <h2>Deals <span className="muted">({rows.length})</span></h2>
      <table>
        <thead>
          <tr><th>Deal</th><th>Etapa</th><th className="num">Monto</th><th>Cierre</th><th>Propietario</th><th>Últ. modif.</th></tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>{d.properties.dealname || '(sin nombre)'}</td>
              <td>{stageBadge(d.properties.dealstage)}</td>
              <td className="num">{money(d.properties.amount)}</td>
              <td className="muted">{date(d.properties.closedate)}</td>
              <td>{ownerLabel(d.properties.hubspot_owner_id, ownerMap)}</td>
              <td className="muted">{date(d.properties.hs_lastmodifieddate)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty">Sin deals</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Tareas ----------
function TasksPanel() {
  const { data, isLoading, error } = useTasks();
  const { data: owners } = useOwners();
  const ownerMap = buildOwnerMap(owners?.results);
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox message={(error as Error).message} />;
  const rows = data?.results || [];

  function statusBadge(status: string | null) {
    if (!status) return <span className="badge">—</span>;
    const cls = status === 'COMPLETED' ? 'green' : status === 'NOT_STARTED' ? 'yellow' : 'blue';
    return <span className={`badge ${cls}`}>{status}</span>;
  }

  return (
    <div className="panel">
      <h2>Tareas <span className="muted">({rows.length})</span></h2>
      <table>
        <thead>
          <tr><th>Asunto</th><th>Tipo</th><th>Estado</th><th>Prioridad</th><th>Vencimiento</th><th>Propietario</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.properties.hs_task_subject || '(sin asunto)'}</td>
              <td className="muted">{t.properties.hs_task_type || '—'}</td>
              <td>{statusBadge(t.properties.hs_task_status)}</td>
              <td>{t.properties.hs_task_priority || '—'}</td>
              <td className="muted">{dateTime(t.properties.hs_timestamp)}</td>
              <td>{ownerLabel(t.properties.hubspot_owner_id, ownerMap)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty">Sin tareas</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Actividades ----------
const ACTIVITY_LABEL: Record<string, string> = { calls: '📞 Llamada', emails: '✉️ Email', meetings: '📅 Reunión', notes: '📝 Nota' };

function ActivitiesPanel() {
  const { data, isLoading, error } = useActivities();
  const { data: owners } = useOwners();
  const ownerMap = buildOwnerMap(owners?.results);
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox message={(error as Error).message} />;
  const rows = data?.results || [];
  const unavailable = data?.unavailable || [];

  return (
    <div className="panel">
      <h2>Actividades <span className="muted">({rows.length})</span></h2>
      {unavailable.length > 0 && (
        <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
          Sin scope para: {unavailable.map((u) => ACTIVITY_LABEL[u.type] || u.type).join(', ')}
        </div>
      )}
      {rows.map((a) => (
        <div className="feed-item" key={`${a.type}-${a.id}`}>
          <div>
            <span className="badge blue" style={{ marginRight: 8 }}>{ACTIVITY_LABEL[a.type] || a.type}</span>
            <strong>{a.title}</strong>
          </div>
          {a.body && <div className="muted" style={{ marginTop: 4 }}>{stripHtml(a.body).slice(0, 160)}</div>}
          <div className="meta">{dateTime(a.timestamp)} · {ownerLabel(a.ownerId, ownerMap)}</div>
        </div>
      ))}
      {rows.length === 0 && <div className="empty">Sin actividades</div>}
    </div>
  );
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- Contenedor ----------
export default function Basics() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <ContactsPanel onOpen={setOpenId} />
      <DealsPanel />
      <div className="grid cols-2">
        <TasksPanel />
        <ActivitiesPanel />
      </div>
      {openId && <ContactDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

export type { HsRecord };
