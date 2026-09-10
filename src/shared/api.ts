import {
  expireAuthSession,
  getStoredAuthToken,
  storeAuthToken,
} from '@/shared/authToken';
import { readVoiceConfig, voiceConfigHeaders } from '@/shared/voiceConfig';
import type {
  ApiKeyItem,
  FileTreeNode,
  GitCommitSummary,
  GithubCredentialItem,
  LLMProvider,
  NormalizedMessage,
  NotificationPreferencesState,
  Plugin,
  Project,
  ProjectSession,
  ProviderModelOption,
  ProviderModelsDefinition,
  PrdFile,
  ScheduledMessage,
  ServerEvent,
  WorktreeInfo,
} from '@/shared/types';

/** The browser-only demo account used by the local runtime. */
export const LOCAL_DEMO_USER = {
  id: 'local-demo-user',
  username: 'demo',
} as const;

/** A deliberately long-lived JWT-shaped token for the local demo account. */
export const LOCAL_DEMO_TOKEN =
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJsb2NhbC1kZW1vIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.local-demo-signature';

// Headers are a plain record rather than the full `HeadersInit` union so the
// defaults below can be merged with a caller's headers by spreading.
export type ApiRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

type LocalSessionRecord = {
  session: ProjectSession;
  messages: NormalizedMessage[];
  provider: LLMProvider;
  activeModel?: string;
  activeEffort?: string;
  isArchived?: boolean;
};

type LocalGitState = {
  branch: string;
  hasCommits: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  staged: string[];
  branches: string[];
  remote: {
    hasRemote: boolean;
    hasUpstream: boolean;
    branch: string;
    remoteBranch: string;
    remoteName: string | null;
    ahead: number;
    behind: number;
    isUpToDate: boolean;
  };
  commits: GitCommitSummary[];
  diffs: Record<string, string>;
  worktrees: WorktreeInfo[];
};

type LocalDraft = {
  text: string;
  queuedMessage?: unknown;
};

type LocalAsset = {
  dataUrl: string;
  mimeType: string;
  name: string;
  size: number;
};

type LocalApiState = {
  projects: Project[];
  archivedProjects: Project[];
  sessions: Record<string, LocalSessionRecord>;
  files: Record<string, Record<string, string>>;
  assets: Record<string, LocalAsset | string>;
  directories: Record<string, string[]>;
  filesystemDirectories: string[];
  scheduledMessages: ScheduledMessage[];
  preferences: Record<string, unknown>;
  drafts: Record<string, LocalDraft>;
  git: Record<string, LocalGitState>;
  providerModels: Record<LLMProvider, ProviderModelsDefinition>;
  providerSelections: Record<string, { model?: string; effort?: string }>;
  mcpServers: Record<string, unknown[]>;
  skills: Record<string, unknown[]>;
  plugins: Plugin[];
  apiKeys: ApiKeyItem[];
  credentials: GithubCredentialItem[];
  notificationPreferences: NotificationPreferencesState;
  browserUseSettings: { enabled: boolean };
  prdFiles: Record<string, PrdFile[]>;
};

type LocalEventListener = (event: ServerEvent) => void;

const LOCAL_STATE_STORAGE_KEY = 'cloudcli-local-runtime';
const DEMO_PROJECT_ID = 'demo-project';
const DEMO_SESSION_ID = 'demo-session';
const DEMO_PROJECT_PATH = '/workspace/cloudcli-demo';

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesState = {
  channels: { inApp: true, webPush: false, desktop: false, sound: true },
  events: { actionRequired: true, stop: true, error: true },
};

const DEFAULT_PROVIDER_MODELS: Record<LLMProvider, ProviderModelsDefinition> = {
  claude: {
    DEFAULT: 'default',
    OPTIONS: [
      { value: 'default', label: 'Claude Default', description: 'Local demo model' },
      { value: 'claude-sonnet', label: 'Claude Sonnet', effort: { values: ['low', 'medium', 'high'].map((value) => ({ value })) } },
    ],
  },
  cursor: {
    DEFAULT: 'gpt-5.3-codex',
    OPTIONS: [{ value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' }],
  },
  codex: {
    DEFAULT: 'gpt-5.4',
    OPTIONS: [{ value: 'gpt-5.4', label: 'GPT-5.4', effort: { values: ['low', 'medium', 'high', 'xhigh'].map((value) => ({ value })) } }],
  },
  opencode: {
    DEFAULT: 'anthropic/claude-sonnet-4-5',
    OPTIONS: [{ value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }],
  },
};

const DEFAULT_CAPABILITIES = [
  { provider: 'claude', permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'], defaultPermissionMode: 'default', supportsImages: true, supportsFiles: true, supportsAbort: true, supportsPermissionRequests: true, supportsTokenUsage: true, supportsEffort: true, supportsMessageEditing: true, supportsSessionForking: true },
  { provider: 'cursor', permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'], defaultPermissionMode: 'default', supportsImages: true, supportsFiles: true, supportsAbort: true, supportsPermissionRequests: false, supportsTokenUsage: true, supportsMessageEditing: false, supportsSessionForking: true },
  { provider: 'codex', permissionModes: ['default', 'acceptEdits', 'bypassPermissions'], defaultPermissionMode: 'default', supportsImages: true, supportsFiles: true, supportsAbort: true, supportsPermissionRequests: true, supportsTokenUsage: true, supportsEffort: true, supportsMessageEditing: true, supportsSessionForking: true },
  { provider: 'opencode', permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'], defaultPermissionMode: 'default', supportsImages: true, supportsFiles: true, supportsAbort: true, supportsPermissionRequests: true, supportsTokenUsage: true, supportsEffort: true, supportsMessageEditing: true, supportsSessionForking: true },
] as const;

const DEFAULT_COMMANDS = [
  { name: '/help', description: 'Show available local demo commands', namespace: 'builtin' },
  { name: '/models', description: 'Show available models', namespace: 'builtin' },
  { name: '/cost', description: 'Display token usage information', namespace: 'builtin' },
  { name: '/status', description: 'Display local runtime status', namespace: 'builtin' },
  { name: '/memory', description: 'Open the demo memory file', namespace: 'builtin' },
];

const createDemoMessages = (sessionId: string): NormalizedMessage[] => [{
  id: 'demo-welcome-message',
  sessionId,
  timestamp: new Date('2026-01-01T12:00:00.000Z').toISOString(),
  provider: 'claude',
  kind: 'text',
  role: 'assistant',
  content: 'Welcome to the local CloudCLI demo. Your projects, files, settings, and chat responses stay in this browser.',
  transcriptAnchorId: 'demo-welcome-anchor',
}];

const createDefaultFiles = (): Record<string, string> => ({
  'README.md': '# CloudCLI Local Demo\n\nThis workspace is powered by local fixture data.\n',
  'src/App.tsx': "export default function App() {\n  return <main>Hello from the local demo.</main>;\n}\n",
  'src/demo.ts': "export const message = 'Edit me and press save';\n",
  'package.json': '{\n  "name": "cloudcli-local-demo",\n  "private": true\n}\n',
});

const createDefaultGitState = (): LocalGitState => ({
  branch: 'main',
  hasCommits: true,
  modified: [],
  added: [],
  deleted: [],
  untracked: [],
  staged: [],
  branches: ['main', 'feature/local-demo'],
  remote: {
    hasRemote: false,
    hasUpstream: false,
    branch: 'main',
    remoteBranch: '',
    remoteName: null,
    ahead: 0,
    behind: 0,
    isUpToDate: true,
  },
  commits: [{
    hash: 'local-demo-commit',
    author: 'CloudCLI Demo',
    email: 'demo@cloudcli.local',
    date: '2026-01-01T12:00:00.000Z',
    message: 'Initialize local demo workspace',
    parents: [],
    refs: ['HEAD -> main'],
  }],
  diffs: {},
  worktrees: [{
    path: DEMO_PROJECT_PATH,
    branch: 'main',
    headSha: 'local-demo-commit',
    isMain: true,
    isCurrent: true,
    isLocked: false,
    isDetached: false,
    changedFileCount: 0,
    ahead: 0,
    behind: 0,
    lastCommitSubject: 'Initialize local demo workspace',
    lastCommitDate: '2026-01-01T12:00:00.000Z',
    linkedProjectId: DEMO_PROJECT_ID,
    linkedProjectArchived: false,
  }],
});

const createDefaultLocalState = (): LocalApiState => {
  const now = new Date().toISOString();
  const session: ProjectSession = {
    id: DEMO_SESSION_ID,
    summary: 'Welcome to the local demo',
    title: 'Welcome to the local demo',
    createdAt: '2026-01-01T12:00:00.000Z',
    created_at: '2026-01-01T12:00:00.000Z',
    updated_at: now,
    lastActivity: now,
    messageCount: 1,
    provider: 'claude',
    __provider: 'claude',
    __projectId: DEMO_PROJECT_ID,
  };
  const project: Project = {
    projectId: DEMO_PROJECT_ID,
    displayName: 'CloudCLI Local Demo',
    fullPath: DEMO_PROJECT_PATH,
    path: DEMO_PROJECT_PATH,
    isStarred: true,
    sessions: [session],
    sessionMeta: { total: 1, hasMore: false },
    taskmaster: { hasTaskmaster: false, status: 'not-configured', metadata: { taskCount: 0, completed: 0 } },
  };

  return {
    projects: [project],
    archivedProjects: [],
    sessions: {
      [DEMO_SESSION_ID]: {
        session,
        messages: createDemoMessages(DEMO_SESSION_ID),
        provider: 'claude',
      },
    },
    files: { [DEMO_PROJECT_ID]: createDefaultFiles() },
    assets: {},
    directories: {},
    filesystemDirectories: [],
    scheduledMessages: [],
    preferences: {},
    drafts: {},
    git: { [DEMO_PROJECT_ID]: createDefaultGitState() },
    providerModels: JSON.parse(JSON.stringify(DEFAULT_PROVIDER_MODELS)) as Record<LLMProvider, ProviderModelsDefinition>,
    providerSelections: {},
    mcpServers: {},
    skills: {},
    plugins: [],
    apiKeys: [],
    credentials: [],
    notificationPreferences: JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)) as NotificationPreferencesState,
    browserUseSettings: { enabled: false },
    prdFiles: {},
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const loadLocalState = (): LocalApiState => {
  const fallback = createDefaultLocalState();
  if (typeof localStorage === 'undefined') {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(LOCAL_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback;
    return {
      ...fallback,
      ...parsed,
      projects: Array.isArray(parsed.projects) ? parsed.projects as Project[] : fallback.projects,
      archivedProjects: Array.isArray(parsed.archivedProjects) ? parsed.archivedProjects as Project[] : fallback.archivedProjects,
      sessions: isRecord(parsed.sessions) ? parsed.sessions as LocalApiState['sessions'] : fallback.sessions,
      files: isRecord(parsed.files) ? parsed.files as LocalApiState['files'] : fallback.files,
      assets: isRecord(parsed.assets) ? parsed.assets as LocalApiState['assets'] : fallback.assets,
      directories: isRecord(parsed.directories) ? parsed.directories as LocalApiState['directories'] : fallback.directories,
      filesystemDirectories: Array.isArray(parsed.filesystemDirectories) ? parsed.filesystemDirectories.filter((item): item is string => typeof item === 'string') : fallback.filesystemDirectories,
      git: isRecord(parsed.git) ? parsed.git as LocalApiState['git'] : fallback.git,
      providerModels: isRecord(parsed.providerModels) ? parsed.providerModels as LocalApiState['providerModels'] : fallback.providerModels,
      prdFiles: isRecord(parsed.prdFiles) ? parsed.prdFiles as LocalApiState['prdFiles'] : fallback.prdFiles,
    };
  } catch {
    return fallback;
  }
};

const localState = loadLocalState();
const localEventListeners = new Set<LocalEventListener>();
const activeLocalRuns = new Map<string, number>();
let localEventSequence = 0;

const persistLocalState = (): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STATE_STORAGE_KEY, JSON.stringify(localState));
  } catch {
    // The in-memory fixture remains usable when storage is unavailable/full.
  }
};

export function subscribeToLocalEvents(listener: LocalEventListener): () => void {
  localEventListeners.add(listener);
  return () => localEventListeners.delete(listener);
}

const dispatchLocalEvent = (event: ServerEvent): void => {
  // Effects that send the first chat.subscribe run before the consumer's
  // subscription effect. Deferring one microtask preserves the real transport's
  // asynchronous delivery semantics and prevents the ack from being lost.
  queueMicrotask(() => {
    for (const listener of localEventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[LocalRuntime] Event listener failed:', error);
      }
    }
  });
};

const localJsonResponse = (payload: unknown, status = 200, headers: Record<string, string> = {}): Response => (
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
);

const localBlobResponse = (content: string, contentType = 'text/plain'): Response => (
  new Response(content, {
    status: 200,
    headers: { 'Content-Type': contentType },
  })
);

const localBinaryResponse = (bytes: Uint8Array, contentType: string): Response => {
  // Copy into an ArrayBuffer-backed view so TypeScript and older browsers do
  // not treat a potentially SharedArrayBuffer-backed input as a BlobPart.
  const copiedBytes = new Uint8Array(bytes.length);
  copiedBytes.set(bytes);
  return new Response(copiedBytes.buffer, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
};

const localErrorResponse = (message: string, status = 400): Response => (
  localJsonResponse({ success: false, error: message, message }, status)
);

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const readFileBytes = async (file: File): Promise<Uint8Array> => {
  if (typeof file.arrayBuffer === 'function') {
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer && typeof arrayBuffer.byteLength === 'number') {
      return new Uint8Array(arrayBuffer);
    }
  }

  if (typeof FileReader !== 'undefined') {
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Unable to read asset'));
        reader.readAsArrayBuffer(file);
      });
      if (result && typeof (result as ArrayBuffer).byteLength === 'number') {
        return new Uint8Array(result as ArrayBuffer);
      }
    } catch {
      // Fall through to the text reader for environments without binary Blob support.
    }
  }

  const text = typeof file.text === 'function' ? await file.text() : '';
  return new TextEncoder().encode(typeof text === 'string' ? text : '');
};

