import { useMemo, useState } from 'react';
import { useContacts, useDeals, useTasks, useOwners, usePipelines, buildOwnerMap, buildStageMap } from '../hooks';
import { ownerLabel, distinctOwnerIds } from '../owners';
import { money, date, dateTime } from '../format';

function Kpi({ big, lbl }: { big: string; lbl: string }) {
  return <div className="kpi"><div className="big">{big}</div><div className="lbl">{lbl}</div></div>;
}

export default function OwnerDashboard() {
  const { data: contactsData, isLoading } = useContacts();
  const { data: dealsData } = useDeals();
  const { data: tasksData } = useTasks();
  const { data: owners } = useOwners();
  const { data: pipelines } = usePipelines();
  const ownerMap = buildOwnerMap(owners?.results);
  const stageMap = buildStageMap(pipelines?.results);

  const contacts = contactsData?.results || [];
  const deals = dealsData?.results || [];
  const tasks = tasksData?.results || [];

  const ownerIds = useMemo(
    () => distinctOwnerIds(contacts, deals, tasks).sort(),
    [contacts, deals, tasks],
  );

  const [selected, setSelected] = useState<string>('');
  const current = selected || ownerIds[0] || '';

  if (isLoading) return <div className="empty">Cargando…</div>;
  if (ownerIds.length === 0) return <div className="panel empty">No hay propietarios asignados en los datos.</div>;

  const myContacts = contacts.filter((c) => c.properties.hubspot_owner_id === current);
  const myDeals = deals.filter((d) => d.properties.hubspot_owner_id === current);
  const myTasks = tasks.filter((t) => t.properties.hubspot_owner_id === current);

  let openValue = 0, openCount = 0, wonCount = 0;
  for (const d of myDeals) {
    const s = d.properties.dealstage ? stageMap[d.properties.dealstage] : undefined;
    if (s?.isWon) wonCount++;
    else if (!s?.isClosed) { openCount++; openValue += parseFloat(d.properties.amount || '0') || 0; }
  }
  const pendingTasks = myTasks.filter((t) => t.properties.hs_task_status !== 'COMPLETED').length;

  return (
    <>
      <div className="panel">
        <h2>Dashboard por vendedor</h2>
        <label className="muted" style={{ marginRight: 8 }}>Propietario:</label>
        <select value={current} onChange={(e) => setSelected(e.target.value)}
          style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          {ownerIds.map((id) => <option key={id} value={id}>{ownerLabel(id, ownerMap)}</option>)}
        </select>
        {!owners && <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
          (agregá el scope <code>crm.objects.owners.read</code> para ver nombres en vez de IDs)
        </span>}
      </div>

      <div className="grid cols-4">
        <Kpi big={String(myContacts.length)} lbl="Contactos" />
        <Kpi big={`${openCount} · ${money(openValue)}`} lbl="Deals abiertos · valor" />
        <Kpi big={String(wonCount)} lbl="Deals ganados" />
        <Kpi big={String(pendingTasks)} lbl="Tareas pendientes" />
      </div>

      <div className="panel">
        <h2>Deals de {ownerLabel(current, ownerMap)} <span className="muted">({myDeals.length})</span></h2>
        <table>
          <thead><tr><th>Deal</th><th>Etapa</th><th className="num">Monto</th><th>Cierre</th></tr></thead>
          <tbody>
            {myDeals.map((d) => {
              const s = d.properties.dealstage ? stageMap[d.properties.dealstage] : undefined;
              const cls = s?.isWon ? 'green' : s?.isLost ? 'red' : 'blue';
              return (
                <tr key={d.id}>
                  <td>{d.properties.dealname || '(sin nombre)'}</td>
                  <td><span className={`badge ${cls}`}>{s?.label || d.properties.dealstage || '—'}</span></td>
                  <td className="num">{money(d.properties.amount)}</td>
                  <td className="muted">{date(d.properties.closedate)}</td>
                </tr>
              );
            })}
            {myDeals.length === 0 && <tr><td colSpan={4} className="empty">Sin deals</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <h2>Tareas <span className="muted">({myTasks.length})</span></h2>
          <table>
            <thead><tr><th>Asunto</th><th>Estado</th><th>Vencimiento</th></tr></thead>
            <tbody>
              {myTasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.properties.hs_task_subject || '(sin asunto)'}</td>
                  <td>{t.properties.hs_task_status || '—'}</td>
                  <td className="muted">{dateTime(t.properties.hs_timestamp)}</td>
                </tr>
              ))}
              {myTasks.length === 0 && <tr><td colSpan={3} className="empty">Sin tareas</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Contactos <span className="muted">({myContacts.length})</span></h2>
          <table>
            <thead><tr><th>Nombre</th><th>Email</th><th>Últ. modif.</th></tr></thead>
            <tbody>
              {myContacts.map((c) => (
                <tr key={c.id}>
                  <td>{[c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || '(sin nombre)'}</td>
                  <td className="muted">{c.properties.email || '—'}</td>
                  <td className="muted">{dateTime(c.properties.lastmodifieddate)}</td>
                </tr>
              ))}
              {myContacts.length === 0 && <tr><td colSpan={3} className="empty">Sin contactos</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
