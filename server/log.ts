import type {LogLevel} from '../shared/model.js';

export interface LogEntry {
  at: number;
  level: LogLevel;
  text: string;
}

const MAX = 500;
const entries: LogEntry[] = [];

/** The panel's journal: kept in memory for the page and echoed to stdout. Never secrets. */
export function log(level: LogLevel, text: string) {
  entries.push({at: Date.now(), level, text});
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  if (level !== 'debug') console.log(`[${level}] ${text}`);
}

export const recentLog = () => entries.slice(-200);