const readFileAsset = async (file: File): Promise<LocalAsset> => {
  const bytes = await readFileBytes(file);
  const mimeType = file.type || 'application/octet-stream';
  return {
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    mimeType,
    name: file.name || 'attachment',
    size: file.size || bytes.byteLength,
  };
};

const assetBytes = (asset: LocalAsset | string): { bytes: Uint8Array; contentType: string } => {
  if (typeof asset === 'string') {
    return {
      bytes: new TextEncoder().encode(asset),
      contentType: 'text/plain',
    };
  }

  const commaIndex = asset.dataUrl.indexOf(',');
  if (commaIndex < 0) {
    return { bytes: new Uint8Array(), contentType: asset.mimeType };
  }

  return {
    bytes: base64ToBytes(asset.dataUrl.slice(commaIndex + 1)),
    contentType: asset.mimeType,
  };
};

const parseRequestBody = async (body: BodyInit | null | undefined): Promise<unknown> => {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of body.entries()) {
      const previous = result[key];
      result[key] = previous === undefined
        ? value
        : Array.isArray(previous) ? [...previous, value] : [previous, value];
    }
    return result;
  }
  return body;
};

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asStringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const buildFileTree = (files: Record<string, string>, directories: string[] = []): FileTreeNode[] => {
  const roots: FileTreeNode[] = [];

  const ensureDirectory = (directoryPath: string): void => {
    const parts = directoryPath.split('/').filter(Boolean);
    let current = roots;
    let parentPath = '';
    for (const part of parts) {
      const path = parentPath ? `${parentPath}/${part}` : part;
      let node = current.find((candidate) => candidate.name === part);
      if (!node) {
        node = { name: part, type: 'directory', path, children: [] };
        current.push(node);
      }
      if (node.type !== 'directory') {
        return;
      }
      node.children ??= [];
      current = node.children;
      parentPath = path;
    }
  };

  for (const directoryPath of [...directories].sort((left, right) => left.localeCompare(right))) {
    ensureDirectory(directoryPath);
  }

  const sortedPaths = Object.keys(files).sort((left, right) => left.localeCompare(right));
  for (const filePath of sortedPaths) {
    const parts = filePath.split('/').filter(Boolean);
    let current = roots;
    let parentPath = '';
    parts.forEach((part, index) => {
      const path = parentPath ? `${parentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = current.find((candidate) => candidate.name === part);
      if (!node) {
        node = isFile
          ? { name: part, type: 'file', path, size: files[filePath].length, modified: '2026-01-01T12:00:00.000Z' }
          : { name: part, type: 'directory', path, children: [] };
        current.push(node);
      }
      if (isFile) {
        if (node.type === 'file') {
          node.size = files[filePath].length;
        }
      } else if (node.type === 'directory') {
        node.children ??= [];
        current = node.children;
      }
      parentPath = path;
    });
  }

  return roots;
};

const getProject = (projectId: string): Project | undefined => (
  localState.projects.find((project) => project.projectId === projectId)
  ?? localState.archivedProjects.find((project) => project.projectId === projectId)
);

const getProjectDirectories = (projectId: string): string[] => {
  const directories = localState.directories[projectId];
  if (Array.isArray(directories)) {
    return directories;
  }
  localState.directories[projectId] = [];
  return localState.directories[projectId];
};

const getSessionRecord = (sessionId: string): LocalSessionRecord | undefined => localState.sessions[sessionId];

const makeSessionId = (prefix = 'local-session'): string => (
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

const getGitState = (projectId: string): LocalGitState => {
  if (!localState.git[projectId]) {
    localState.git[projectId] = createDefaultGitState();
    localState.git[projectId].worktrees = localState.git[projectId].worktrees.map((worktree) => ({
      ...worktree,
      path: getProject(projectId)?.fullPath || worktree.path,
      linkedProjectId: projectId,
    }));
  }
  return localState.git[projectId];
};

const updateProjectSessions = (projectId: string, sessions: ProjectSession[]): void => {
  const project = getProject(projectId);
  if (!project) return;
  project.sessions = sessions;
  project.sessionMeta = { ...project.sessionMeta, total: sessions.length, hasMore: false };
};

const createSessionUpsertEvent = (record: LocalSessionRecord): ServerEvent => {
  const project = getProject(record.session.__projectId || '');
  return {
    kind: 'session_upserted',
    sessionId: record.session.id,
    provider: record.provider,
    session: record.session,
    project: project ? {
      projectId: project.projectId,
      path: project.path || project.fullPath,
      fullPath: project.fullPath,
      displayName: project.displayName,
      isStarred: Boolean(project.isStarred),
    } : null,
    timestamp: new Date().toISOString(),
  };
};

const getMessageSnippet = (content: string, queryText: string): string => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const index = normalized.toLowerCase().indexOf(queryText.toLowerCase());
  if (index < 0 || normalized.length <= 120) return normalized;
  const start = Math.max(0, index - 45);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, start + 120)}${start + 120 < normalized.length ? '…' : ''}`;
};

const buildConversationSearch = (searchText: string): Record<string, unknown> => {
  const queryText = searchText.trim().toLowerCase();
  const results: Array<Record<string, unknown>> = [];
  const titleResults: Array<Record<string, unknown>> = [];
  let totalMatches = 0;

  for (const project of localState.projects) {
    const sessions: Array<Record<string, unknown>> = [];
    for (const session of project.sessions ?? []) {
      const record = getSessionRecord(session.id);
      if (!record) continue;
      const title = String(session.summary || session.title || session.name || session.id);
      const titleMatches = title.toLowerCase().includes(queryText);
      if (titleMatches) {
        titleResults.push({
          sessionId: session.id,
          provider: record.provider,
          projectId: project.projectId,
          projectDisplayName: project.displayName,
          sessionTitle: title,
          lastActivity: session.lastActivity ?? null,
        });
      }

      const matches = record.messages
        .filter((message) => typeof message.content === 'string' && message.content.toLowerCase().includes(queryText))
        .map((message) => ({
          role: message.role ?? 'assistant',
          snippet: getMessageSnippet(message.content ?? '', searchText),
          highlights: [],
          timestamp: message.timestamp,
          provider: record.provider,
          messageUuid: message.id,
        }));
      if (matches.length === 0) continue;
      totalMatches += matches.length;
      sessions.push({ sessionId: session.id, provider: record.provider, sessionSummary: title, matches });
    }
    if (sessions.length > 0) {
      results.push({
        projectId: project.projectId,
        projectName: project.projectId,
        projectDisplayName: project.displayName,
        sessions,
      });
    }
  }

  return { results, titleResults, totalMatches, query: searchText };
};

const createLocalAssistantReply = (content: string): string => {
  const trimmed = content.trim();
  if (!trimmed) return 'I am ready for your next message.';
  if (trimmed.toLowerCase().includes('help')) {
    return 'This is a local demo response. Try editing a file, switching tabs, or asking another question.';
  }
  return `Local demo response: I received “${trimmed.slice(0, 180)}${trimmed.length > 180 ? '…' : ''}”.`;
};

const isImageAttachment = (attachment: Record<string, unknown>): boolean => (
  asString(attachment.mimeType).startsWith('image/')
  || /\.(gif|jpe?g|png|svg|webp)$/i.test(asString(attachment.name) || asString(attachment.path))
);

const getMessageAttachments = (message: Record<string, unknown>): Array<Record<string, unknown>> => {
  const options = asRecord(message.options);
  return (Array.isArray(options.attachments) ? options.attachments : []).filter(isRecord);
};

const appendLocalChatRun = (sessionId: string, message: Record<string, unknown>, anchorId?: string): void => {
  const record = getSessionRecord(sessionId);
  if (!record) {
    dispatchLocalEvent({ kind: 'protocol_error', sessionId, error: 'Local session was not found.' });
    return;
  }

  const runToken = (activeLocalRuns.get(sessionId) ?? 0) + 1;
  activeLocalRuns.set(sessionId, runToken);
  const content = asString(message.content);

  if (anchorId) {
    const anchorIndex = record.messages.findIndex((candidate) => candidate.transcriptAnchorId === anchorId);
    if (anchorIndex >= 0) {
      record.messages = record.messages.slice(0, anchorIndex);
      dispatchLocalEvent({ kind: 'history_truncated', sessionId, anchorId });
    }
  }

  const attachments = getMessageAttachments(message);
  const images = attachments.filter(isImageAttachment).map((attachment) => ({
    path: asString(attachment.path) || undefined,
    name: asString(attachment.name) || undefined,
    data: asString(attachment.data) || undefined,
  }));
  const files = attachments.filter((attachment) => !isImageAttachment(attachment)).map((attachment) => ({
    path: asString(attachment.path) || undefined,
    name: asString(attachment.name) || undefined,
    mimeType: asString(attachment.mimeType) || undefined,
    size: typeof attachment.size === 'number' ? attachment.size : undefined,
  }));

  const userMessage: NormalizedMessage = {
    id: `local-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    timestamp: new Date().toISOString(),
    provider: record.provider,
    kind: 'text',
    role: 'user',
    content,
    transcriptAnchorId: `local-anchor-${Date.now()}`,
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
  record.messages.push(userMessage);
  record.session.summary = record.session.summary || content.slice(0, 72);
  record.session.title = record.session.summary;
  record.session.lastActivity = new Date().toISOString();
  record.session.updated_at = record.session.lastActivity;
  record.session.messageCount = record.messages.length;
  updateProjectSessions(record.session.__projectId || '', (getProject(record.session.__projectId || '')?.sessions ?? []).map((session) => session.id === sessionId ? { ...session, ...record.session } : session));

  const reply = createLocalAssistantReply(content);
  const chunks = reply.match(/.{1,42}/g) ?? [reply];
  chunks.forEach((chunk, index) => {
    setTimeout(() => {
      if (activeLocalRuns.get(sessionId) !== runToken) return;
      dispatchLocalEvent({
        kind: 'stream_delta',
        sessionId,
        provider: record.provider,
        content: chunk,
        seq: ++localEventSequence,
      });
      if (index !== chunks.length - 1) return;

      const assistantMessage: NormalizedMessage = {
        id: `local-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sessionId,
        timestamp: new Date().toISOString(),
        provider: record.provider,
        kind: 'text',
        role: 'assistant',
        content: reply,
        transcriptAnchorId: `local-anchor-${Date.now()}-assistant`,
      };
      record.messages.push(assistantMessage);
      record.session.messageCount = record.messages.length;
      record.session.lastActivity = new Date().toISOString();
      record.session.updated_at = record.session.lastActivity;
      activeLocalRuns.delete(sessionId);
      persistLocalState();
      dispatchLocalEvent({ kind: 'stream_end', sessionId, provider: record.provider, seq: ++localEventSequence });
      dispatchLocalEvent({ kind: 'complete', sessionId, success: true, seq: ++localEventSequence });
      dispatchLocalEvent(createSessionUpsertEvent(record));
    }, 45 * (index + 1));
  });
  persistLocalState();
};

