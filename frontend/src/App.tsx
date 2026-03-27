import { useEffect, useState } from 'react';
import useStore from './store';
import type { FlowLog } from './api';

// ── Helper ──────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Status Badge ────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`badge badge--${status}`}>
      {label}
    </span>
  );
}

// ── Execute Flow Panel ──────────────────────────────────────
function ExecutePanel() {
  const { executing, executeFlow } = useStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await executeFlow(title.trim(), description.trim());
    setTitle('');
    setDescription('');
  };

  return (
    <div className="card">
      <div className="card__header">
        <h2>Execute New Flow</h2>
        <p className="text-quiet">Initiate a deterministic execution sequence with logging.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="flow-title">Flow Title</label>
          <input
            id="flow-title"
            className="form-input"
            type="text"
            placeholder="e.g. Process Invoice #1042"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="flow-desc">Description (Optional)</label>
          <textarea
            id="flow-desc"
            className="form-textarea"
            placeholder="Execution context and metadata…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="dropzone" style={{ marginBottom: '2rem' }}>
          <div className="dropzone__icon">📄</div>
          <div className="dropzone__text">
            Drop context files or <span style={{ color: 'var(--accent-secondary)', fontWeight: 600 }}>browse</span>
          </div>
          <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.6 }}>
            Files are stored deterministically for replay availability
          </p>
        </div>

        <button
          className="btn btn--primary btn--full"
          type="submit"
          disabled={executing || !title.trim()}
        >
          {executing ? (
            <>
              <span className="spinner" /> Executing…
            </>
          ) : (
            <>Execute Flow</>
          )}
        </button>
      </form>
    </div>
  );
}

