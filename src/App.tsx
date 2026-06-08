import { useState } from 'react';
import MetaBar from './components/MetaBar';
import Basics from './components/Basics';
import Creative from './components/Creative';
import OwnerDashboard from './components/OwnerDashboard';
import PipelineBoard from './components/PipelineBoard';
import Adoption from './components/Adoption';

type Tab = 'basics' | 'creative' | 'owner' | 'pipeline' | 'adoption';

const TABS: { id: Tab; label: string }[] = [
  { id: 'basics', label: 'Básicos' },
  { id: 'creative', label: 'Dashboard' },
  { id: 'owner', label: 'Por vendedor' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'adoption', label: 'Adopción' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('basics');

  return (
    <div className="app">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1>🛰️ HubSpot Viewer</h1>
        <span className="muted">Demo de integración con HubSpot CRM · datos en tiempo real con cache</span>
      </div>

      <MetaBar />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'basics' && <Basics />}
      {tab === 'creative' && <Creative />}
      {tab === 'owner' && <OwnerDashboard />}
      {tab === 'pipeline' && <PipelineBoard />}
      {tab === 'adoption' && <Adoption />}
    </div>
  );
}
