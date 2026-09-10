import { useEffect, useRef, useState } from 'react';

import { api, authenticatedFetch } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';

export type SessionMessageMatch = {
  sessionId: string;
  label: string;
  snippet: string;
  provider: LLMProvider;
};

type ProjectResult = {
  projectId: string | null;
  projectName: string;
  sessions: Array<{
    sessionId: string;
    provider: LLMProvider;
    sessionSummary: string;
    matches: Array<{ snippet: string }>;
  }>;
};

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

export function useSessionMessageSearch(
  projectId: string | undefined,
  query: string,
  enabled: boolean,
) {
  const [items, setItems] = useState<SessionMessageMatch[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !projectId || trimmed.length < MIN_QUERY) {
      setItems([]);
      seqRef.current++;
      return;
    }

    seqRef.current++;

    const handle = setTimeout(() => {
      const seq = ++seqRef.current;
      const url = api.searchConversationsUrl(trimmed);
      void authenticatedFetch(url)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Search failed with status ${response.status}`);
          const data = await response.json() as { results?: ProjectResult[] };
          if (seq !== seqRef.current) return;

          const projectResult = data.results?.find((result) => result.projectId === projectId);
          const nextItems = projectResult?.sessions.map((session) => ({
            sessionId: session.sessionId,
            label: session.sessionSummary || session.sessionId,
            snippet: session.matches[0]?.snippet ?? '',
            provider: session.provider,
          })) ?? [];
          setItems(nextItems);
        })
        .catch(() => {
          if (seq === seqRef.current) setItems([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      seqRef.current++;
    };
  }, [projectId, query, enabled]);

  return items;
}
