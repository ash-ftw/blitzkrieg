import type { AuditLogEntry } from "@blitzkrieg/shared";

const logs: AuditLogEntry[] = [];

export function addAuditLog(actor: string, action: string, target?: string, details: string = "") {
  const entry: AuditLogEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: new Date().toLocaleTimeString(),
    actor,
    action,
    target,
    details
  };

  logs.unshift(entry);
  if (logs.length > 100) {
    logs.pop();
  }

  return entry;
}

export function getAuditLogs(): AuditLogEntry[] {
  return [...logs];
}
