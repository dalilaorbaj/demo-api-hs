import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useDeals, useContacts, useTasks, usePipelines, buildStageMap } from '../hooks';
import { money, date, daysSince } from '../format';

const COLORS = ['#ff7a59', '#4f8cff', '#3ecf8e', '#f5c451', '#b07aff', '#ff5d5d'];
const STALE_DAYS = 30;

function Card({ big, lbl }: { big: string; lbl: string }) {
  return <div className="kpi"><div className="big">{big}</div><div className="lbl">{lbl}</div></div>;
}

export default function Creative() {
  const { data: dealsData, isLoading } = useDeals();
  const { data: contactsData } = useContacts();
  const { data: tasksData } = useTasks();
  const { data: pipelines } = usePipelines();
  const stageMap = buildStageMap(pipelines?.results);

  if (isLoading) return <div className="empty">Cargando…</div>;
  const deals = dealsData?.results || [];

  // ---- KPIs ----
  let openValue = 0, openCount = 0, wonCount = 0, lostCount = 0, wonValue = 0;
  for (const d of deals) {
    const amount = parseFloat(d.properties.amount || '0') || 0;
    const s = d.properties.dealstage ? stageMap[d.properties.dealstage] : undefined;
    if (s?.isWon) { wonCount++; wonValue += amount; }
    else if (s?.isLost) { lostCount++; }
    else { openCount++; openValue += amount; }
  }
  const avgTicket = wonCount ? wonValue / wonCount : 0;

  // ---- Funnel por etapa ----
  const byStage: Record<string, { stage: string; order: number; value: number; count: number }> = {};
  for (const d of deals) {
    const id = d.properties.dealstage || 'unknown';
    const info = stageMap[id];
    const key = info?.label || id;
    if (!byStage[key]) byStage[key] = { stage: key, order: info?.order ?? 99, value: 0, count: 0 };
    byStage[key].value += parseFloat(d.properties.amount || '0') || 0;
    byStage[key].count += 1;
  }
  const funnel = Object.values(byStage).sort((a, b) => a.order - b.order);

  // ---- Contactos creados por mes ----
  const byMonth: Record<string, number> = {};
  for (const c of contactsData?.results || []) {
    const cd = c.properties.createdate;
    if (!cd) continue;
    const d = new Date(cd);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  }
  const contactsTrend = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count }));

  // ---- Carga de tareas ----
  const tasks = tasksData?.results || [];
  const taskBuckets: Record<string, number> = { Completadas: 0, Pendientes: 0, Vencidas: 0 };
  for (const t of tasks) {
    const status = t.properties.hs_task_status;
    if (status === 'COMPLETED') { taskBuckets.Completadas++; continue; }
    const due = t.properties.hs_timestamp ? new Date(t.properties.hs_timestamp).getTime() : null;
    if (due && due < Date.now()) taskBuckets.Vencidas++;
    else taskBuckets.Pendientes++;
  }
  const taskPie = Object.entries(taskBuckets).map(([name, value]) => ({ name, value }));

  // ---- Deals estancados ----
  const stale = deals
    .filter((d) => {
      const s = d.properties.dealstage ? stageMap[d.properties.dealstage] : undefined;
      const days = daysSince(d.properties.hs_lastmodifieddate);
      return !s?.isClosed && days != null && days > STALE_DAYS;
    })
    .sort((a, b) => (daysSince(b.properties.hs_lastmodifieddate) || 0) - (daysSince(a.properties.hs_lastmodifieddate) || 0));

  return (
    <>
      <div className="grid cols-4">
        <Card big={money(openValue)} lbl="Valor del pipeline abierto" />
        <Card big={String(openCount)} lbl="Deals abiertos" />
        <Card big={`${wonCount} / ${lostCount}`} lbl="Ganados / Perdidos" />
        <Card big={money(avgTicket)} lbl="Ticket promedio (ganados)" />
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <h2>Funnel de pipeline (valor por etapa)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnel} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
              <XAxis dataKey="stage" tick={{ fill: '#8b93a7', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fill: '#8b93a7', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#171a21', border: '1px solid #2a2f3a' }}
                formatter={(v: number, _n, p) => [`${money(v)} · ${p.payload.count} deals`, 'Valor']} />
              <Bar dataKey="value" fill="#ff7a59" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h2>Carga de tareas</h2>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={taskPie} dataKey="value" nameKey="name" outerRadius={100} label>
                {taskPie.map((_e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Legend />
              <Tooltip contentStyle={{ background: '#171a21', border: '1px solid #2a2f3a' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <h2>Contactos creados en el tiempo</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={contactsTrend} margin={{ left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="month" tick={{ fill: '#8b93a7', fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: '#8b93a7', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#171a21', border: '1px solid #2a2f3a' }} />
            <Line type="monotone" dataKey="count" stroke="#4f8cff" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>Deals estancados <span className="muted">(abiertos, sin cambios hace +{STALE_DAYS} días)</span></h2>
        <table>
          <thead><tr><th>Deal</th><th className="num">Monto</th><th>Últ. modif.</th><th className="num">Días sin tocar</th></tr></thead>
          <tbody>
            {stale.map((d) => (
              <tr key={d.id}>
                <td>{d.properties.dealname || '(sin nombre)'}</td>
                <td className="num">{money(d.properties.amount)}</td>
                <td className="muted">{date(d.properties.hs_lastmodifieddate)}</td>
                <td className="num"><span className="badge red">{daysSince(d.properties.hs_lastmodifieddate)}</span></td>
              </tr>
            ))}
            {stale.length === 0 && <tr><td colSpan={4} className="empty">No hay deals estancados 🎉</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