/** Handles chat messages without opening a browser network connection. */
export function sendLocalRealtimeMessage(message: unknown): void {
  const payload = asRecord(message);
  const type = asString(payload.type);
  if (type === 'chat.subscribe') {
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    for (const entry of sessions) {
      const sessionId = asString(asRecord(entry).sessionId);
      if (!sessionId) continue;
      dispatchLocalEvent({
        kind: 'chat_subscribed',
        sessionId,
        isProcessing: activeLocalRuns.has(sessionId),
        pendingPermissions: [],
      });
    }
    return;
  }

  if (type === 'chat.send' || type === 'chat.edit-send') {
    const sessionId = asString(payload.sessionId);
    if (!sessionId) return;
    const record = getSessionRecord(sessionId);
    if (!record) return;
    dispatchLocalEvent({ kind: 'status', sessionId, text: 'Thinking…', canInterrupt: true, seq: ++localEventSequence });
    appendLocalChatRun(sessionId, payload, asString(payload.anchorId) || undefined);
    return;
  }

  if (type === 'chat.abort') {
    const sessionId = asString(payload.sessionId);
    if (!sessionId) return;
    activeLocalRuns.delete(sessionId);
    dispatchLocalEvent({ kind: 'complete', sessionId, aborted: true, success: false, seq: ++localEventSequence });
    return;
  }

  if (type === 'chat.permission-response') {
    dispatchLocalEvent({ kind: 'permission_resolved', sessionId: asString(payload.sessionId) || undefined, requestId: asString(payload.requestId) });
  }
}

const getProviderModelCatalog = (provider: string): ProviderModelsDefinition => (
  localState.providerModels[provider as LLMProvider] ?? DEFAULT_PROVIDER_MODELS.claude
);

const LOCAL_MCP_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const getMcpStorageKey = (provider: string, scope: string, workspacePath = '') => (
  `${provider}:${scope}:${workspacePath}`
);

const resolveMcpRequestValue = (
  parsedUrl: URL,
  body: Record<string, unknown>,
  key: string,
  fallback = '',
): string => (
  asString(body[key]).trim() || parsedUrl.searchParams.get(key)?.trim() || fallback
);

const ensureProviderModelCatalog = (provider: string): ProviderModelsDefinition => {
  const typedProvider = provider as LLMProvider;
  localState.providerModels[typedProvider] ??= JSON.parse(JSON.stringify(DEFAULT_PROVIDER_MODELS.claude)) as ProviderModelsDefinition;
  return localState.providerModels[typedProvider];
};

const createProject = (path: string, displayName?: string): Project => {
  const projectId = `local-project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const normalizedPath = path.trim() || `/workspace/${projectId}`;
  const project: Project = {
    projectId,
    displayName: displayName?.trim() || normalizedPath.split('/').filter(Boolean).pop() || 'Local Project',
    fullPath: normalizedPath,
    path: normalizedPath,
    isStarred: false,
    sessions: [],
    sessionMeta: { total: 0, hasMore: false },
    taskmaster: { hasTaskmaster: false, status: 'not-configured', metadata: { taskCount: 0, completed: 0 } },
  };
  localState.projects.push(project);
  localState.files[projectId] = {
    'README.md': `# ${project.displayName}\n\nLocal fixture project.\n`,
  };
  localState.directories[projectId] = [];
  localState.git[projectId] = createDefaultGitState();
  persistLocalState();
  return project;
};

const createLocalSession = (provider: LLMProvider, projectPath: string, initialMessage?: string): LocalSessionRecord => {
  const project = [...localState.projects, ...localState.archivedProjects].find((candidate) => (
    candidate.fullPath === projectPath || candidate.path === projectPath
  )) ?? localState.projects[0] ?? localState.archivedProjects[0];
  const sessionId = makeSessionId();
  const now = new Date().toISOString();
  const session: ProjectSession = {
    id: sessionId,
    summary: initialMessage?.trim().slice(0, 72) || 'New local conversation',
    title: initialMessage?.trim().slice(0, 72) || 'New local conversation',
    createdAt: now,
    created_at: now,
    updated_at: now,
    lastActivity: now,
    messageCount: 0,
    provider,
    __provider: provider,
    __projectId: project?.projectId,
  };
  const record: LocalSessionRecord = { session, messages: [], provider, isArchived: false };
  localState.sessions[sessionId] = record;
  if (project) {
    updateProjectSessions(project.projectId, [session, ...(project.sessions ?? [])]);
  }
  persistLocalState();
  return record;
};

const isProjectArchived = (projectId: string | undefined): boolean => (
  typeof projectId === 'string'
  && localState.archivedProjects.some((project) => project.projectId === projectId)
);

const isSessionArchived = (record: LocalSessionRecord): boolean => Boolean(record.isArchived);

const archiveSession = (sessionId: string): boolean => {
  const record = localState.sessions[sessionId];
  if (!record) return false;

  record.isArchived = true;
  if (!isProjectArchived(record.session.__projectId)) {
    const projectId = record.session.__projectId;
    if (typeof projectId === 'string') {
      const project = getProject(projectId);
      if (project) {
        updateProjectSessions(projectId, (project.sessions ?? []).filter((session) => session.id !== sessionId));
      }
    }
  }
  persistLocalState();
  return true;
};

const restoreSession = (sessionId: string): boolean => {
  const record = localState.sessions[sessionId];
  if (!record) return false;

  record.isArchived = false;
  const projectId = record.session.__projectId;
  if (typeof projectId === 'string' && !isProjectArchived(projectId)) {
    const project = getProject(projectId);
    if (project && !(project.sessions ?? []).some((session) => session.id === sessionId)) {
      updateProjectSessions(projectId, [record.session, ...(project.sessions ?? [])]);
    }
  }
  persistLocalState();
  return true;
};

const removeSession = (sessionId: string): boolean => {
  const record = localState.sessions[sessionId];
  if (!record) return false;
  activeLocalRuns.delete(sessionId);
  delete localState.sessions[sessionId];
  const projectId = record.session.__projectId;
  if (typeof projectId === 'string') {
    const project = getProject(projectId);
    if (project) updateProjectSessions(projectId, (project.sessions ?? []).filter((session) => session.id !== sessionId));
  }
  persistLocalState();
  return true;
};

const archiveProject = (projectId: string): boolean => {
  const projectIndex = localState.projects.findIndex((project) => project.projectId === projectId);
  if (projectIndex < 0) {
    return localState.archivedProjects.some((project) => project.projectId === projectId);
  }

  const [project] = localState.projects.splice(projectIndex, 1);
  project.isArchived = true;
  localState.archivedProjects.push(project);
  persistLocalState();
  return true;
};

const restoreProject = (projectId: string): boolean => {
  const projectIndex = localState.archivedProjects.findIndex((project) => project.projectId === projectId);
  if (projectIndex < 0) {
    return localState.projects.some((project) => project.projectId === projectId);
  }

  const [project] = localState.archivedProjects.splice(projectIndex, 1);
  project.isArchived = false;
  localState.projects.push(project);
  persistLocalState();
  return true;
};

