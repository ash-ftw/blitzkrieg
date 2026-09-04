export type Role = "HOST" | "PARTICIPANT";

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  participantCode: string | null;
  stationCode: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
  stationCode?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  expiresAt: string;
}

export type ContestStatus =
  | "DRAFT"
  | "READY"
  | "ROUND_1"
  | "ROUND_1_COMPLETE"
  | "QUALIFICATION"
  | "ROUND_2"
  | "ROUND_2_COMPLETE"
  | "FINALIZED";

export type StationStatus =
  | "OFFLINE"
  | "AVAILABLE"
  | "ASSIGNED"
  | "READY"
  | "TYPING"
  | "SUBMITTED"
  | "DISQUALIFIED"
  | "TECHNICAL_ISSUE";

export type ViolationType =
  | "TAB_SWITCH"
  | "WINDOW_BLUR"
  | "COPY"
  | "PASTE"
  | "CUT"
  | "CONTEXT_MENU"
  | "PAGE_REFRESH"
  | "NAVIGATION"
  | "FULLSCREEN_EXIT"
  | "MULTIPLE_SESSION"
  | "RESTART_ATTEMPT"
  | "UNAUTHORIZED_STATION";

export interface StationSnapshot {
  stationCode: string;
  participantCode: string | null;
  status: StationStatus;
  wpm: number | null;
  accuracy: number | null;
  score: number | null;
  lastHeartbeatSecondsAgo: number | null;
}

export interface Passage {
  id: string;
  title: string;
  content: string;
  round: 1 | 2;
  difficulty: "MEDIUM" | "HARD";
  wordCount: number;
  characterCount: number;
}

export interface AttemptSubmissionRequest {
  typedText: string;
  durationMs: number;
}

export interface AttemptResult {
  participantCode: string;
  stationCode: string;
  round: 1 | 2;
  wpm: number;
  accuracy: number;
  score: number;
  totalErrors: number;
  submittedAt: string;
}

export interface IncidentReport {
  id: string;
  participantCode: string;
  stationCode: string;
  type: ViolationType;
  timestamp: string;
  details: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target?: string;
  details: string;
}

export interface QualificationSummary {
  qualifierCount: number;
  qualifiers: string[];
}

export interface ContestSnapshot {
  name: string;
  status: ContestStatus;
  round: 1 | 2;
  durationSeconds: number;
  remainingSeconds: number;
  isLocked: boolean;
  qualifierCount: number;
  qualifiers: string[];
  activePassage: Passage | null;
  connectedStations: number;
  readyStations: number;
  typingStations: number;
  submittedStations: number;
  disqualifiedStations: number;
  offlineStations: number;
  stations: StationSnapshot[];
  incidents: IncidentReport[];
  auditLogs: AuditLogEntry[];
}


