export interface SessionLog {
  id: string;
  resourceId?: string;
  timestamp: number;
  type: 'compliance' | 'activity' | 'meeting';
  category: string;
  isCameraOn: boolean;
  message: string;
  confidence: string;
  thumbnail?: string; // Base64 screenshot
}

export interface RecordedSession {
  id: string;
  resourceId: string;
  startTime: number;
  duration: number; // in seconds
  status: 'processing' | 'secure' | 'expired';
  fileSize: string;
  expiryTime: number; // timestamp
  logs: SessionLog[]; // History of AI analysis for this session
  videoUrl?: string; // Blob URL for playback
}

export interface ResourceUser {
  id: string;
  username: string;
  password: string;
  createdAt: number;
}

export enum MonitoringState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  UPLOADING = 'UPLOADING',
}

export interface AnalysisResult {
  summary: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
}