const deriveLocalPluginName = (url: string): string => {
  const lastSegment = url.trim().replace(/\/+$/, '').split(/[\/?#]/).filter(Boolean).pop() || '';
  const name = lastSegment.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-');
  return name || `local-plugin-${Date.now()}`;
};

const bumpLocalPluginVersion = (version: string): string => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return '0.1.1';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
};

const createLocalPlugin = (url: string): Plugin => {
  const name = deriveLocalPluginName(url);
  return {
    name,
    displayName: name,
    version: '0.1.0',
    description: 'Installed as a local demo plugin. Plugin runtime is disabled.',
    author: 'CloudCLI Local Runtime',
    icon: '',
    type: 'module',
    slot: 'tab',
    entry: 'index.js',
    server: null,
    permissions: [],
    enabled: false,
    serverRunning: false,
    dirName: name,
    repoUrl: url.trim() || null,
  };
};

const handleLocalRequest = async (url: string, options: ApiRequestOptions = {}): Promise<Response> => {
  if (options.signal?.aborted) {
    const abortError = new Error('The request was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const parsedUrl = new URL(url, 'http://cloudcli.local');
  const path = parsedUrl.pathname;
  const method = (options.method || 'GET').toUpperCase();
  const requestBody = await parseRequestBody(options.body);
  const body = asRecord(requestBody);
  const parts = path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));

  if (path === '/api/auth/status' && method === 'GET') return localJsonResponse({ needsSetup: false });
  if ((path === '/api/auth/login' || path === '/api/auth/register') && method === 'POST') {
    return localJsonResponse({ token: LOCAL_DEMO_TOKEN, user: LOCAL_DEMO_USER });
  }
  if (path === '/api/auth/refresh' && method === 'POST') return localJsonResponse({ token: LOCAL_DEMO_TOKEN, user: LOCAL_DEMO_USER });
  if (path === '/api/auth/user' && method === 'GET') return localJsonResponse({ user: LOCAL_DEMO_USER });
  if (path === '/api/user/onboarding-status' && method === 'GET') return localJsonResponse({ hasCompletedOnboarding: true });

  if (parts[0] === 'api' && parts[1] === 'projects') {
    if (parts.length === 2 && method === 'GET') return localJsonResponse(JSON.parse(JSON.stringify(localState.projects)));
    if (parts[2] === 'archived' && parts.length === 3 && method === 'GET') {
      return localJsonResponse({ success: true, data: { projects: localState.archivedProjects } });
    }
    if (parts[2] === 'create-project' && parts.length === 3 && method === 'POST') {
      const project = createProject(asString(body.path), asString(body.customName) || undefined);
      return localJsonResponse({ success: true, project });
    }
    if (parts[2] === 'migrate-legacy-stars' && parts.length === 3 && method === 'POST') {
      for (const id of asStringArray(body.projectIds)) {
        const project = getProject(id);
        if (project) project.isStarred = true;
      }
      persistLocalState();
      return localJsonResponse({ success: true });
    }

    const projectId = parts[2];
    const project = projectId ? getProject(projectId) : undefined;
    if (!project) return localErrorResponse('Project not found', 404);
    if (parts[3] === 'restore' && parts.length === 4 && method === 'POST') {
      if (!restoreProject(projectId)) return localErrorResponse('Project not found', 404);
      return localJsonResponse({ success: true, project: getProject(projectId) });
    }
    if (parts[3] === 'sessions' && parts.length === 4 && method === 'GET') {
      const limit = Number(parsedUrl.searchParams.get('limit') || 20);
      const offset = Number(parsedUrl.searchParams.get('offset') || 0);
      const activeSessions = (project.sessions ?? []).filter((session) => {
        const record = getSessionRecord(session.id);
        return record ? !isSessionArchived(record) : true;
      });
      const sessions = activeSessions.slice(offset, offset + limit);
      return localJsonResponse({ sessions, sessionMeta: { total: activeSessions.length, hasMore: offset + sessions.length < activeSessions.length } });
    }
    if (parts[3] === 'taskmaster' && parts.length === 4 && method === 'GET') return localJsonResponse({ taskmaster: project.taskmaster ?? { hasTaskmaster: false, status: 'not-configured' } });
    if (parts[3] === 'rename' && parts.length === 4 && method === 'PUT') {
      project.displayName = asString(body.displayName, project.displayName);
      persistLocalState();
      return localJsonResponse({ success: true, project });
    }
    if (parts[3] === 'toggle-star' && parts.length === 4 && method === 'POST') {
      project.isStarred = !project.isStarred;
      persistLocalState();
      return localJsonResponse({ success: true, isStarred: project.isStarred });
    }
    if (parts.length === 3 && method === 'DELETE') {
      const hardDelete = parsedUrl.searchParams.get('force') === 'true' || body.force === true;
      if (hardDelete) {
        for (const [sessionId, record] of Object.entries(localState.sessions)) {
          if (record.session.__projectId === projectId) {
            activeLocalRuns.delete(sessionId);
            delete localState.sessions[sessionId];
          }
        }
        localState.projects = localState.projects.filter((candidate) => candidate.projectId !== projectId);
        localState.archivedProjects = localState.archivedProjects.filter((candidate) => candidate.projectId !== projectId);
        delete localState.files[projectId];
        delete localState.directories[projectId];
        delete localState.git[projectId];
        delete localState.prdFiles[projectId];
        persistLocalState();
        return localJsonResponse({ success: true, deleted: true });
      }

      archiveProject(projectId);
      return localJsonResponse({ success: true, archived: true, project: getProject(projectId) });
    }
  }

  if (parts[0] === 'api' && parts[1] === 'providers') {
    if (parts[2] === 'capabilities' && parts.length === 3 && method === 'GET') return localJsonResponse({ success: true, data: { providers: DEFAULT_CAPABILITIES } });
    if (parts[2] === 'search' && parts[3] === 'sessions' && parts.length === 4 && method === 'GET') return localJsonResponse(buildConversationSearch(parsedUrl.searchParams.get('q') || ''));
    if (parts[2] === 'mcp' && parts[3] === 'servers' && parts[4] === 'global' && parts.length === 5 && method === 'POST') {
      const scope = asString(body.scope, 'user');
      const workspacePath = asString(body.workspacePath);
      const results = LOCAL_MCP_PROVIDERS.map((provider) => {
        const key = getMcpStorageKey(provider, scope, workspacePath);
        localState.mcpServers[key] ??= [];
        const server = { ...body, provider, scope, ...(workspacePath ? { workspacePath } : {}) };
        localState.mcpServers[key] = [
          ...localState.mcpServers[key].filter((item) => asString(asRecord(item).name) !== asString(body.name)),
          server,
        ];
        return { provider, created: true, server };
      });
      persistLocalState();
      return localJsonResponse({ success: true, data: { results } });
    }
    if (parts[3] === 'sessions' && parts[5] === 'active-model' && parts.length === 6 && (method === 'GET' || method === 'POST')) {
      const provider = parts[2];
      const sessionId = parts[4];
      const key = `${provider}:${sessionId}`;
      const selection = localState.providerSelections[key] ?? {};
      if (method === 'GET') {
        return localJsonResponse({
          success: true,
          data: {
            provider,
            sessionId,
            model: selection.model || getProviderModelCatalog(provider).DEFAULT,
            effort: selection.effort || null,
            source: selection.model ? 'session' : 'default',
          },
        });
      }
      selection.model = asString(body.model, selection.model || getProviderModelCatalog(provider).DEFAULT);
      localState.providerSelections[key] = selection;
      persistLocalState();
      return localJsonResponse({ success: true, data: { provider, sessionId, model: selection.model, effort: selection.effort || null, source: 'session' } });
    }
    if (parts[3] === 'sessions' && parts[5] === 'active-effort' && parts.length === 6 && method === 'POST') {
      const provider = parts[2];
      const sessionId = parts[4];
      const key = `${provider}:${sessionId}`;
      const selection = localState.providerSelections[key] ?? {};
      selection.effort = asString(body.effort, selection.effort || 'default');
      localState.providerSelections[key] = selection;
      persistLocalState();
      return localJsonResponse({ success: true, data: { provider, sessionId, model: selection.model || null, effort: selection.effort } });
    }
    if (parts[2] === 'sessions') {
      if (parts.length === 3 && method === 'POST') {
        const provider = asString(body.provider, 'claude') as LLMProvider;
        const record = createLocalSession(provider, asString(body.projectPath), asString(body.initialMessage));
        return localJsonResponse({ success: true, data: { sessionId: record.session.id, sessionName: record.session.summary } });
      }
      if (parts[3] === 'archived' && parts.length === 4 && method === 'GET') {
        const sessions = Object.values(localState.sessions)
          .filter((record) => isSessionArchived(record))
          .map((record) => {
            const project = getProject(record.session.__projectId || '');
            return {
              sessionId: record.session.id,
              provider: record.provider,
              projectId: project?.projectId ?? record.session.__projectId ?? null,
              projectPath: project?.fullPath || project?.path || null,
              projectDisplayName: project?.displayName || 'Archived sessions',
              sessionTitle: record.session.summary || record.session.title || record.session.id,
              createdAt: record.session.createdAt || record.session.created_at || null,
              updatedAt: record.session.updated_at || null,
              lastActivity: record.session.lastActivity || record.session.updated_at || null,
              isProjectArchived: isProjectArchived(record.session.__projectId),
            };
          });
        return localJsonResponse({ success: true, data: { sessions } });
      }
      if (parts[3] === 'running' && parts.length === 4 && method === 'GET') {
        return localJsonResponse({ success: true, data: { sessions: [...activeLocalRuns.keys()].map((sessionId) => ({ sessionId, startedAt: new Date().toISOString(), canInterrupt: true })) } });
      }
      if (parts[3] === 'recent' && parts.length === 4 && method === 'GET') {
        const all = localState.projects.flatMap((project) => (project.sessions ?? []).filter((session) => {
          const record = getSessionRecord(session.id);
          return !record || !isSessionArchived(record);
        }).map((session) => ({
          sessionId: session.id,
          provider: session.__provider || session.provider || 'claude',
          projectId: project.projectId,
          projectDisplayName: project.displayName,
          sessionTitle: session.summary || session.title || session.id,
          lastActivity: session.lastActivity || session.updated_at || null,
        })));
        const offset = Number(parsedUrl.searchParams.get('offset') || 0);
        const limit = Number(parsedUrl.searchParams.get('limit') || 40);
        const conversations = all.slice(offset, offset + limit);
        return localJsonResponse({ success: true, data: { conversations, total: all.length, hasMore: offset + conversations.length < all.length } });
      }
      const sessionId = parts[3];
      const record = getSessionRecord(sessionId);
      if (!record) return localErrorResponse('Session not found', 404);
      if (parts.length === 4 && method === 'GET') {
        const project = getProject(record.session.__projectId || '');
        return localJsonResponse({
          success: true,
          data: {
            sessionId: record.session.id,
            provider: record.provider,
            summary: record.session.summary || record.session.title || record.session.id,
            createdAt: record.session.createdAt || record.session.created_at || null,
            lastActivity: record.session.lastActivity || record.session.updated_at || null,
            project: project ? {
              projectId: project.projectId,
              path: project.path || project.fullPath,
              fullPath: project.fullPath,
              displayName: project.displayName,
              isStarred: Boolean(project.isStarred),
            } : null,
          },
        });
      }
      if (parts[4] === 'messages' && parts.length === 5 && method === 'GET') {
        const limitValue = parsedUrl.searchParams.get('limit');
        const limit = limitValue === null ? record.messages.length : Math.max(1, Number(limitValue));
        const offset = Math.max(0, Number(parsedUrl.searchParams.get('offset') || 0));
        const end = Math.max(0, record.messages.length - offset);
        const start = Math.max(0, end - limit);
        const messages = record.messages.slice(start, end);
        return localJsonResponse({ success: true, data: { messages, total: record.messages.length, hasMore: start > 0, tokenUsage: { input: record.messages.length * 12, output: record.messages.length * 8, total: record.messages.length * 20 } } });
      }
      if (parts[4] === 'token-usage' && parts.length === 5 && method === 'GET') return localJsonResponse({ success: true, data: { input: record.messages.length * 12, output: record.messages.length * 8, total: record.messages.length * 20 } });
      if (parts[4] === 'provider-id' && parts.length === 5 && method === 'GET') return localJsonResponse({ success: true, data: { providerSessionId: sessionId } });
      if (parts[4] === 'restore' && parts.length === 5 && method === 'POST') {
        if (!restoreSession(sessionId)) return localErrorResponse('Session not found', 404);
        return localJsonResponse({ success: true, data: { session: record.session } });
      }
      if (parts[4] === 'fork' && parts.length === 5 && method === 'POST') {
        const anchorId = asString(body.upToAnchorId);
        const copy = createLocalSession(record.provider, getProject(record.session.__projectId || '')?.fullPath || DEMO_PROJECT_PATH, record.session.summary ? `${record.session.summary} (fork)` : 'Forked local conversation');
        const anchorIndex = anchorId ? record.messages.findIndex((message) => message.transcriptAnchorId === anchorId) : record.messages.length - 1;
        copy.messages = record.messages.slice(0, anchorIndex >= 0 ? anchorIndex + 1 : record.messages.length).map((message) => ({ ...message, sessionId: copy.session.id }));
        copy.session.messageCount = copy.messages.length;
        persistLocalState();
        dispatchLocalEvent(createSessionUpsertEvent(copy));
        return localJsonResponse({ success: true, data: { sessionId: copy.session.id, sessionName: copy.session.summary } });
      }
      if (parts.length === 4 && method === 'PUT') {
        record.session.summary = asString(body.summary, record.session.summary || record.session.id);
        record.session.title = record.session.summary;
        const project = getProject(record.session.__projectId || '');
        if (project) updateProjectSessions(project.projectId, (project.sessions ?? []).map((session) => session.id === sessionId ? { ...session, ...record.session } : session));
        persistLocalState();
        return localJsonResponse({ success: true, session: record.session });
      }
      if (parts.length === 4 && method === 'DELETE') {
        const hardDelete = parsedUrl.searchParams.get('force') === 'true' || body.force === true;
        const changed = hardDelete ? removeSession(sessionId) : archiveSession(sessionId);
        if (!changed) return localErrorResponse('Session not found', 404);
        return localJsonResponse({ success: true, archived: !hardDelete, deleted: hardDelete });
      }
    }

    const provider = parts[2];
    if (parts[3] === 'auth' && parts[4] === 'status' && parts.length === 5 && method === 'GET') return localJsonResponse({ success: true, data: { authenticated: true, email: 'demo@cloudcli.local', method: 'local-demo', error: null } });
    if (parts[3] === 'models') {
      const catalog = ensureProviderModelCatalog(provider);
      if (parts.length === 4 && method === 'GET') return localJsonResponse({ success: true, data: { models: catalog } });
      if (parts.length === 4 && method === 'POST') {
        const input = asRecord(body);
        const model: ProviderModelOption = { value: asString(input.model, asString(input.id, 'custom-model')), label: asString(input.id, asString(input.model, 'Custom model')), recordId: Date.now(), isCustom: true };
        catalog.OPTIONS = [...catalog.OPTIONS, model];
        persistLocalState();
        return localJsonResponse({ success: true, data: { model, models: catalog } });
      }
      if (parts.length !== 5) return localErrorResponse(`Unsupported local model route: ${method} ${path}`, 404);
      const recordId = Number(parts[4]);
      const index = catalog.OPTIONS.findIndex((option) => option.recordId === recordId);
      if (method === 'PATCH' && index >= 0) {
        const current = catalog.OPTIONS[index];
        const updated = { ...current, value: asString(body.model, current.value), label: asString(body.id, current.label) };
        catalog.OPTIONS[index] = updated;
        persistLocalState();
        return localJsonResponse({ success: true, data: { model: updated, models: catalog } });
      }
      if (method === 'DELETE' && index >= 0) {
        catalog.OPTIONS.splice(index, 1);
        persistLocalState();
        return localJsonResponse({ success: true, data: { model: catalog.OPTIONS[0], models: catalog } });
      }
    }
    if (parts[3] === 'mcp' && parts[4] === 'servers' && (parts.length === 5 || parts.length === 6)) {
      const scope = resolveMcpRequestValue(parsedUrl, body, 'scope', 'global');
      const workspacePath = resolveMcpRequestValue(parsedUrl, body, 'workspacePath');
      const key = getMcpStorageKey(provider, scope, workspacePath);
      localState.mcpServers[key] ??= [];
      if (parts.length === 5 && method === 'GET') return localJsonResponse({ success: true, data: { servers: localState.mcpServers[key] } });
      if (parts.length === 6 && method === 'DELETE') {
        localState.mcpServers[key] = localState.mcpServers[key].filter((server) => asString(asRecord(server).name) !== parts[5]);
        persistLocalState();
        return localJsonResponse({ success: true, data: { removed: true } });
      }
      if (parts.length !== 5 || method !== 'POST') return localErrorResponse(`Unsupported local MCP route: ${method} ${path}`, 404);
      const server = {
        ...body,
        provider,
        scope,
        ...(workspacePath ? { workspacePath } : {}),
      };
      localState.mcpServers[key] = [...localState.mcpServers[key].filter((item) => asString(asRecord(item).name) !== asString(body.name)), server];
      persistLocalState();
      return localJsonResponse({ success: true, data: { server } });
    }
    if (parts[3] === 'skills' && parts.length === 4) {
      const key = provider;
      localState.skills[key] ??= [{ provider, name: 'local-demo', description: 'A local demo skill', command: '/local-demo', scope: 'system', sourcePath: 'local://fixture' }];
      if (method === 'GET') return localJsonResponse({ success: true, data: { provider, skills: localState.skills[key] } });
      if (method === 'POST') {
        const entries = Array.isArray(body.entries) ? body.entries : [];
        for (const entry of entries) {
          const item = asRecord(entry);
          localState.skills[key].push({ provider, name: asString(item.directoryName, 'local-skill'), description: 'Local fixture skill', command: `/${asString(item.directoryName, 'local-skill')}`, scope: 'user', sourcePath: 'local://fixture' });
        }
        persistLocalState();
        return localJsonResponse({ success: true, data: { provider, skills: localState.skills[key] } });
      }
      return localErrorResponse(`Unsupported local skills route: ${method} ${path}`, 404);
    }
  }

  if (parts[0] === 'api' && parts[1] === 'scheduled-messages') {
    if (parts.length === 2 && method === 'GET') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      return localJsonResponse({ data: localState.scheduledMessages.filter((item) => !sessionId || item.sessionId === sessionId) });
    }
    if (parts.length === 2 && method === 'POST') {
      const item: ScheduledMessage = {
        id: makeSessionId('scheduled'),
        sessionId: asString(body.sessionId),
        content: asString(body.content),
        scheduledFor: asString(body.scheduledFor),
        options: isRecord(body.options) ? body.options : {},
        status: 'pending',
        failureReason: null,
        createdAt: new Date().toISOString(),
      };
      localState.scheduledMessages.push(item);
      persistLocalState();
      return localJsonResponse({ data: item });
    }
    if (parts.length === 3 && method === 'DELETE') {
      localState.scheduledMessages = localState.scheduledMessages.filter((item) => item.id !== parts[2]);
      persistLocalState();
      return localJsonResponse({ success: true });
    }
  }

  if (parts[0] === 'api' && parts[1] === 'file-tree') {
    if (parts[2] === 'browse-filesystem' && parts.length === 3 && method === 'GET') {
      const requestedPath = parsedUrl.searchParams.get('path') || '';
      const suggestions = [
        { name: 'cloudcli-demo', path: DEMO_PROJECT_PATH, type: 'directory' },
        ...localState.filesystemDirectories.map((directoryPath) => ({
          name: directoryPath.split('/').filter(Boolean).pop() || directoryPath,
          path: directoryPath,
          type: 'directory',
        })),
      ].filter((suggestion, index, all) => all.findIndex((candidate) => candidate.path === suggestion.path) === index);
      return localJsonResponse({ path: requestedPath, suggestions });
    }
    if (parts[2] === 'create-folder' && parts.length === 3 && method === 'POST') {
      const folderPath = asString(body.path).trim();
      if (!folderPath) return localErrorResponse('Folder path is required', 400);
      if (!localState.filesystemDirectories.includes(folderPath)) {
        localState.filesystemDirectories.push(folderPath);
        persistLocalState();
      }
      return localJsonResponse({ success: true, path: folderPath, type: 'directory' });
    }
    if (parts[2] === 'projects' && parts.length >= 4) {
      const projectId = parts[3];
      const files = projectId ? (localState.files[projectId] ?? {}) : {};
      if (!projectId || !getProject(projectId)) return localErrorResponse('Project not found', 404);
      if (parts[4] === 'file' && parts.length === 5) {
        const filePath = parsedUrl.searchParams.get('filePath') || asString(body.filePath);
        if (method === 'GET') return localJsonResponse({ content: files[filePath] ?? '' });
        if (method === 'PUT') {
          files[filePath] = asString(body.content);
          getGitState(projectId).modified = [...new Set([...getGitState(projectId).modified, filePath])];
          persistLocalState();
          return localJsonResponse({ success: true, content: files[filePath] });
        }
      }
      if (parts[4] === 'files' && parts[5] === 'content' && parts.length === 6 && method === 'GET') {
        const filePath = parsedUrl.searchParams.get('path') || '';
        return localBlobResponse(files[filePath] ?? '', 'text/plain');
      }
      if (parts[4] === 'files' && parts.length === 5 && method === 'GET') {
        return localJsonResponse(buildFileTree(files, getProjectDirectories(projectId)));
      }
      if (parts[4] === 'files' && parts[5] === 'create' && parts.length === 6 && method === 'POST') {
        const parent = asString(body.path).replace(/^\/+|\/+$/g, '');
        const name = asString(body.name, 'untitled.txt');
        const pathValue = parent ? `${parent}/${name}` : name;
        const itemType = asString(body.type, 'file');
        const directories = getProjectDirectories(projectId);
        if (itemType === 'directory') {
          if (!directories.includes(pathValue)) {
            directories.push(pathValue);
          }
          delete files[pathValue];
        } else {
          files[pathValue] = '';
          localState.directories[projectId] = directories.filter((directory) => directory !== pathValue);
        }
        persistLocalState();
        return localJsonResponse({ success: true, path: pathValue, type: itemType });
      }
      if (parts[4] === 'files' && parts[5] === 'rename' && parts.length === 6 && method === 'PUT') {
        const oldPath = asString(body.oldPath);
        const newName = asString(body.newName);
        const parent = oldPath.split('/').slice(0, -1).join('/');
        const newPath = parent ? `${parent}/${newName}` : newName;
        const directories = getProjectDirectories(projectId);
        const isDirectory = directories.includes(oldPath)
          || Object.keys(files).some((filePath) => filePath.startsWith(`${oldPath}/`));
        if (isDirectory) {
          for (const filePath of Object.keys(files)) {
            if (filePath === oldPath || filePath.startsWith(`${oldPath}/`)) {
              const suffix = filePath.slice(oldPath.length);
              files[`${newPath}${suffix}`] = files[filePath];
              delete files[filePath];
            }
          }
          localState.directories[projectId] = directories
            .filter((directory) => directory === oldPath || directory.startsWith(`${oldPath}/`))
            .map((directory) => `${newPath}${directory.slice(oldPath.length)}`)
            .concat(directories.filter((directory) => directory !== oldPath && !directory.startsWith(`${oldPath}/`)));
          if (!localState.directories[projectId].includes(newPath)) {
            localState.directories[projectId].push(newPath);
          }
        } else {
          files[newPath] = files[oldPath] ?? '';
          delete files[oldPath];
        }
        persistLocalState();
        return localJsonResponse({ success: true, path: newPath });
      }
      if (parts[4] === 'files' && parts.length === 5 && method === 'DELETE') {
        const pathValue = asString(body.path);
        for (const filePath of Object.keys(files)) {
          if (filePath === pathValue || filePath.startsWith(`${pathValue}/`)) delete files[filePath];
        }
        localState.directories[projectId] = getProjectDirectories(projectId)
          .filter((directory) => directory !== pathValue && !directory.startsWith(`${pathValue}/`));
        persistLocalState();
        return localJsonResponse({ success: true });
      }
      if (parts[4] === 'files' && parts[5] === 'upload' && parts.length === 6 && method === 'POST') {
        const targetPath = asString(body.targetPath).replace(/^\/+|\/+$/g, '');
        const relativePaths = (() => {
          try { return JSON.parse(asString(body.relativePaths)) as unknown; } catch { return []; }
        })();
        const paths = Array.isArray(relativePaths) ? relativePaths : [];
        const rawFiles = Array.isArray(body.files) ? body.files : body.files ? [body.files] : [];
        for (const [index, rawFile] of rawFiles.entries()) {
          const file = rawFile as File;
          const relativePath = asString(paths[index], file.name || `upload-${index + 1}.txt`);
          const filePath = targetPath ? `${targetPath}/${relativePath}` : relativePath;
          files[filePath] = typeof file.text === 'function' ? await file.text() : '';
        }
        persistLocalState();
        return localJsonResponse({ files: rawFiles.map((rawFile, index) => ({ path: asString(paths[index], (rawFile as File).name), name: (rawFile as File).name })), uploadedCount: rawFiles.length, requestedFileCount: Number(body.requestedFileCount) || rawFiles.length });
      }
    }
  }

  if (parts[0] === 'api' && parts[1] === 'git') {
    const projectId = parsedUrl.searchParams.get('project') || asString(body.project);
    const git = getGitState(projectId || DEMO_PROJECT_ID);
    const action = parts[2];
    if (action === 'status' && parts.length === 3 && method === 'GET') return localJsonResponse({ branch: git.branch, hasCommits: git.hasCommits, modified: git.modified, added: git.added, deleted: git.deleted, untracked: git.untracked, staged: git.staged });
    if (action === 'diff' && parts.length === 3 && method === 'GET') {
      const filePath = parsedUrl.searchParams.get('file') || '';
      return localJsonResponse({ diff: git.diffs[filePath] || '' });
    }
    if (action === 'commit-diff' && parts.length === 3 && method === 'GET') return localJsonResponse({ diff: '' });
    if (action === 'file-with-diff' && parts.length === 3 && method === 'GET') {
      const filePath = parsedUrl.searchParams.get('file') || '';
      const content = localState.files[projectId || DEMO_PROJECT_ID]?.[filePath] || '';
      return localJsonResponse({ oldContent: content, currentContent: content });
    }
    if (action === 'branches' && parts.length === 3 && method === 'GET') return localJsonResponse({ branches: git.branches, localBranches: git.branches, remoteBranches: [] });
    if (action === 'remote-status' && parts.length === 3 && method === 'GET') return localJsonResponse(git.remote);
    if (action === 'commits' && parts.length === 3 && method === 'GET') return localJsonResponse({ commits: git.commits.slice(0, Number(parsedUrl.searchParams.get('limit') || 50)) });
    if (action === 'generate-commit-message' && parts.length === 3 && method === 'POST') return localJsonResponse({ message: 'Update local demo files' });
    if (action === 'checkout' && parts.length === 3 && method === 'POST') {
      git.branch = asString(body.branch, git.branch);
      git.remote.branch = git.branch;
      persistLocalState();
      return localJsonResponse({ success: true, output: `Switched to ${git.branch}` });
    }
    if (action === 'create-branch' && parts.length === 3 && method === 'POST') {
      const branch = asString(body.branch);
      if (branch && !git.branches.includes(branch)) git.branches.push(branch);
      persistLocalState();
      return localJsonResponse({ success: true, output: `Created ${branch}` });
    }
    if (action === 'delete-branch' && parts.length === 3 && method === 'POST') {
      git.branches = git.branches.filter((branch) => branch !== asString(body.branch));
      persistLocalState();
      return localJsonResponse({ success: true });
    }
    if (action === 'stage' && parts.length === 3 && method === 'POST') {
      git.staged = [...new Set([...git.staged, ...asStringArray(body.files)])];
      git.modified = git.modified.filter((file) => !git.staged.includes(file));
      persistLocalState();
      return localJsonResponse({ success: true });
    }
    if (action === 'unstage' && parts.length === 3 && method === 'POST') {
      git.staged = git.staged.filter((file) => !asStringArray(body.files).includes(file));
      persistLocalState();
      return localJsonResponse({ success: true });
    }
    if ((action === 'discard' || action === 'delete-untracked') && parts.length === 3 && method === 'POST') {
      const filePath = asString(body.file);
      git.modified = git.modified.filter((file) => file !== filePath);
      git.untracked = git.untracked.filter((file) => file !== filePath);
      persistLocalState();
      return localJsonResponse({ success: true });
    }
    if ((action === 'commit' || action === 'initial-commit') && parts.length === 3 && method === 'POST') {
      git.staged = [];
      git.modified = [];
      git.added = [];
      git.untracked = [];
      git.hasCommits = true;
      persistLocalState();
      return localJsonResponse({ success: true, output: 'Committed local demo changes' });
    }
    if (action === 'fetch' || action === 'pull' || action === 'push' || action === 'publish') {
      return localErrorResponse(`Git ${action} is unsupported in local demo mode`, 501);
    }
    if (action === 'init' && parts.length === 3 && method === 'POST') return localJsonResponse({ success: true, output: 'Local repository is already initialized' });
    if (action === 'revert-local-commit') return localErrorResponse('Reverting commits is unsupported in local demo mode', 501);
  }

  if (parts[0] === 'api' && parts[1] === 'worktrees') {
    const projectId = parsedUrl.searchParams.get('project') || asString(body.project) || DEMO_PROJECT_ID;
    const git = getGitState(projectId);
    if (parts.length === 2 && method === 'GET') return localJsonResponse({ success: true, data: { repositoryRoot: getProject(projectId)?.fullPath || DEMO_PROJECT_PATH, baseBranch: git.branch, worktrees: git.worktrees } });
    if (parts.length === 3 && (parts[2] === 'create' || parts[2] === 'open' || parts[2] === 'merge' || parts[2] === 'remove')) {
      return localErrorResponse('Worktree operations are unsupported in local demo mode', 501);
    }
  }

  if (parts[0] === 'api' && parts[1] === 'commands') {
    if (parts[2] === 'list' && parts.length === 3 && method === 'POST') return localJsonResponse({ builtIn: DEFAULT_COMMANDS, custom: [] });
    if (parts[2] === 'execute' && parts.length === 3 && method === 'POST') {
      const commandName = asString(body.commandName).toLowerCase();
      if (commandName === '/help') return localJsonResponse({ type: 'builtin', action: 'help', data: { content: 'Local demo commands: /help, /models, /cost, /status, /memory', commands: DEFAULT_COMMANDS } });
      if (commandName === '/models') return localJsonResponse({ type: 'builtin', action: 'models', data: { current: { provider: asString(asRecord(body.context).provider, 'claude'), model: asString(asRecord(body.context).model, DEFAULT_PROVIDER_MODELS.claude.DEFAULT) }, availableModels: DEFAULT_PROVIDER_MODELS.claude.OPTIONS.map((option) => option.value), availableOptions: DEFAULT_PROVIDER_MODELS.claude.OPTIONS, defaultModel: DEFAULT_PROVIDER_MODELS.claude.DEFAULT } });
      if (commandName === '/cost') return localJsonResponse({ type: 'builtin', action: 'cost', data: { tokenUsage: { used: 120, total: 4096 }, tokenBreakdown: { input: 72, output: 48 }, provider: asString(asRecord(body.context).provider, 'claude'), model: asString(asRecord(body.context).model, 'default') } });
      if (commandName === '/status') return localJsonResponse({ type: 'builtin', action: 'status', data: { version: 'local-demo', packageName: 'CloudCLI', uptime: 'local runtime', provider: asString(asRecord(body.context).provider, 'claude'), model: asString(asRecord(body.context).model, 'default') } });
      if (commandName === '/memory') return localJsonResponse({ type: 'builtin', action: 'memory', data: { error: false, message: 'Local demo memory is available in the fixture.', path: 'README.md', exists: true } });
      return localErrorResponse('Custom slash commands are unsupported in local demo mode', 501);
    }
  }

  if (parts[0] === 'api' && parts[1] === 'assets') {
    if (parts[2] === 'files' && parts.length === 3 && method === 'POST') {
      const rawFiles = Array.isArray(body.files) ? body.files : body.files ? [body.files] : [];
      const attachments = [];
      for (const rawFile of rawFiles) {
        const file = rawFile as File;
        const asset = await readFileAsset(file);
        const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${asset.name}`;
        localState.assets[storedName] = asset;
        attachments.push({ path: storedName, name: asset.name, mimeType: asset.mimeType, size: asset.size });
      }
      persistLocalState();
      return localJsonResponse({ attachments });
    }
    if ((parts[2] === 'files' || parts[2] === 'images') && parts.length === 4 && method === 'GET') {
      const asset = localState.assets[parts[3]];
      if (!asset) return localErrorResponse('Asset not found', 404);
      try {
        const { bytes, contentType } = assetBytes(asset);
        return localBinaryResponse(bytes, contentType);
      } catch {
        return localErrorResponse('Stored asset is unavailable', 500);
      }
    }
  }

  if (parts[0] === 'api' && parts[1] === 'user') {
    if (parts[2] === 'git-config' && parts.length === 3) {
      if (method === 'GET') return localJsonResponse({ gitName: 'CloudCLI Demo', gitEmail: 'demo@cloudcli.local' });
      if (method === 'POST') return localJsonResponse({ success: true });
    }
    if (parts[2] === 'onboarding-status' && parts.length === 3 && method === 'GET') return localJsonResponse({ hasCompletedOnboarding: true });
    if (parts[2] === 'complete-onboarding' && parts.length === 3 && method === 'POST') return localJsonResponse({ success: true });
    if (parts[2] === 'preferences' && parts.length === 3) {
      if (method === 'GET') return localJsonResponse({ preferences: localState.preferences });
      if (method === 'PATCH') {
        localState.preferences = { ...localState.preferences, ...body };
        persistLocalState();
        return localJsonResponse({ success: true, preferences: localState.preferences });
      }
    }
    if (parts[2] === 'drafts' && parts.length === 3) {
      if (method === 'GET') return localJsonResponse({ drafts: Object.entries(localState.drafts).map(([scope, draft]) => ({ scope, ...draft })) });
      const scope = asString(body.scope);
      if (method === 'DELETE') {
        delete localState.drafts[scope];
        persistLocalState();
        return localJsonResponse({ success: true });
      }
      if (method === 'PUT') {
        localState.drafts[scope] = { text: asString(body.text), queuedMessage: body.queuedMessage };
        persistLocalState();
        return localJsonResponse({ success: true });
      }
    }
  }

  if (parts[0] === 'api' && parts[1] === 'settings') {
    if (parts[2] === 'api-keys') {
      if (parts.length === 3 && method === 'GET') return localJsonResponse({ success: true, apiKeys: localState.apiKeys });
      if (parts.length === 3 && method === 'POST') {
        const id = makeSessionId('key');
        const created: ApiKeyItem = { id, key_name: asString(body.keyName, 'Local key'), api_key: 'cld_demo_••••••••', created_at: new Date().toISOString(), last_used: null, is_active: true };
        localState.apiKeys.push(created);
        persistLocalState();
        return localJsonResponse({ success: true, apiKey: { id, keyName: created.key_name, apiKey: `cld_demo_${id}`, createdAt: created.created_at } });
      }
      if (parts.length === 4 && method === 'DELETE') {
        localState.apiKeys = localState.apiKeys.filter((item) => item.id !== parts[3]);
        persistLocalState();
        return localJsonResponse({ success: true, apiKeys: localState.apiKeys });
      }
      if (parts.length === 5 && parts[3] && parts[4] === 'toggle' && method === 'PATCH') {
        const key = localState.apiKeys.find((item) => item.id === parts[3]);
        if (!key) return localErrorResponse('API key not found', 404);
        key.is_active = Boolean(body.isActive);
        persistLocalState();
        return localJsonResponse({ success: true, apiKeys: localState.apiKeys });
      }
      return localErrorResponse(`Unsupported local API key route: ${method} ${path}`, 404);
    }
    if (parts[2] === 'credentials') {
      if (parts.length === 3 && method === 'GET') {
        const credentialType = parsedUrl.searchParams.get('type');
        const credentials = !credentialType || credentialType === 'github_token' ? localState.credentials : [];
        return localJsonResponse({ success: true, credentials });
      }
      if (parts.length === 3 && method === 'POST') {
        localState.credentials.push({ id: makeSessionId('credential'), credential_name: asString(body.credentialName, 'Local credential'), description: asString(body.description), created_at: new Date().toISOString(), is_active: true });
        persistLocalState();
        return localJsonResponse({ success: true });
      }
      if (parts.length === 4 && method === 'DELETE') {
        localState.credentials = localState.credentials.filter((item) => item.id !== parts[3]);
        persistLocalState();
        return localJsonResponse({ success: true, credentials: localState.credentials });
      }
      if (parts.length === 5 && parts[3] && parts[4] === 'toggle' && method === 'PATCH') {
        const credential = localState.credentials.find((item) => item.id === parts[3]);
        if (!credential) return localErrorResponse('Credential not found', 404);
        credential.is_active = Boolean(body.isActive);
        persistLocalState();
        return localJsonResponse({ success: true, credentials: localState.credentials });
      }
      return localErrorResponse(`Unsupported local credential route: ${method} ${path}`, 404);
    }
    if (parts[2] === 'notification-preferences') {
      if (parts.length === 3 && method === 'GET') return localJsonResponse({ success: true, preferences: localState.notificationPreferences });
      if (parts.length === 3 && method === 'PUT') {
        localState.notificationPreferences = body as unknown as NotificationPreferencesState;
        persistLocalState();
        return localJsonResponse({ success: true, preferences: localState.notificationPreferences });
      }
    }
    if (parts[2] === 'push' && parts.length >= 3) return localErrorResponse('Web Push is unsupported in local demo mode', 501);
  }

  if (parts[0] === 'api' && parts[1] === 'plugins') {
    if (parts.length === 2 && method === 'GET') return localJsonResponse({ plugins: localState.plugins });
    if (parts[2] === 'install' && parts.length === 3 && method === 'POST') {
      const urlValue = asString(body.url).trim();
      if (!urlValue) return localErrorResponse('Plugin URL is required', 400);
      const plugin = createLocalPlugin(urlValue);
      if (localState.plugins.some((item) => item.name === plugin.name)) {
        return localErrorResponse(`Plugin already installed: ${plugin.name}`, 409);
      }
      localState.plugins.push(plugin);
      persistLocalState();
      return localJsonResponse({ success: true, plugin, plugins: localState.plugins });
    }
    if (parts[2] === 'assets' || parts[3] === 'assets') {
      return localErrorResponse('Plugin assets are unsupported in local demo mode', 501);
    }
    if (parts[2] === 'rpc' || parts[3] === 'rpc') {
      return localErrorResponse('Plugin RPC is unsupported in local demo mode', 501);
    }

    const pluginName = parts[2];
    const plugin = pluginName ? localState.plugins.find((item) => item.name === pluginName) : undefined;
    if (!plugin) return localErrorResponse('Plugin not found', 404);
    if (parts[3] === 'update' && parts.length === 4 && method === 'POST') {
      plugin.version = bumpLocalPluginVersion(plugin.version);
      plugin.serverRunning = false;
      persistLocalState();
      return localJsonResponse({ success: true, plugin, plugins: localState.plugins });
    }
    if (parts[3] === 'enable' && parts.length === 4 && method === 'PUT') {
      plugin.enabled = Boolean(body.enabled);
      if (!plugin.enabled) plugin.serverRunning = false;
      persistLocalState();
      return localJsonResponse({ success: true, plugin, plugins: localState.plugins });
    }
    if (parts.length === 3 && method === 'DELETE') {
      localState.plugins = localState.plugins.filter((item) => item.name !== plugin.name);
      persistLocalState();
      return localJsonResponse({ success: true, removed: true, plugins: localState.plugins });
    }
    return localErrorResponse(`Unsupported local plugin route: ${method} ${path}`, 404);
  }

  if (parts[0] === 'api' && parts[1] === 'taskmaster') {
    if (parts[2] === 'installation-status' && parts.length === 3 && method === 'GET') return localJsonResponse({ isReady: false, installation: { isInstalled: false } });
    if (parts[2] === 'mcp-status' && parts.length === 3 && method === 'GET') return localJsonResponse({ hasMCPServer: false, isConfigured: false, hasApiKeys: false, reason: 'Disabled in local demo mode' });
    if (parts[2] === 'tasks' && parts.length === 4 && method === 'GET') return localJsonResponse({ tasks: [] });
    if (parts[2] === 'update-task') return localErrorResponse('TaskMaster updates are unsupported in local demo mode', 501);
    if (parts[2] === 'prd') {
      const projectId = parts[3];
      if (!projectId || !getProject(projectId)) return localErrorResponse('Project not found', 404);
      const files = localState.prdFiles[projectId] ?? (localState.prdFiles[projectId] = []);
      if (parts.length === 4 && method === 'GET') {
        return localJsonResponse({ prdFiles: files, prds: files, files });
      }
      if (parts.length === 4 && method === 'POST') {
        const fileName = asString(body.fileName).trim();
        if (!fileName) return localErrorResponse('PRD filename is required', 400);
        const content = asString(body.content);
        const now = new Date().toISOString();
        const previous = files.find((file) => file.name === fileName);
        const prd: PrdFile = {
          name: fileName,
          content,
          isExisting: true,
          path: `.taskmaster/docs/${fileName}`,
          created: previous?.created || now,
          modified: now,
          size: content.length,
        };
        const nextFiles = previous
          ? files.map((file) => file.name === fileName ? prd : file)
          : [...files, prd];
        localState.prdFiles[projectId] = nextFiles;
        persistLocalState();
        return localJsonResponse({ success: true, prdFile: prd, file: prd, prdFiles: nextFiles, prds: nextFiles });
      }
      if (parts.length === 5 && method === 'GET') {
        const fileName = parts[4];
        const prd = files.find((file) => file.name === fileName);
        if (!prd) return localErrorResponse('PRD file not found', 404);
        return localJsonResponse({ success: true, file: prd, content: prd.content ?? '' });
      }
      return localErrorResponse(`Unsupported local PRD route: ${method} ${path}`, 404);
    }
  }

  if (parts[0] === 'api' && parts[1] === 'browser-use') {
    if (parts.length === 3 && parts[2] === 'settings' && method === 'GET') return localJsonResponse({ success: true, data: { settings: localState.browserUseSettings } });
    if (parts.length === 3 && parts[2] === 'status' && method === 'GET') return localJsonResponse({ success: true, data: { enabled: false, available: false, playwrightInstalled: false, chromiumInstalled: false, installInProgress: false } });
    if (parts.length === 3 && parts[2] === 'sessions' && method === 'GET') return localJsonResponse({ success: true, data: { sessions: [] } });
    if (parts.length === 3 && parts[2] === 'settings' && method === 'PUT') {
      localState.browserUseSettings = { enabled: Boolean(body.enabled) };
      persistLocalState();
      return localJsonResponse({ success: true, data: { settings: localState.browserUseSettings } });
    }
    return localErrorResponse('Browser Use runtime is unsupported in local demo mode', 501);
  }

  if (parts[0] === 'api' && parts[1] === 'voice') {
    if (parts.length === 3 && parts[2] === 'health' && method === 'GET') return localJsonResponse({ configured: false, available: false });
    if (parts.length === 3 && parts[2] === 'transcribe' && method === 'POST') {
      return localErrorResponse('Voice transcription and speech synthesis are unsupported in local demo mode', 501);
    }
    if (parts.length === 3 && parts[2] === 'tts' && method === 'POST') {
      return localErrorResponse('Voice transcription and speech synthesis are unsupported in local demo mode', 501);
    }
  }

  if (parts[0] === 'api' && parts[1] === 'system') {
    return localErrorResponse('System updates are unsupported in local demo mode', 501);
  }

  return localErrorResponse(`Unsupported local route: ${method} ${path}`, 404);
};

// Utility function for local authenticated API calls. It intentionally never
// delegates to the browser networking stack; all route names are fixture keys.
export const authenticatedFetch = async (
  url: string,
  options: ApiRequestOptions = {},
): Promise<Response> => {
  // Keep the auth-token read in this compatibility helper so existing callers
  // retain the same expired-token cleanup behavior without sending a header.
  getStoredAuthToken();
  const response = await handleLocalRequest(url, options);
  const refreshedToken = response.headers.get('X-Refreshed-Token');
  if (refreshedToken) storeAuthToken(refreshedToken);
  if (response.headers.get('X-Auth-Error')) expireAuthSession();
  return response;
};

// ─── Request helpers ────────────────────────────────────────────────────────
// Every endpoint below goes through these so verb, JSON encoding and query
// serialization stay consistent across the whole frontend.

type QueryValue = string | number | boolean | null | undefined;

// Serializes a query object into `?a=1&b=2` (or an empty string). Empty and
// `false` values are dropped so optional flags can be passed unconditionally.
const query = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === false) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
};

/**
 * Reads a `{ success, error, details }` envelope response, throwing the server's
 * message when the request failed.
 *
 * Endpoints return a bare Response, so call sites unwrap it themselves. Most do
 * so in ways that differ deliberately (bare casts where the caller inspects the
 * payload, abort-aware reads in the git panel); this is the shared form for
 * callers that want a failed request to throw.
 */
export class ApiRequestError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(message: string, options: { code?: string; details?: unknown; status: number }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options.code;
    this.details = options.details;
    this.status = options.status;
  }
}

/**
 * Reads a `{ success, error, details }` envelope response, throwing an
 * ApiRequestError carrying the server's machine-readable error code when one
 * is present. Accepts both legacy string envelopes (`error: 'message'`) and
 * the structured AppError envelope (`error: { code, message, details }`).
 */
export async function readApiJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    const raw = data.error ?? data.details;
    const payload = raw && typeof raw === 'object' ? raw : {};
    const message = (typeof raw === 'string' ? raw : payload?.message) || data.details || `Request failed (${response.status})`;
    throw new ApiRequestError(message, {
      code: typeof payload?.code === 'string' ? payload.code : undefined,
      details: payload?.details ?? data.details,
      status: response.status,
    });
  }
  return data as T;
}
const get = (url: string, options: ApiRequestOptions = {}) => authenticatedFetch(url, options);

const withBody =
  (method: string) =>
    (url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      authenticatedFetch(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...options,
      });

const post = withBody('POST');
const put = withBody('PUT');
const patch = withBody('PATCH');
const del = withBody('DELETE');

// ─── URL builders ───────────────────────────────────────────────────────────
// URL builders remain exported for compatibility with callers that need to
// identify a fixture route before handing it to the local transport.

/**
 * Persisted messages for one session. Omitting `limit` requests the whole
 * transcript; passing one always pairs it with an explicit offset so automatic
 * refreshes can never accidentally become an unbounded transcript request.
 */
export const sessionMessagesUrl = (
  sessionId: string,
  { limit = null, offset = 0 }: { limit?: number | null; offset?: number } = {},
): string => {
  const base = `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`;
  return limit === null || limit === undefined
    ? base
    : `${base}${query({ limit, offset: offset ?? 0 })}`;
};

const fileContentPath = (projectId: string, filePath: string) =>
  `/api/file-tree/projects/${projectId}/files/content${query({ path: filePath })}`;

const pluginAssetPath = (pluginName: string, assetFile: string) =>
  `/api/plugins/${encodeURIComponent(pluginName)}/assets/${encodeURIComponent(assetFile)}`;

// ─── API endpoints ──────────────────────────────────────────────────────────
// Every `/api/...` path the frontend talks to is declared here; components
// import a named method instead of assembling URLs of their own.

export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => authenticatedFetch('/api/auth/status'),
    login: (username: string, password: string) => authenticatedFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username: string, password: string) => authenticatedFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    refresh: () => post('/api/auth/refresh'),
    user: () => get('/api/auth/user'),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: () => get('/api/projects'),
  archivedProjects: () => get('/api/projects/archived'),
  projectSessions: (
    projectId: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    options: ApiRequestOptions = {},
  ) =>
    get(
      `/api/projects/${encodeURIComponent(projectId)}/sessions${query({ limit, offset })}`,
      options,
    ),
  projectTaskmaster: (projectId: string) =>
    get(`/api/projects/${encodeURIComponent(projectId)}/taskmaster`),
  renameProject: (projectId: string, displayName: string) =>
    put(`/api/projects/${projectId}/rename`, { displayName }),
  restoreProject: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/restore`),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId: string, hardDelete = false) =>
    del(`/api/projects/${projectId}${query({ force: hardDelete })}`),
  createProject: (projectData: unknown) => post('/api/projects/create-project', projectData),
  migrateLegacyProjectStars: (projectIds: string[]) =>
    post('/api/projects/migrate-legacy-stars', { projectIds }),
  toggleProjectStar: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`),
  // The token query parameter is retained in this compatibility URL builder;
  // local transport calls never send it over the network.
  cloneProjectProgressUrl: (params: Record<string, QueryValue>) =>
    `/api/projects/clone-progress${query({ ...params, token: getStoredAuthToken() })}`,
  searchConversationsUrl: (searchQuery: string, limit = 50) =>
    `/api/providers/search/sessions${query({
      q: searchQuery,
      limit,
      token: getStoredAuthToken(),
    })}`,

  // Session endpoints. Provider/project metadata are resolved by the backend
  // from the session id.
  // Session deletion mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId: string, hardDelete = false) =>
    del(`/api/providers/sessions/${sessionId}${query({ force: hardDelete })}`),
  getArchivedSessions: () => get('/api/providers/sessions/archived'),
  // Resolves one session (by app id or provider-native id) to its metadata and
  // owning project — used when a /session/<id> URL isn't in loaded payloads.
  sessionDetails: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}`),
  runningSessions: () => get('/api/providers/sessions/running'),
  recentConversations: ({ limit = 40, offset = 0 }: { limit?: number; offset?: number } = {}) =>
    get(`/api/providers/sessions/recent${query({ limit, offset })}`),
  providerSessionId: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/provider-id`),
  restoreSession: (sessionId: string) => post(`/api/providers/sessions/${sessionId}/restore`),
  // Creates an independent session holding this one's conversation up to
  // `upToAnchorId` (all of it when omitted). The source is left untouched.
  forkSession: (sessionId: string, body: { upToAnchorId?: string; title?: string } = {}) =>
    post(`/api/providers/sessions/${encodeURIComponent(sessionId)}/fork`, body),
  renameSession: (sessionId: string, summary: string) =>
    put(`/api/providers/sessions/${sessionId}`, { summary }),

  // Scheduled messages: send a message to a session at a future time.
  scheduledMessages: {
    list: (sessionId?: string) =>
      get(`/api/scheduled-messages${sessionId ? query({ sessionId }) : ''}`),
    create: (body: { sessionId: string; content: string; scheduledFor: string; options?: unknown }) =>
      post('/api/scheduled-messages', body),
    cancel: (id: string) => del(`/api/scheduled-messages/${encodeURIComponent(id)}`),
  },

  // Workspace file tree
  readFile: (projectId: string, filePath: string) =>
    get(`/api/file-tree/projects/${projectId}/file${query({ filePath })}`),
  // Raw bytes for a workspace file. The endpoint requires the auth header, so
  // media call sites fetch a blob through here instead of using a bare `src`.
  readFileBlob: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
    get(fileContentPath(projectId, filePath), options),
  saveFile: (projectId: string, filePath: string, content: string) =>
    put(`/api/file-tree/projects/${projectId}/file`, { filePath, content }),
  getFiles: (projectId: string, options: ApiRequestOptions = {}) =>
    get(`/api/file-tree/projects/${projectId}/files${query({ respectGitignore: true })}`, options),

  // File operations
  createFile: (
    projectId: string,
    { path, type, name }: { path: string; type: string; name: string },
  ) => post(`/api/file-tree/projects/${projectId}/files/create`, { path, type, name }),

  renameFile: (projectId: string, { oldPath, newName }: { oldPath: string; newName: string }) =>
    put(`/api/file-tree/projects/${projectId}/files/rename`, { oldPath, newName }),

  deleteFile: (projectId: string, { path, type }: { path: string; type: string }) =>
    del(`/api/file-tree/projects/${projectId}/files`, { path, type }),

  // Upload progress consumers use this fixture route as their local API key.
  uploadFilesUrl: (projectId: string) =>
    `/api/file-tree/projects/${encodeURIComponent(projectId)}/files/upload`,

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath: string | null = null) =>
    get(`/api/file-tree/browse-filesystem${query({ path: dirPath })}`),

  createFolder: (folderPath: string) => post('/api/file-tree/create-folder', { path: folderPath }),

  // Git endpoints. The `project` param carries the DB projectId post-migration.
  git: {
    status: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/status${query({ project: projectId })}`, options),
    diff: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/diff${query({ project: projectId, file: filePath })}`, options),
    commitDiff: (projectId: string, commit: string) =>
      get(`/api/git/commit-diff${query({ project: projectId, commit })}`),
    fileWithDiff: (projectId: string, filePath: string) =>
      get(`/api/git/file-with-diff${query({ project: projectId, file: filePath })}`),
    branches: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branches${query({ project: projectId })}`, options),
    remoteStatus: (projectId: string) =>
      get(`/api/git/remote-status${query({ project: projectId })}`),
    commits: (
      projectId: string,
      { limit }: { limit?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(`/api/git/commits${query({ project: projectId, limit })}`, options),
    checkout: (projectId: string, branch: string) =>
      post('/api/git/checkout', { project: projectId, branch }),
    createBranch: (projectId: string, branch: string) =>
      post('/api/git/create-branch', { project: projectId, branch }),
    deleteBranch: (projectId: string, branch: string, force = false) =>
      post('/api/git/delete-branch', { project: projectId, branch, force }),
    fetch: (projectId: string) => post('/api/git/fetch', { project: projectId }),
    pull: (projectId: string) => post('/api/git/pull', { project: projectId }),
    push: (projectId: string) => post('/api/git/push', { project: projectId }),
    publish: (projectId: string, branch: string) =>
      post('/api/git/publish', { project: projectId, branch }),
    discard: (projectId: string, file: string) =>
      post('/api/git/discard', { project: projectId, file }),
    deleteUntracked: (projectId: string, file: string) =>
      post('/api/git/delete-untracked', { project: projectId, file }),
    stage: (projectId: string, files: string[]) =>
      post('/api/git/stage', { project: projectId, files }),
    unstage: (projectId: string, files: string[]) =>
      post('/api/git/unstage', { project: projectId, files }),
    commit: (projectId: string, message: string, files: string[]) =>
      post('/api/git/commit', { project: projectId, message, files }),
    initialCommit: (projectId: string) => post('/api/git/initial-commit', { project: projectId }),
    init: (projectId: string) => post('/api/git/init', { project: projectId }),
    revertLocalCommit: (projectId: string) =>
      post('/api/git/revert-local-commit', { project: projectId }),
    generateCommitMessage: (projectId: string, files: string[], provider: string) =>
      post('/api/git/generate-commit-message', { project: projectId, files, provider }),
  },

  worktrees: {
    list: (projectId: string) => get(`/api/worktrees${query({ project: projectId })}`),
    create: (
      projectId: string,
      { branch, baseBranch }: { branch: string; baseBranch: string | null },
    ) => post('/api/worktrees/create', { project: projectId, branch, baseBranch }),
    open: (projectId: string, worktreePath: string) =>
      post('/api/worktrees/open', { project: projectId, worktreePath }),
    merge: (
      projectId: string,
      worktreePath: string,
      options: { squash?: boolean; message?: string; removeAfterMerge?: boolean },
    ) => post('/api/worktrees/merge', { project: projectId, worktreePath, ...options }),
    remove: (
      projectId: string,
      worktreePath: string,
      options: { force?: boolean; deleteBranch?: boolean },
    ) => post('/api/worktrees/remove', { project: projectId, worktreePath, ...options }),
  },

  // Provider (coding agent) endpoints — models, capabilities, sessions, MCP, skills.
  providers: {
    capabilities: () => get('/api/providers/capabilities'),
    authStatus: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/auth/status`),

    models: (provider: string) => get(`/api/providers/${provider}/models`),
    createModel: (provider: string, input: unknown) =>
      post(`/api/providers/${provider}/models`, input),
    updateModel: (provider: string, recordId: string | number, input: unknown) =>
      patch(`/api/providers/${provider}/models/${recordId}`, input),
    deleteModel: (provider: string, recordId: string | number) =>
      del(`/api/providers/${provider}/models/${recordId}`),

    createSession: (payload: {
      provider: string;
      projectPath: string;
      initialMessage?: unknown;
    }) => post('/api/providers/sessions', payload),
    sessionMessages: (
      sessionId: string,
      pagination: { limit?: number | null; offset?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(sessionMessagesUrl(sessionId, pagination), options),
    sessionTokenUsage: (sessionId: string) =>
      get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/token-usage`),
    sessionActiveModel: (provider: string, sessionId: string) =>
      get(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`),
    setSessionActiveModel: (provider: string, sessionId: string, model: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`, {
        model,
      }),
    setSessionActiveEffort: (provider: string, sessionId: string, effort: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-effort`, {
        effort,
      }),

    mcpServers: (
      provider: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) => get(`/api/providers/${provider}/mcp/servers${query({ scope, workspacePath })}`),
    saveMcpServer: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/mcp/servers`, payload),
    deleteMcpServer: (
      provider: string,
      serverName: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) =>
      del(
        `/api/providers/${provider}/mcp/servers/${encodeURIComponent(serverName)}${query({ scope, workspacePath })}`,
      ),
    saveGlobalMcpServer: (payload: unknown) => post('/api/providers/mcp/servers/global', payload),

    skills: (provider: string, { workspacePath }: { workspacePath?: string } = {}) =>
      get(`/api/providers/${encodeURIComponent(provider)}/skills${query({ workspacePath })}`),
    saveSkills: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/skills`, payload),
  },

  // Slash commands
  commands: {
    // `projectPath` stays optional: a workspace without a resolved path omits
    // the field entirely, which is what the server expects.
    list: (projectPath: string | undefined) => post('/api/commands/list', { projectPath }),
    execute: (payload: unknown) => post('/api/commands/execute', payload),
  },

  // Chat attachments, stored in the browser-local runtime fixture.
  assets: {
    uploadFiles: (formData: FormData) =>
      authenticatedFetch('/api/assets/files', {
        method: 'POST',
        headers: {}, // Let browser set Content-Type for FormData
        body: formData,
      }),
    file: (storedName: string) => get(`/api/assets/files/${encodeURIComponent(storedName)}`),
    image: (filename: string, options: ApiRequestOptions = {}) =>
      get(`/api/assets/images/${encodeURIComponent(filename)}`, options),
  },

  // TaskMaster endpoints — all addressed by DB projectId post-migration.
  taskmaster: {
    // Update a task
    updateTask: (projectId: string, taskId: string | number, updates: unknown) =>
      put(`/api/taskmaster/update-task/${projectId}/${taskId}`, updates),

    tasks: (projectId: string) => get(`/api/taskmaster/tasks/${encodeURIComponent(projectId)}`),
    mcpStatus: () => get('/api/taskmaster/mcp-status'),
    installationStatus: () => get('/api/taskmaster/installation-status'),

    prdFiles: (projectId: string) => get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`),
    prdFile: (projectId: string, fileName: string) =>
      get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`),
    savePrd: (projectId: string, { fileName, content }: { fileName: string; content: string }) =>
      post(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`, { fileName, content }),
  },

  // User endpoints
  user: {
    gitConfig: () => get('/api/user/git-config'),
    updateGitConfig: (gitName: string, gitEmail: string) =>
      post('/api/user/git-config', { gitName, gitEmail }),
    onboardingStatus: () => get('/api/user/onboarding-status'),
    completeOnboarding: () => post('/api/user/complete-onboarding'),

    // Preferences and chat drafts live in the browser-local runtime. `savePreferences`
    // is a merge-patch: only the keys it is given are written.
    preferences: () => get('/api/user/preferences'),
    savePreferences: (updates: Record<string, unknown>) =>
      patch('/api/user/preferences', updates),
    drafts: () => get('/api/user/drafts'),
    saveDraft: (scope: string, draft: { text: string; queuedMessage?: unknown }) =>
      put('/api/user/drafts', { scope, ...draft }),
    deleteDraft: (scope: string) => del('/api/user/drafts', { scope }),
  },

  // Local settings: API keys, stored credentials, notifications, web push
  settings: {
    apiKeys: () => get('/api/settings/api-keys'),
    createApiKey: (keyName: string) => post('/api/settings/api-keys', { keyName }),
    deleteApiKey: (keyId: string) => del(`/api/settings/api-keys/${keyId}`),
    toggleApiKey: (keyId: string, isActive: boolean) =>
      patch(`/api/settings/api-keys/${keyId}/toggle`, { isActive }),

    credentials: (type: string) => get(`/api/settings/credentials${query({ type })}`),
    createCredential: (payload: {
      credentialName: string;
      credentialType: string;
      credentialValue: string;
      description?: string;
    }) => post('/api/settings/credentials', payload),
    deleteCredential: (credentialId: string) => del(`/api/settings/credentials/${credentialId}`),
    toggleCredential: (credentialId: string, isActive: boolean) =>
      patch(`/api/settings/credentials/${credentialId}/toggle`, { isActive }),

    notificationPreferences: () => get('/api/settings/notification-preferences'),
    saveNotificationPreferences: (preferences: unknown) =>
      put('/api/settings/notification-preferences', preferences),

    push: {
      vapidPublicKey: () => get('/api/settings/push/vapid-public-key'),
      subscribe: (subscription: { endpoint?: string; keys?: unknown }) =>
        post('/api/settings/push/subscribe', subscription),
      unsubscribe: (endpoint: string) => post('/api/settings/push/unsubscribe', { endpoint }),
    },
  },

  plugins: {
    list: () => get('/api/plugins'),
    install: (url: string) => post('/api/plugins/install', { url }),
    uninstall: (name: string) => del(`/api/plugins/${encodeURIComponent(name)}`),
    update: (name: string) => post(`/api/plugins/${encodeURIComponent(name)}/update`),
    toggle: (name: string, enabled: boolean) =>
      put(`/api/plugins/${encodeURIComponent(name)}/enable`, { enabled }),
    // Plugin bundles/icons are disabled in local demo mode and never fetched
    // from an external runtime.
    asset: (pluginName: string, assetFile: string) => get(pluginAssetPath(pluginName, assetFile)),
    // Exposed so the icon cache can key on the resolved asset path.
    assetUrl: pluginAssetPath,
    rpc: (pluginName: string, method: string, path: string, body?: unknown) =>
      authenticatedFetch(
        `/api/plugins/${encodeURIComponent(pluginName)}/rpc/${String(path).replace(/^\//, '')}`,
        {
          method: method || 'GET',
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      ),
  },

  browserUse: {
    status: () => get('/api/browser-use/status'),
    settings: () => get('/api/browser-use/settings'),
    saveSettings: (settings: unknown) => put('/api/browser-use/settings', settings),
    sessions: () => get('/api/browser-use/sessions'),
    stopSession: (sessionId: string) => post(`/api/browser-use/sessions/${sessionId}/stop`),
    deleteSession: (sessionId: string) => del(`/api/browser-use/sessions/${sessionId}`),
    installRuntime: () => post('/api/browser-use/runtime/install'),
  },

  voice: {
    health: () => get('/api/voice/health'),
    transcribe: (formData: FormData, headers: Record<string, string> = {}) =>
      authenticatedFetch('/api/voice/transcribe', {
        method: 'POST',
        headers,
        body: formData,
      }),
    tts: (text: string, options: ApiRequestOptions = {}) => post('/api/voice/tts', { text }, options),
  },

  system: {
    update: () => post('/api/system/update'),
  },
};

// ---------------------------

//----------------- VOICE TRANSCRIPTION AND SPEECH ------------

/**
 * Serializes the active voice configuration so callers can detect a settings change and
 * drop cached synthesized audio.
 */
export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
}

/**
 * Exposes the disabled local voice route for legacy callers. Configured remote
 * voice endpoints are intentionally ignored in browser-only demo mode.
 */
export function transcribeVoice(blob: Blob, filename: string): Promise<Response> {
  const body = new FormData();

  body.append('audio', blob, filename);
  return api.voice.transcribe(body, voiceConfigHeaders());
}

/**
 * Exposes the disabled local speech route for legacy callers. Configured remote
 * voice endpoints are intentionally ignored in browser-only demo mode.
 */
export function synthesizeVoice(text: string, signal: AbortSignal): Promise<Response> {
  return api.voice.tts(text, { headers: voiceConfigHeaders(), signal });
}
