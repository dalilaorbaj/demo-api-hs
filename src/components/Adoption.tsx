import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import {
  useContacts, useDeals, useTasks, useActivities, useOwners, usePipelines,
  buildOwnerMap, buildStageMap, type StageInfo,
} from '../hooks';
import { ownerLabel } from '../owners';
import { date } from '../format';
import type { Activity, HsRecord } from '../api';

const COLORS = ['#ff7a59', '#4f8cff', '#3ecf8e', '#f5c451', '#b07aff', '#ff5d5d', '#56d8d8', '#ff9f43'];
const WEEKS = 10;          // ventana de la evolución en el tiempo
const STALE_DAYS = 30;     // deal abierto sin tocar => mala higiene
// Vendedores que no se cuentan en el tablero de adopción (por nombre/label).
const EXCLUDED_SELLERS = new Set(['Admin User', 'Manager A', 'Manager B', 'Vendedor #81109103']);
// Solo contamos como "avance de etapa" los cambios hechos por una persona en HubSpot,
// no los de automatizaciones/workflows.
const MANUAL_SOURCES = new Set(['CRM_UI']);

// Pesos del score de adopción (suman 1)
const WEIGHTS = {
  actividad: 0.25,
  creacion: 0.20,
  pipeline: 0.15,
  constancia: 0.20,
  recencia: 0.10,
  tareas: 0.10,
};

const DIM_LABELS: Record<keyof typeof WEIGHTS, string> = {
  actividad: 'Actividad',
  creacion: 'Creación',
  pipeline: 'Pipeline',
  constancia: 'Constancia',
  recencia: 'Recencia',
  tareas: 'Tareas',
};

type EventKind = 'activity' | 'contact' | 'deal' | 'stage';
interface CrmEvent { ownerId: string; ts: number; kind: EventKind }

interface SellerMetrics {
  id: string;
  activities: number;
  byType: Record<Activity['type'], number>;
  contactsCreated: number;
  dealsCreated: number;
  stageMoves: number;
  lastEventTs: number | null;
  daysSinceLast: number | null;
  activeWeeks: number;          // semanas distintas con cualquier evento, en la ventana
  tasksTotal: number;
  tasksCompleted: number;
  openDeals: number;
  staleDeals: number;
  contacts: number;
  scores: Record<keyof typeof WEIGHTS, number>;
  score: number;
}

function monday(d: Date): Date {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - day + 1);
  return x;
}

function weekKeyOf(ts: number): string {
  return monday(new Date(ts)).toISOString().slice(0, 10);
}

// Timestamps de los avances de etapa manuales de un deal, desde el historial de
// `dealstage`. La primera entrada es la etapa inicial (alta), no es un avance.
function dealStageMoveTimestamps(deal: HsRecord): number[] {
  const hist = deal.propertiesWithHistory?.dealstage;
  if (!hist || hist.length === 0) return [];
  const entries = hist
    .map((h) => ({ ts: new Date(h.timestamp).getTime(), src: h.sourceType }))
    .filter((h) => !Number.isNaN(h.ts))
    .sort((a, b) => a.ts - b.ts);
  return entries
    .slice(1)
    .filter((e) => e.src != null && MANUAL_SOURCES.has(e.src))
    .map((e) => e.ts);
}

function recencyScore(days: number | null): number {
  if (days == null) return 0;
  if (days <= 3) return 100;
  if (days <= 7) return 80;
  if (days <= 14) return 50;
  if (days <= 30) return 25;
  return 0;
}

function scoreColor(s: number): 'green' | 'yellow' | 'red' {
  if (s >= 67) return 'green';
  if (s >= 34) return 'yellow';
  return 'red';
}

function Kpi({ big, lbl, tone }: { big: string; lbl: string; tone?: string }) {
  return (
    <div className="kpi">
      <div className="big" style={tone ? { color: tone } : undefined}>{big}</div>
      <div className="lbl">{lbl}</div>
    </div>
  );
}

