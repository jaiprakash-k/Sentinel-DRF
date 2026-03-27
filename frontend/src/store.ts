import { create } from 'zustand';
import api, { FlowLog, ReplayQueueInfo } from './api';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AppState {
  // Active tab
  activeTab: 'execute' | 'logs' | 'replay';
  setActiveTab: (tab: 'execute' | 'logs' | 'replay') => void;

  // Flows
  flows: FlowLog[];
  loading: boolean;
  fetchFlows: () => Promise<void>;

  // Execute
  executing: boolean;
  executeFlow: (title: string, description: string) => Promise<FlowLog | null>;

  // Replay
  replayingFlowId: string | null;
  replayFlow: (flowId: string) => Promise<FlowLog | null>;
  queueInfo: ReplayQueueInfo;
  fetchQueueInfo: () => Promise<void>;
  processQueue: () => Promise<void>;

  // Expanded flow
  expandedFlowId: string | null;
  setExpandedFlowId: (id: string | null) => void;

  // Toast notifications
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;
}

const useStore = create<AppState>((set, get) => ({
  activeTab: 'execute',
  setActiveTab: (tab) => set({ activeTab: tab }),

  flows: [],
  loading: false,
  fetchFlows: async () => {
    set({ loading: true });
    try {
      const flows = await api.getFlows();
      set({ flows, loading: false });
    } catch (err) {
      set({ loading: false });
      get().addToast('error', 'Failed to fetch flows');
    }
  },

  executing: false,
  executeFlow: async (title, description) => {
    set({ executing: true });
    try {
      const flow = await api.executeFlow(title, description);
      set({ executing: false });
      get().addToast(
        flow.status === 'completed' ? 'success' : 'info',
        flow.status === 'completed'
          ? `Flow ${flow.flowId.slice(0, 8)}… completed successfully`
          : `Flow ${flow.flowId.slice(0, 8)}… finished with status: ${flow.status}`
      );
      get().fetchFlows();
      get().fetchQueueInfo();
      return flow;
    } catch (err) {
      set({ executing: false });
      get().addToast('error', 'Failed to execute flow');
      return null;
    }
  },

  replayingFlowId: null,
  replayFlow: async (flowId) => {
    set({ replayingFlowId: flowId });
    try {
      const flow = await api.replayFlow(flowId);
      set({ replayingFlowId: null });
      get().addToast(
        flow.status === 'completed' ? 'success' : 'info',
        `Replay of ${flowId.slice(0, 8)}… → ${flow.status}`
      );
      get().fetchFlows();
      get().fetchQueueInfo();
      return flow;
    } catch (err) {
      set({ replayingFlowId: null });
      get().addToast('error', `Replay failed for ${flowId.slice(0, 8)}…`);
      return null;
    }
  },

  queueInfo: { queueSize: 0 },
  fetchQueueInfo: async () => {
    try {
      const info = await api.getReplayQueue();
      set({ queueInfo: info });
    } catch {
      // Silent
    }
  },
  processQueue: async () => {
    try {
      const result = await api.processReplayQueue();
      get().addToast('success', `Processed ${result.processed} queued replays`);
      get().fetchFlows();
      get().fetchQueueInfo();
    } catch {
      get().addToast('error', 'Failed to process replay queue');
    }
  },

  expandedFlowId: null,
  setExpandedFlowId: (id) => set({ expandedFlowId: id }),

  toasts: [],
  addToast: (type, message) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => get().removeToast(id), 4000);
  },
  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export default useStore;
