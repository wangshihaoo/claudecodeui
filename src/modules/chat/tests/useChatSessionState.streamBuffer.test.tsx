import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};

const buildMessage = (sessionId: string): NormalizedMessage => ({
  id: `m-${sessionId}`,
  kind: 'text',
  role: 'assistant',
  provider: 'claude',
  sessionId,
  content: `message for ${sessionId}`,
  timestamp: '2026-01-01T00:00:00.000Z',
} as NormalizedMessage);

function createStore() {
  const messagesBySession = new Map<string, NormalizedMessage[]>([
    [SESSION_A, [buildMessage(SESSION_A)]],
    [SESSION_B, [buildMessage(SESSION_B)]],
  ]);

  const slotFor = (sessionId: string) => ({
    fetchedAt: 1,
    status: 'idle' as const,
    total: messagesBySession.get(sessionId)?.length ?? 0,
    hasMore: false,
    offset: messagesBySession.get(sessionId)?.length ?? 0,
  });

  return {
    fetchFromServer: vi.fn(async (sessionId: string) => slotFor(sessionId)),
    fetchMore: vi.fn(async (sessionId: string) => ({ slot: slotFor(sessionId), prependedCount: 0 })),
    appendRealtime: vi.fn(),
    refreshLatestFromServer: vi.fn(async (sessionId: string) => ({
      slot: slotFor(sessionId),
      applied: true,
      changed: false,
      deferred: false,
    })),
    setActiveSession: vi.fn(),
    isStale: vi.fn(() => false),
    updateStreaming: vi.fn(),
    finalizeStreaming: vi.fn(),
    getMessages: vi.fn((sessionId: string) => messagesBySession.get(sessionId) ?? []),
    getSessionSlot: vi.fn((sessionId: string) => slotFor(sessionId)),
  };
}

type HookProps = {
  session: ProjectSession | null;
  newSessionTrigger: number;
};

async function renderChatSessionState(options: {
  session: ProjectSession | null;
  newSessionTrigger?: number;
  resetStreamingState: ReturnType<typeof vi.fn>;
  store?: ReturnType<typeof createStore>;
}) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  const store = options.store ?? createStore();

  return renderHook(
    ({ session, newSessionTrigger }: HookProps) =>
      useChatSessionState({
        isActive: true,
        selectedProject: project,
        selectedSession: session,
        ws: null,
        sendMessage: vi.fn(),
        newSessionTrigger,
        resetStreamingState: options.resetStreamingState,
        statusCheckSentAtRef: { current: new Map() },
        lastSeqRef: { current: new Map() },
        sessionStore: store as never,
      }),
    {
      initialProps: {
        session: options.session,
        newSessionTrigger: options.newSessionTrigger ?? 0,
      },
    },
  );
}

function calledClearAll(resetStreamingState: ReturnType<typeof vi.fn>): boolean {
  return resetStreamingState.mock.calls.some((args) => args[1] === true);
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('New Session does not call clearAll on stream buffers', async () => {
  const resetStreamingState = vi.fn();
  const { rerender } = await renderChatSessionState({
    session: { id: SESSION_A } as ProjectSession,
    newSessionTrigger: 0,
    resetStreamingState,
  });

  resetStreamingState.mockClear();

  await act(async () => {
    rerender({
      session: { id: SESSION_A } as ProjectSession,
      newSessionTrigger: 1,
    });
  });

  assert.equal(calledClearAll(resetStreamingState), false);
  assert.equal(resetStreamingState.mock.calls.length, 0);
});

test('switching sessions does not clear the newly selected session buffer', async () => {
  const resetStreamingState = vi.fn();
  const { rerender } = await renderChatSessionState({
    session: { id: SESSION_A } as ProjectSession,
    resetStreamingState,
  });

  resetStreamingState.mockClear();

  await act(async () => {
    rerender({
      session: { id: SESSION_B } as ProjectSession,
      newSessionTrigger: 0,
    });
  });

  assert.equal(calledClearAll(resetStreamingState), false);
  assert.equal(
    resetStreamingState.mock.calls.some((args) => args[0] === SESSION_B),
    false,
  );
  assert.equal(resetStreamingState.mock.calls.length, 0);
});

test('New Session while leaving a session still does not clear every buffer', async () => {
  const resetStreamingState = vi.fn();
  const { rerender } = await renderChatSessionState({
    session: { id: SESSION_A } as ProjectSession,
    newSessionTrigger: 0,
    resetStreamingState,
  });

  resetStreamingState.mockClear();

  await act(async () => {
    rerender({
      session: null,
      newSessionTrigger: 1,
    });
  });

  assert.equal(calledClearAll(resetStreamingState), false);
  assert.equal(
    resetStreamingState.mock.calls.some((args) => args[0] === SESSION_B),
    false,
  );
});