// ── Flow Entry Component ────────────────────────────────────
function FlowEntry({ flow }: { flow: FlowLog }) {
  const { expandedFlowId, setExpandedFlowId, replayFlow, replayingFlowId } = useStore();
  const isExpanded = expandedFlowId === flow.flowId;
  const isReplaying = replayingFlowId === flow.flowId;

  return (
    <div
      className={`flow-entry ${isExpanded ? 'flow-entry--expanded' : ''}`}
      onClick={() => setExpandedFlowId(isExpanded ? null : flow.flowId)}
    >
      <div className="flow-entry__header">
        <div style={{ flex: 1 }}>
          <div className="flow-entry__id">{flow.flowId.slice(0, 18)}...</div>
          <div className="flow-entry__meta">
            <StatusBadge status={flow.status} />
            {flow.replayCount > 0 && (
              <span className="badge badge--replaying">
                {flow.replayCount} Replay{flow.replayCount > 1 ? 's' : ''}
              </span>
            )}
            <span className="flow-entry__time">{timeAgo(flow.createdAt)}</span>
          </div>
        </div>

        {flow.status === 'failed' && (
          <button
            className="btn btn--replay btn--sm"
            onClick={(e) => {
              e.stopPropagation();
              replayFlow(flow.flowId);
            }}
            disabled={isReplaying}
          >
            {isReplaying ? <span className="spinner" /> : 'Replay'}
          </button>
        )}
      </div>

      {isExpanded && flow.steps.length > 0 && (
        <div className="steps-timeline">
          <h4 style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tracing Pipeline
          </h4>
          {flow.steps.map((step, i) => (
            <div className="step-item" key={i}>
              <div className={`step-dot step-dot--${step.status}`} />
              <div className="step-info">
                <div className="step-name">{step.stepName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                {step.error ? (
                  <div className="step-detail" style={{ color: 'var(--accent-danger)' }}>
                    {step.error}
                  </div>
                ) : step.result ? (
                  <div className="step-detail">
                    {JSON.stringify(step.result).slice(0, 80)}
                    {JSON.stringify(step.result).length > 80 ? '…' : ''}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Panels ──────────────────────────────────────────────────
function LogsPanel() {
  const { flows, loading, fetchFlows } = useStore();

  useEffect(() => {
    fetchFlows();
    const interval = setInterval(fetchFlows, 5000);
    return () => clearInterval(interval);
  }, [fetchFlows]);

  const stats = {
    total: flows.length,
    completed: flows.filter(f => f.status === 'completed').length,
    failed: flows.filter(f => f.status === 'failed').length,
    replayed: flows.filter(f => f.replayCount > 0).length,
  };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__value">{stats.total}</div>
          <div className="stat-card__label">Total</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value" style={{ color: 'var(--accent-success)' }}>{stats.completed}</div>
          <div className="stat-card__label">Completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value" style={{ color: 'var(--accent-danger)' }}>{stats.failed}</div>
          <div className="stat-card__label">Failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value" style={{ color: 'var(--accent-primary)' }}>{stats.replayed}</div>
          <div className="stat-card__label">Replayed</div>
        </div>
      </div>

      <div className="card">
        <div className="card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Execution Logs</h2>
          <button className="btn btn--outline" onClick={fetchFlows} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Refresh'}
          </button>
        </div>

        {flows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__text">No flows recorded.</div>
            <p className="text-quiet">Execute your first flow to see traces here.</p>
          </div>
        ) : (
          <div className="flow-list">
            {flows.map(flow => <FlowEntry key={flow.flowId} flow={flow} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ReplayPanel() {
  const { flows, queueInfo, fetchQueueInfo, processQueue, fetchFlows } = useStore();
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchQueueInfo();
    fetchFlows();
    const interval = setInterval(() => {
      fetchQueueInfo();
      fetchFlows();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchQueueInfo, fetchFlows]);

  const failedFlows = flows.filter(f => f.status === 'failed');

  const handleProcessQueue = async () => {
    setProcessing(true);
    await processQueue();
    setProcessing(false);
  };

  return (
    <div>
      <div className="queue-panel">
        <div className="queue-panel__info">
          <div className="queue-panel__icon">🔁</div>
          <div className="queue-panel__text">
            Queue: <span className="queue-panel__count">{queueInfo.queueSize}</span> pending
          </div>
        </div>
        <button
          className="btn btn--primary btn--sm"
          onClick={handleProcessQueue}
          disabled={processing || queueInfo.queueSize === 0}
        >
          {processing ? <span className="spinner" /> : 'Process Queue'}
        </button>
      </div>

      <div className="card">
        <div className="card__header">
          <h2>Failed Recoveries</h2>
          <p className="text-quiet">Flows requiring manual or queue-based replay.</p>
        </div>

        {failedFlows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__text">Reliability intact.</div>
            <p className="text-quiet">No failed flows detected in the system.</p>
          </div>
        ) : (
          <div className="flow-list">
            {failedFlows.map(flow => <FlowEntry key={flow.flowId} flow={flow} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toasts ──────────────────────────────────────────────────
function Toasts() {
  const { toasts, removeToast } = useStore();
  return (
    <>
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" onClick={() => removeToast(toast.id)}>
          {toast.message}
        </div>
      ))}
    </>
  );
}

// ── Main App ────────────────────────────────────────────────
export default function App() {
  const { activeTab, setActiveTab, flows, queueInfo, fetchFlows, fetchQueueInfo } = useStore();

  useEffect(() => {
    fetchFlows();
    fetchQueueInfo();
  }, [fetchFlows, fetchQueueInfo]);

  const failedCount = flows.filter(f => f.status === 'failed').length;

  return (
    <div className="app-container">
      <header className="app-header">
        <div>
          <h1 className="app-header__title">Sentinel DRF</h1>
          <p className="app-header__subtitle">Deterministic Replay Fabric</p>
        </div>
        <div className="app-header__icon">🛡️</div>
      </header>

      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'execute' ? 'nav-tab--active' : ''}`}
          onClick={() => setActiveTab('execute')}
        >
          Execute
        </button>
        <button
          className={`nav-tab ${activeTab === 'logs' ? 'nav-tab--active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          Logs
          {flows.length > 0 && <span className="nav-tab__badge">{flows.length}</span>}
        </button>
        <button
          className={`nav-tab ${activeTab === 'replay' ? 'nav-tab--active' : ''}`}
          onClick={() => setActiveTab('replay')}
        >
          🔁 Replay
          {(failedCount > 0 || queueInfo.queueSize > 0) && (
            <span className="nav-tab__badge">
              {failedCount + queueInfo.queueSize}
            </span>
          )}
        </button>
      </nav>

      {/* Active View */}
      {activeTab === 'execute' && <ExecutePanel />}
      {activeTab === 'logs' && <LogsPanel />}
      {activeTab === 'replay' && <ReplayPanel />}

      {/* Toasts */}
      <Toasts />
    </div>
  );
}
