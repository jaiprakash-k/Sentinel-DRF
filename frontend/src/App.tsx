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
    <div className="card card--glass">
      <div className="card__header">
        <h2 className="card__title">⚡ Execute New Flow</h2>
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
          <label className="form-label" htmlFor="flow-desc">Description</label>
          <textarea
            id="flow-desc"
            className="form-textarea"
            placeholder="Describe the flow execution context…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="dropzone" style={{ marginBottom: '1.25rem' }}>
          <div className="dropzone__icon">📂</div>
          <div className="dropzone__text">
            Drop a file here or <span className="dropzone__highlight">click to browse</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            File will be uploaded to MinIO via File Service
          </div>
        </div>

        <button
          className="btn btn--primary btn--lg btn--full"
          type="submit"
          disabled={executing || !title.trim()}
        >
          {executing ? (
            <>
              <span className="spinner" /> Executing Flow…
            </>
          ) : (
            <>🚀 Execute Flow</>
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

  const statusClass = `badge--${flow.status}`;

  return (
    <div
      className={`flow-entry ${isExpanded ? 'flow-entry--expanded' : ''}`}
      onClick={() => setExpandedFlowId(isExpanded ? null : flow.flowId)}
    >
      <div className="flow-entry__header">
        <div>
          <div className="flow-entry__id">{flow.flowId}</div>
          <div className="flow-entry__meta">
            <span className={`badge ${statusClass}`}>
              {flow.status === 'running' && '⏳'}
              {flow.status === 'completed' && '✓'}
              {flow.status === 'failed' && '✗'}
              {flow.status === 'replaying' && '🔁'}
              {' '}{flow.status}
            </span>
            {flow.replayCount > 0 && (
              <span className="badge badge--replaying" style={{ animation: 'none' }}>
                🔁 {flow.replayCount} replay{flow.replayCount > 1 ? 's' : ''}
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
            {isReplaying ? (
              <>
                <span className="spinner" /> Replaying…
              </>
            ) : (
              <>🔁 Replay</>
            )}
          </button>
        )}
      </div>

      {/* Steps Timeline */}
      {isExpanded && flow.steps.length > 0 && (
        <div className="steps-timeline">
          <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Execution Steps
          </h4>
          {flow.steps.map((step, i) => (
            <div className="step-item" key={i}>
              <div className={`step-dot step-dot--${step.status}`}>
                {step.status === 'success' ? '✓' : '✗'}
              </div>
              <div className="step-info">
                <div className="step-name">{step.stepName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                {step.error && (
                  <div className="step-detail" style={{ color: 'var(--accent-danger)' }}>
                    Error: {step.error}
                  </div>
                )}
                {step.result && (
                  <div className="step-detail">
                    {JSON.stringify(step.result).slice(0, 100)}
                    {JSON.stringify(step.result).length > 100 ? '…' : ''}
                  </div>
                )}
                <div className="step-detail" style={{ opacity: 0.6 }}>
                  {new Date(step.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Logs Panel ──────────────────────────────────────────────
function LogsPanel() {
  const { flows, loading, fetchFlows } = useStore();

  useEffect(() => {
    fetchFlows();
    const interval = setInterval(fetchFlows, 5000);
    return () => clearInterval(interval);
  }, [fetchFlows]);

  const totalFlows = flows.length;
  const completedFlows = flows.filter(f => f.status === 'completed').length;
  const failedFlows = flows.filter(f => f.status === 'failed').length;
  const replayedFlows = flows.filter(f => f.replayCount > 0).length;

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__value">{totalFlows}</div>
          <div className="stat-card__label">Total Flows</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {completedFlows}
          </div>
          <div className="stat-card__label">Completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {failedFlows}
          </div>
          <div className="stat-card__label">Failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value" style={{ background: 'linear-gradient(135deg, #a855f7, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {replayedFlows}
          </div>
          <div className="stat-card__label">Replayed</div>
        </div>
      </div>

      {/* Flow List */}
      <div className="card card--glass">
        <div className="card__header">
          <h2 className="card__title">📋 Execution Logs</h2>
          <button className="btn btn--outline btn--sm" onClick={fetchFlows} disabled={loading}>
            {loading ? <span className="spinner" /> : '↻'} Refresh
          </button>
        </div>

        {flows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">📭</div>
            <div className="empty-state__text">No execution logs yet</div>
            <div className="empty-state__sub">Execute a flow to see entries here</div>
          </div>
        ) : (
          <div className="flow-list">
            {flows.map(flow => (
              <FlowEntry key={flow.flowId} flow={flow} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Replay Panel ────────────────────────────────────────────
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
      {/* Queue Panel */}
      <div className="queue-panel">
        <div className="queue-panel__info">
          <div className="queue-panel__icon">🔁</div>
          <div>
            <div className="queue-panel__text">
              Replay Queue: <span className="queue-panel__count">{queueInfo.queueSize}</span> pending
            </div>
          </div>
        </div>
        <button
          className="btn btn--replay btn--sm"
          onClick={handleProcessQueue}
          disabled={processing || queueInfo.queueSize === 0}
        >
          {processing ? (
            <>
              <span className="spinner" /> Processing…
            </>
          ) : (
            <>⚡ Process Queue</>
          )}
        </button>
      </div>

      {/* Failed Flows */}
      <div className="card card--glass">
        <div className="card__header">
          <h2 className="card__title">🔴 Failed Flows</h2>
          <span className="badge badge--failed">{failedFlows.length} failed</span>
        </div>

        {failedFlows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">🎉</div>
            <div className="empty-state__text">No failed flows</div>
            <div className="empty-state__sub">All flows have completed successfully</div>
          </div>
        ) : (
          <div className="flow-list">
            {failedFlows.map(flow => (
              <FlowEntry key={flow.flowId} flow={flow} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toast Container ─────────────────────────────────────────
function Toasts() {
  const { toasts, removeToast } = useStore();
  return (
    <>
      {toasts.map((toast, i) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type}`}
          style={{ bottom: `${2 + i * 4}rem` }}
          onClick={() => removeToast(toast.id)}
        >
          {toast.type === 'success' && '✓ '}
          {toast.type === 'error' && '✗ '}
          {toast.type === 'info' && 'ℹ '}
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
      {/* Header */}
      <header className="app-header">
        <div className="app-header__logo">
          <div className="app-header__icon">🛡️</div>
          <div>
            <div className="app-header__title">Sentinel DRF</div>
            <div className="app-header__subtitle">Deterministic Replay Fabric</div>
          </div>
        </div>
        <div className="app-header__status">
          <span className="status-dot" />
          System Online
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'execute' ? 'nav-tab--active' : ''}`}
          onClick={() => setActiveTab('execute')}
        >
          ⚡ Execute
        </button>
        <button
          className={`nav-tab ${activeTab === 'logs' ? 'nav-tab--active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          📋 Logs
          {flows.length > 0 && (
            <span className="nav-tab__badge">{flows.length}</span>
          )}
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
