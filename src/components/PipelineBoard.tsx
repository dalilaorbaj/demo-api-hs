import { useState } from 'react';
import { useDeals, usePipelines, useOwners, buildOwnerMap } from '../hooks';
import { ownerLabel } from '../owners';
import { money } from '../format';
import type { HsRecord } from '../api';

export default function PipelineBoard() {
  const { data: dealsData, isLoading } = useDeals();
  const { data: pipelines } = usePipelines();
  const { data: owners } = useOwners();
  const ownerMap = buildOwnerMap(owners?.results);

  const [pipelineId, setPipelineId] = useState<string>('');
  const list = pipelines?.results || [];
  const current = list.find((p) => p.id === pipelineId) || list[0];

  if (isLoading) return <div className="empty">Cargando…</div>;
  if (!current) return <div className="panel empty">No hay pipelines.</div>;

  const deals = dealsData?.results || [];
  const stages = [...current.stages].sort((a, b) => a.displayOrder - b.displayOrder);

  const dealsByStage: Record<string, HsRecord[]> = {};
  for (const s of stages) dealsByStage[s.id] = [];
  for (const d of deals) {
    if (d.properties.pipeline && d.properties.pipeline !== current.id) continue;
    const sid = d.properties.dealstage || '';
    if (dealsByStage[sid]) dealsByStage[sid].push(d);
  }

  return (
    <>
      <div className="panel">
        <h2>Pipeline (vista kanban)</h2>
        <label className="muted" style={{ marginRight: 8 }}>Pipeline:</label>
        <select value={current.id} onChange={(e) => setPipelineId(e.target.value)}
          style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          {list.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
        {stages.map((s) => {
          const items = dealsByStage[s.id] || [];
          const total = items.reduce((sum, d) => sum + (parseFloat(d.properties.amount || '0') || 0), 0);
          const isWon = s.metadata?.probability === '1.0';
          const isLost = s.metadata?.isClosed === 'true' && !isWon;
          return (
            <div key={s.id} style={{ minWidth: 240, flex: '0 0 240px' }}>
              <div className="panel" style={{ margin: 0, height: '100%' }}>
                <h3 style={{ color: isWon ? 'var(--green)' : isLost ? 'var(--red)' : 'var(--muted)' }}>
                  {s.label}
                </h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  {items.length} deals · {money(total)}
                </div>
                {items.map((d) => (
                  <div key={d.id} className="kpi" style={{ marginBottom: 8, padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{d.properties.dealname || '(sin nombre)'}</div>
                    <div className="num" style={{ fontSize: 15, margin: '4px 0' }}>{money(d.properties.amount)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{ownerLabel(d.properties.hubspot_owner_id, ownerMap)}</div>
                  </div>
                ))}
                {items.length === 0 && <div className="muted" style={{ fontSize: 12 }}>—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
