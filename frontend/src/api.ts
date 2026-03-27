import axios from 'axios';

const API_BASE = '/api';

export interface StepResult {
  stepName: string;
  status: 'success' | 'failed';
  result?: any;
  error?: string;
  timestamp: string;
}

export interface FlowLog {
  flowId: string;
  status: 'running' | 'completed' | 'failed' | 'replaying';
  steps: StepResult[];
  replayCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReplayQueueInfo {
  queueSize: number;
}

export interface ReplayProcessResult {
  processed: number;
  results: FlowLog[];
}

const api = {
  // Execute a new flow
  executeFlow: async (title: string, description: string, file: File): Promise<FlowLog> => {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('file', file);

    const res = await axios.post(`${API_BASE}/flows/execute`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  },

  // Get all flows
  getFlows: async (): Promise<FlowLog[]> => {
    const res = await axios.get(`${API_BASE}/flows`);
    return res.data;
  },

  // Get a single flow
  getFlow: async (flowId: string): Promise<FlowLog> => {
    const res = await axios.get(`${API_BASE}/flows/${flowId}`);
    return res.data;
  },

  // Trigger replay for a flow
  replayFlow: async (flowId: string): Promise<FlowLog> => {
    const res = await axios.post(`${API_BASE}/flows/${flowId}/replay`);
    return res.data;
  },

  // Get replay queue info
  getReplayQueue: async (): Promise<ReplayQueueInfo> => {
    const res = await axios.get(`${API_BASE}/replay/queue`);
    return res.data;
  },

  // Process entire replay queue
  processReplayQueue: async (): Promise<ReplayProcessResult> => {
    const res = await axios.post(`${API_BASE}/replay/process`);
    return res.data;
  },
};

export default api;
