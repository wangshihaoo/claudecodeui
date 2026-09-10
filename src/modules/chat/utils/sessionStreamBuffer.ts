type SessionStreamBufferEntry = {
  text: string;
  timerId: number | null;
};

/** A snapshot returned while clearing all per-session stream state. */
export type SessionStreamBufferSnapshot = {
  sessionId: string;
  text: string;
  timerId: number | null;
};

/**
 * Keeps streaming text and its flush timer isolated by application session id.
 * The chat realtime handler owns scheduling; this utility owns only the keyed
 * state so switching sessions cannot reuse another session's buffer or timer.
 */
export type SessionStreamBuffer = {
  append: (sessionId: string, text: string) => void;
  read: (sessionId: string) => string;
  getTimer: (sessionId: string) => number | null;
  setTimer: (sessionId: string, timerId: number) => void;
  clearTimer: (sessionId: string) => number | null;
  take: (sessionId: string) => string;
  clearSession: (sessionId: string) => SessionStreamBufferSnapshot | null;
  clearAll: () => SessionStreamBufferSnapshot[];
};

/** Creates the keyed stream state used by one mounted ChatInterface. */
export function createSessionStreamBuffer(): SessionStreamBuffer {
  const entries = new Map<string, SessionStreamBufferEntry>();

  const getOrCreate = (sessionId: string): SessionStreamBufferEntry => {
    const existing = entries.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: SessionStreamBufferEntry = { text: '', timerId: null };
    entries.set(sessionId, created);
    return created;
  };

  return {
    append: (sessionId, text) => {
      if (!sessionId || !text) {
        return;
      }
      getOrCreate(sessionId).text += text;
    },
    read: (sessionId) => entries.get(sessionId)?.text ?? '',
    getTimer: (sessionId) => entries.get(sessionId)?.timerId ?? null,
    setTimer: (sessionId, timerId) => {
      getOrCreate(sessionId).timerId = timerId;
    },
    clearTimer: (sessionId) => {
      const entry = entries.get(sessionId);
      if (!entry) {
        return null;
      }
      const timerId = entry.timerId;
      entry.timerId = null;
      return timerId;
    },
    take: (sessionId) => {
      const text = entries.get(sessionId)?.text ?? '';
      entries.delete(sessionId);
      return text;
    },
    clearSession: (sessionId) => {
      const entry = entries.get(sessionId);
      if (!entry) {
        return null;
      }

      const snapshot = { sessionId, text: entry.text, timerId: entry.timerId };
      entries.delete(sessionId);
      return snapshot;
    },
    clearAll: () => {
      const snapshots = Array.from(entries, ([sessionId, entry]) => ({
        sessionId,
        text: entry.text,
        timerId: entry.timerId,
      }));
      entries.clear();
      return snapshots;
    },
  };
}