function buildMetrics(
  ownerId: string,
  ownerEvents: CrmEvent[],
  activities: Activity[],
  tasks: HsRecord[],
  deals: HsRecord[],
  contacts: HsRecord[],
  stageMap: Record<string, StageInfo>,
  weekWindow: Set<string>,
): SellerMetrics {
  // Los volúmenes se miden en la ventana (últimas WEEKS semanas) para reflejar la
  // adopción reciente, no el histórico migrado. La recencia sí mira todo el tiempo.
  const inWindow = (ts: number) => weekWindow.has(weekKeyOf(ts));

  const byType: Record<Activity['type'], number> = { calls: 0, emails: 0, meetings: 0, notes: 0 };
  for (const a of activities) {
    if (a.ownerId !== ownerId || !a.timestamp) continue;
    const ts = new Date(a.timestamp).getTime();
    if (!Number.isNaN(ts) && inWindow(ts)) byType[a.type] = (byType[a.type] || 0) + 1;
  }
  const activitiesCount = byType.calls + byType.emails + byType.meetings + byType.notes;

  let contactsCreated = 0, dealsCreated = 0, stageMoves = 0;
  let lastEventTs: number | null = null;
  const activeWeekSet = new Set<string>();
  for (const ev of ownerEvents) {
    if (lastEventTs == null || ev.ts > lastEventTs) lastEventTs = ev.ts;
    const wk = weekKeyOf(ev.ts);
    if (!weekWindow.has(wk)) continue;
    activeWeekSet.add(wk);
    if (ev.kind === 'contact') contactsCreated++;
    else if (ev.kind === 'deal') dealsCreated++;
    else if (ev.kind === 'stage') stageMoves++;
  }

  const myTasks = tasks.filter((t) => t.properties.hubspot_owner_id === ownerId);
  const tasksCompleted = myTasks.filter((t) => t.properties.hs_task_status === 'COMPLETED').length;

  let openDeals = 0, staleDeals = 0;
  for (const d of deals) {
    if (d.properties.hubspot_owner_id !== ownerId) continue;
    const s = d.properties.dealstage ? stageMap[d.properties.dealstage] : undefined;
    if (s?.isClosed) continue;
    openDeals++;
    const lm = d.properties.hs_lastmodifieddate;
    const days = lm ? Math.floor((Date.now() - new Date(lm).getTime()) / 86_400_000) : null;
    if (days != null && days > STALE_DAYS) staleDeals++;
  }

  const contactsCount = contacts.filter((c) => c.properties.hubspot_owner_id === ownerId).length;
  const daysSinceLast = lastEventTs == null ? null : Math.floor((Date.now() - lastEventTs) / 86_400_000);

  const scores: Record<keyof typeof WEIGHTS, number> = {
    actividad: Math.min(100, (activitiesCount / 20) * 100),
    creacion: Math.min(100, ((contactsCreated + dealsCreated) / 10) * 100),
    pipeline: Math.min(100, (stageMoves / 8) * 100),
    constancia: Math.min(100, (activeWeekSet.size / 4) * 100),
    recencia: recencyScore(daysSinceLast),
    tareas: myTasks.length === 0 ? 0 : (tasksCompleted / myTasks.length) * 100,
  };
  const score = Math.round(
    (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((acc, k) => acc + scores[k] * WEIGHTS[k], 0),
  );

  return {
    id: ownerId,
    activities: activitiesCount,
    byType,
    contactsCreated,
    dealsCreated,
    stageMoves,
    lastEventTs,
    daysSinceLast,
    activeWeeks: activeWeekSet.size,
    tasksTotal: myTasks.length,
    tasksCompleted,
    openDeals,
    staleDeals,
    contacts: contactsCount,
    scores,
    score,
  };
}

function recommendations(m: SellerMetrics): string[] {
  const out: string[] = [];
  if (m.scores.actividad < 50)
    out.push(`Registra poca actividad (${m.activities} llamadas/emails/reuniones/notas). Reforzar el hábito de loguear cada contacto.`);
  if (m.scores.creacion < 50)
    out.push(`Carga poca cartera: ${m.contactsCreated} contactos y ${m.dealsCreated} negocios creados. Está usando HubSpot pero no para dar de alta sus oportunidades.`);
  if (m.scores.pipeline < 50)
    out.push(`Mueve pocos negocios de etapa (${m.stageMoves}). El pipeline le queda estático — revisar que actualice los estados a medida que avanzan.`);
  if (m.scores.constancia < 50)
    out.push(`Uso intermitente: activo ${m.activeWeeks} de las últimas ${WEEKS} semanas. Trabajar la constancia (entrar todos los días).`);
  if (m.scores.recencia < 50)
    out.push(m.daysSinceLast == null
      ? 'Nunca registró movimiento en HubSpot. Sesión de arranque 1 a 1.'
      : `Hace ${m.daysSinceLast} días que no hace nada en HubSpot. Hacer seguimiento esta semana.`);
  if (m.scores.tareas < 50)
    out.push(m.tasksTotal === 0
      ? 'No crea tareas en HubSpot. Enseñarle a planificar seguimientos con tareas.'
      : `Completa pocas tareas (${m.tasksCompleted}/${m.tasksTotal}). Revisar gestión de pendientes.`);
  if (m.staleDeals > 0)
    out.push(`Tiene ${m.staleDeals} deal(s) abiertos sin tocar +${STALE_DAYS} días. Revisar higiene del pipeline.`);
  if (out.length === 0) out.push('Buen nivel de adopción. Mantener el ritmo y empezar a pedir calidad, no solo cantidad.');
  return out;
}

function strengths(m: SellerMetrics): string[] {
  const out: string[] = [];
  if (m.scores.actividad >= 67)
    out.push(`Registra actividad de forma sostenida: ${m.activities} interacciones en las últimas ${WEEKS} semanas.`);
  if (m.scores.creacion >= 67)
    out.push(`Carga bien su cartera: ${m.contactsCreated} contactos y ${m.dealsCreated} negocios nuevos.`);
  if (m.scores.pipeline >= 67)
    out.push(`Gestiona el pipeline: ${m.stageMoves} avances de etapa hechos a mano.`);
  if (m.scores.constancia >= 67)
    out.push(`Uso constante: activo ${m.activeWeeks} de las últimas ${WEEKS} semanas.`);
  if (m.scores.recencia >= 80)
    out.push('Viene usándolo muy seguido (actividad reciente).');
  if (m.scores.tareas >= 67)
    out.push(`Buena gestión de tareas: ${m.tasksCompleted}/${m.tasksTotal} completadas.`);
  if (m.openDeals > 0 && m.staleDeals === 0)
    out.push('Mantiene el pipeline al día, sin negocios estancados.');
  return out;
}

export default function Adoption() {
  const { data: contactsData, isLoading } = useContacts();
  const { data: dealsData } = useDeals();
  const { data: tasksData } = useTasks();
  const { data: activitiesData } = useActivities();
  const { data: owners } = useOwners();
  const { data: pipelines } = usePipelines();

  const ownerMap = useMemo(() => buildOwnerMap(owners?.results), [owners]);
  const stageMap = useMemo(() => buildStageMap(pipelines?.results), [pipelines]);

  const contacts = contactsData?.results || [];
  const deals = dealsData?.results || [];
  const tasks = tasksData?.results || [];
  const activities = activitiesData?.results || [];

  // Ventana de semanas (las últimas WEEKS, terminando en la semana actual)
  const weeks = useMemo(() => {
    const thisMonday = monday(new Date());
    const arr: { key: string; label: string }[] = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const d = new Date(thisMonday);
      d.setUTCDate(d.getUTCDate() - i * 7);
      const key = d.toISOString().slice(0, 10);
      arr.push({ key, label: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` });
    }
    return arr;
  }, []);
  const weekWindow = useMemo(() => new Set(weeks.map((w) => w.key)), [weeks]);

  // Lista unificada de eventos de uso del CRM (actividad + creación + avance de etapa)
  const events = useMemo(() => {
    const out: CrmEvent[] = [];
    for (const a of activities) {
      if (!a.ownerId || !a.timestamp) continue;
      const ts = new Date(a.timestamp).getTime();
      if (!Number.isNaN(ts)) out.push({ ownerId: a.ownerId, ts, kind: 'activity' });
    }
    for (const c of contacts) {
      const id = c.properties.hubspot_owner_id;
      const ts = c.properties.createdate ? new Date(c.properties.createdate).getTime() : NaN;
      if (id && !Number.isNaN(ts)) out.push({ ownerId: id, ts, kind: 'contact' });
    }
    for (const d of deals) {
      const id = d.properties.hubspot_owner_id;
      if (!id) continue;
      const ts = d.properties.createdate ? new Date(d.properties.createdate).getTime() : NaN;
      if (!Number.isNaN(ts)) out.push({ ownerId: id, ts, kind: 'deal' });
      for (const moveTs of dealStageMoveTimestamps(d)) out.push({ ownerId: id, ts: moveTs, kind: 'stage' });
    }
    return out;
  }, [activities, contacts, deals]);

  // Agrupar eventos por vendedor
  const eventsByOwner = useMemo(() => {
    const map: Record<string, CrmEvent[]> = {};
    for (const ev of events) (map[ev.ownerId] ||= []).push(ev);
    return map;
  }, [events]);

  const ownerIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of [...contacts, ...deals, ...tasks]) {
      const id = r.properties.hubspot_owner_id;
      if (id) set.add(id);
    }
    for (const ev of events) set.add(ev.ownerId);
    return [...set].filter((id) => !EXCLUDED_SELLERS.has(ownerLabel(id, ownerMap)));
  }, [contacts, deals, tasks, events, ownerMap]);

  const metrics = useMemo(
    () => ownerIds
      .map((id) => buildMetrics(id, eventsByOwner[id] || [], activities, tasks, deals, contacts, stageMap, weekWindow))
      .sort((a, b) => b.score - a.score),
    [ownerIds, eventsByOwner, activities, tasks, deals, contacts, stageMap, weekWindow],
  );

  // Evolución: eventos de uso del CRM por semana, una serie por vendedor
  const timeline = useMemo(() => {
    const idx: Record<string, number> = {};
    weeks.forEach((w, i) => { idx[w.key] = i; });
    const rows = weeks.map((w) => {
      const r: Record<string, string | number> = { week: w.label };
      for (const id of ownerIds) r[id] = 0;
      return r;
    });
    for (const ev of events) {
      const wk = weekKeyOf(ev.ts);
      if (wk in idx) rows[idx[wk]][ev.ownerId] = (rows[idx[wk]][ev.ownerId] as number) + 1;
    }
    return rows;
  }, [weeks, ownerIds, events]);

  const [selected, setSelected] = useState<string>('');
  const current = selected || metrics[0]?.id || '';
  const currentM = metrics.find((m) => m.id === current);

  if (isLoading) return <div className="empty">Cargando…</div>;
  if (metrics.length === 0) return <div className="panel empty">No hay vendedores con datos asignados.</div>;

  // Resumen del equipo
  const teamScore = Math.round(metrics.reduce((a, m) => a + m.score, 0) / metrics.length);
  const activeLast7 = metrics.filter((m) => m.daysSinceLast != null && m.daysSinceLast <= 7).length;
  const totalActivities = metrics.reduce((a, m) => a + m.activities, 0);
  const totalCreated = metrics.reduce((a, m) => a + m.contactsCreated + m.dealsCreated, 0);
  const totalMoves = metrics.reduce((a, m) => a + m.stageMoves, 0);

  const radarData = currentM
    ? (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => ({
        dim: DIM_LABELS[k],
        score: Math.round(currentM.scores[k]),
      }))
    : [];

  return (
    <>
      <div className="panel">
        <h2>Tablero de adopción de HubSpot</h2>
        <p className="muted" style={{ margin: 0 }}>
          Indicador de cuánto usa el equipo HubSpot en el día a día. Cuenta el uso completo del CRM:
          actividad registrada (llamadas, reuniones, notas), creación de contactos y negocios,
          y avances de etapa en el pipeline. Los volúmenes son de las últimas {WEEKS} semanas
          (no el histórico), para ver la adopción reciente. Score 0–100 por vendedor.
        </p>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
          Los avances de etapa se toman del historial real de cada negocio y cuentan solo los movimientos
          hechos por una persona en HubSpot (se excluyen las automatizaciones).
        </p>
      </div>

      <div className="grid cols-4">
        <Kpi big={`${teamScore}`} lbl="Adopción promedio del equipo" tone={`var(--${scoreColor(teamScore)})`} />
        <Kpi big={`${activeLast7}/${metrics.length}`} lbl="Vendedores activos (últ. 7 días)" />
        <Kpi big={`${totalActivities} · ${totalCreated}`} lbl="Actividades · altas (contactos+negocios)" />
        <Kpi big={String(totalMoves)} lbl="Avances de etapa" />
      </div>

      <div className="panel">
        <h2>Ranking de adopción por vendedor</h2>
        <table>
          <thead>
            <tr>
              <th>Vendedor</th>
              <th className="num">Adopción</th>
              <th className="num">Activ.</th>
              <th className="num">Contactos</th>
              <th className="num">Negocios</th>
              <th className="num">Avances</th>
              <th className="num">Sem. activas</th>
              <th className="num">Últ. uso</th>
              <th className="num">Tareas</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.id} className="clickable" onClick={() => setSelected(m.id)}>
                <td>{ownerLabel(m.id, ownerMap)}</td>
                <td className="num"><span className={`badge ${scoreColor(m.score)}`}>{m.score}</span></td>
                <td className="num">{m.activities}</td>
                <td className="num">{m.contactsCreated}</td>
                <td className="num">{m.dealsCreated}</td>
                <td className="num">{m.stageMoves}</td>
                <td className="num">{m.activeWeeks}/{WEEKS}</td>
                <td className="num">
                  {m.daysSinceLast == null
                    ? <span className="badge red">nunca</span>
                    : <span className={`badge ${m.daysSinceLast <= 7 ? 'green' : m.daysSinceLast <= 30 ? 'yellow' : 'red'}`}>{m.daysSinceLast}d</span>}
                </td>
                <td className="num">{m.tasksCompleted}/{m.tasksTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Contactos/Negocios = altas creadas. Avances = movimientos de etapa. Tocá una fila para ver el detalle.
        </p>
      </div>

      <div className="panel">
        <h2>Evolución del uso en el tiempo <span className="muted">(eventos de CRM por semana: actividad + altas + avances)</span></h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={timeline} margin={{ left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="week" tick={{ fill: '#8b93a7', fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: '#8b93a7', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#171a21', border: '1px solid #2a2f3a' }} />
            <Legend />
            {ownerIds.map((id, i) => (
              <Line key={id} type="monotone" dataKey={id} name={ownerLabel(id, ownerMap)}
                stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>Detalle del vendedor</h2>
        <label className="muted" style={{ marginRight: 8 }}>Vendedor:</label>
        <select value={current} onChange={(e) => setSelected(e.target.value)}
          style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          {metrics.map((m) => <option key={m.id} value={m.id}>{ownerLabel(m.id, ownerMap)}</option>)}
        </select>
      </div>

      {currentM && (
        <div className="grid cols-2">
          <div className="panel">
            <h2>Perfil de adopción <span className="muted">· score {currentM.score}</span></h2>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="#2a2f3a" />
                <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b93a7', fontSize: 12 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fill: '#8b93a7', fontSize: 10 }} angle={90} />
                <Radar dataKey="score" stroke="#ff7a59" fill="#ff7a59" fillOpacity={0.4} />
                <Tooltip contentStyle={{ background: '#171a21', border: '1px solid #2a2f3a' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel">
            <h2>{ownerLabel(currentM.id, ownerMap)}</h2>
            <h3 style={{ color: 'var(--green)' }}>Lo que viene haciendo bien</h3>
            {(() => {
              const good = strengths(currentM);
              return good.length > 0
                ? <ul style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.7 }}>{good.map((r, i) => <li key={i}>{r}</li>)}</ul>
                : <p className="muted" style={{ marginTop: 0 }}>Todavía sin fortalezas marcadas — foco en arrancar con lo básico.</p>;
            })()}
            <h3 style={{ color: 'var(--yellow)' }}>Qué trabajar</h3>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {recommendations(currentM).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <h3 style={{ marginTop: 16 }}>Uso del CRM</h3>
            <div className="grid cols-4" style={{ gap: 8 }}>
              <Kpi big={String(currentM.contactsCreated)} lbl="Contactos creados" />
              <Kpi big={String(currentM.dealsCreated)} lbl="Negocios creados" />
              <Kpi big={String(currentM.stageMoves)} lbl="Avances de etapa" />
              <Kpi big={String(currentM.tasksTotal)} lbl="Tareas" />
            </div>
            <h3 style={{ marginTop: 16 }}>Actividad por tipo</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <Kpi big={String(currentM.byType.calls)} lbl="Llamadas" />
              <Kpi big={String(currentM.byType.meetings)} lbl="Reuniones" />
              <Kpi big={String(currentM.byType.notes)} lbl="Notas" />
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
              Último uso: {currentM.lastEventTs ? date(new Date(currentM.lastEventTs).toISOString()) : '—'}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
