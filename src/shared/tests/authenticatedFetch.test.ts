import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';
import {
  api,
  authenticatedFetch,
  LOCAL_DEMO_TOKEN,
  LOCAL_DEMO_USER,
  subscribeToLocalEvents,
} from '@/shared/api';

/** The request compatibility helper must stay inside the browser-local runtime. */
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('authenticatedFetch resolves a local project fixture without calling fetch', async () => {
  const response = await authenticatedFetch('/api/projects');
  const projects = await response.json() as Array<{ projectId: string }>;

  assert.equal(response.ok, true);
  assert.equal(projects[0]?.projectId, 'demo-project');
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('auth endpoints return the local demo identity without calling fetch', async () => {
  const response = await api.auth.login('any-user', 'any-password');
  const payload = await response.json() as { token?: string; user?: typeof LOCAL_DEMO_USER };

  assert.deepEqual(payload, { token: LOCAL_DEMO_TOKEN, user: LOCAL_DEMO_USER });
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('an expired token is cleared while the local request still resolves', async () => {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  localStorage.setItem(
    'auth-token',
    `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iat: now - 7200, exp: now - 3600 })}.signature`,
  );

  let expiries = 0;
  const onExpired = () => {
    expiries += 1;
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);

  await authenticatedFetch('/api/projects');

  window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  assert.equal(localStorage.getItem('auth-token'), null);
  assert.equal(expiries, 1);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('a FormData request is parsed by the local fixture transport', async () => {
  const formData = new FormData();
  formData.append('targetPath', 'src');
  formData.append('requestedFileCount', '0');
  formData.append('relativePaths', '[]');

  const response = await authenticatedFetch('/api/file-tree/projects/demo-project/files/upload', {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json() as { uploadedCount?: number };

  assert.equal(payload.uploadedCount, 0);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('unknown local routes return a non-success response', async () => {
  const response = await authenticatedFetch('/api/local-route-that-does-not-exist');
  const payload = await response.json() as { success?: boolean; message?: string };

  assert.equal(response.ok, false);
  assert.equal(response.status, 404);
  assert.equal(payload.success, false);
  assert.match(payload.message || '', /Unsupported local route/);
});

test('unsupported backend capabilities return explicit 501 responses', async () => {
  const responses = await Promise.all([
    api.git.push('demo-project'),
    api.worktrees.create('demo-project', { branch: 'local-worktree', baseBranch: 'main' }),
    api.commands.execute({ commandName: '/not-a-local-command' }),
    api.taskmaster.updateTask('demo-project', '1', { status: 'done' }),
    api.browserUse.stopSession('missing-session'),
    api.voice.tts('local demo speech'),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [501, 501, 501, 501, 501, 501]);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('session archive, restore, and hard-delete preserve the expected lifecycle', async () => {
  const createdResponse = await api.providers.createSession({
    provider: 'claude',
    projectPath: '/workspace/cloudcli-demo',
    initialMessage: `Lifecycle ${Date.now()}`,
  });
  const created = await createdResponse.json() as { data?: { sessionId?: string } };
  const sessionId = created.data?.sessionId;
  assert.equal(createdResponse.ok, true);
  assert.equal(typeof sessionId, 'string');

  const archivedResponse = await api.deleteSession(sessionId || '', false);
  assert.equal(archivedResponse.ok, true);
  const archived = await api.getArchivedSessions();
  const archivedPayload = await archived.json() as { data?: { sessions?: Array<{ sessionId: string }> } };
  assert.ok(archivedPayload.data?.sessions?.some((session) => session.sessionId === sessionId));

  const activeSessions = await api.projectSessions('demo-project');
  const activePayload = await activeSessions.json() as { sessions?: Array<{ id: string }> };
  assert.equal(activePayload.sessions?.some((session) => session.id === sessionId), false);

  const restoredResponse = await api.restoreSession(sessionId || '');
  assert.equal(restoredResponse.ok, true);
  const restoredSessions = await api.projectSessions('demo-project');
  const restoredPayload = await restoredSessions.json() as { sessions?: Array<{ id: string }> };
  assert.equal(restoredPayload.sessions?.some((session) => session.id === sessionId), true);

  const deletedResponse = await api.deleteSession(sessionId || '', true);
  assert.equal(deletedResponse.ok, true);
  const detailsResponse = await api.sessionDetails(sessionId || '');
  assert.equal(detailsResponse.status, 404);
});

test('fork returns a session name and announces the new session locally', async () => {
  const createdResponse = await api.providers.createSession({
    provider: 'claude',
    projectPath: '/workspace/cloudcli-demo',
    initialMessage: `Fork source ${Date.now()}`,
  });
  const created = await createdResponse.json() as { data?: { sessionId?: string } };
  const sourceSessionId = created.data?.sessionId || '';
  const events: Array<{ kind?: string; sessionId?: string }> = [];
  const unsubscribe = subscribeToLocalEvents((event) => events.push(event));

  const forkResponse = await api.forkSession(sourceSessionId);
  const forkPayload = await forkResponse.json() as { data?: { sessionId?: string; sessionName?: string } };
  await new Promise((resolve) => setTimeout(resolve, 0));
  unsubscribe();

  const forkedSessionId = forkPayload.data?.sessionId || '';
  assert.equal(forkResponse.ok, true);
  assert.equal(typeof forkPayload.data?.sessionName, 'string');
  assert.ok(events.some((event) => event.kind === 'session_upserted' && event.sessionId === forkedSessionId));

  await api.deleteSession(sourceSessionId, true);
  await api.deleteSession(forkedSessionId, true);
});

test('binary assets round-trip as bytes instead of text', async () => {
  const bytes = new Uint8Array([0, 255, 1, 128, 10]);
  const formData = new FormData();
  formData.append('files', new Blob([bytes], { type: 'application/octet-stream' }), 'binary.bin');

  const uploadResponse = await api.assets.uploadFiles(formData);
  const uploadPayload = await uploadResponse.json() as { attachments?: Array<{ path?: string }> };
  const storedName = uploadPayload.attachments?.[0]?.path || '';
  const assetResponse = await api.assets.file(storedName);
  const roundTripped = new Uint8Array(await assetResponse.arrayBuffer());

  assert.equal(uploadResponse.ok, true);
  assert.equal(assetResponse.headers.get('Content-Type'), 'application/octet-stream');
  assert.deepEqual(Array.from(roundTripped), Array.from(bytes));
});

test('created folders remain directories in the local file tree', async () => {
  const folderName = `empty-folder-${Date.now()}`;
  const createResponse = await api.createFile('demo-project', {
    path: '',
    type: 'directory',
    name: folderName,
  });
  const treeResponse = await api.getFiles('demo-project');
  const tree = await treeResponse.json() as Array<{ path: string; type: string }>;

  assert.equal(createResponse.ok, true);
  assert.equal(tree.find((node) => node.path === folderName)?.type, 'directory');
  await api.deleteFile('demo-project', { path: folderName, type: 'directory' });
});

test('filesystem folder fixtures persist as directories', async () => {
  const folderPath = `/workspace/local-folder-${Date.now()}`;
  const createResponse = await api.createFolder(folderPath);
  const createPayload = await createResponse.json() as { path?: string; type?: string };
  const browseResponse = await api.browseFilesystem(folderPath);
  const browsePayload = await browseResponse.json() as { suggestions?: Array<{ path?: string; type?: string }> };

  assert.equal(createResponse.ok, true);
  assert.deepEqual(createPayload, { success: true, path: folderPath, type: 'directory' });
  assert.equal(browsePayload.suggestions?.some((suggestion) => suggestion.path === folderPath && suggestion.type === 'directory'), true);
});

test('global MCP writes return created results and are visible to provider reads', async () => {
  const serverName = `global-mcp-${Date.now()}`;
  const saveResponse = await api.providers.saveGlobalMcpServer({
    name: serverName,
    scope: 'user',
    transport: 'stdio',
    command: 'local-demo',
  });
  const savePayload = await saveResponse.json() as { data?: { results?: Array<{ provider: string; created: boolean }> } };
  const results = savePayload.data?.results || [];
  const providerResponse = await api.providers.mcpServers('claude', { scope: 'user' });
  const providerPayload = await providerResponse.json() as { data?: { servers?: Array<{ name?: string }> } };

  assert.equal(saveResponse.ok, true);
  assert.ok(results.length > 0);
  assert.equal(results.every((result) => result.created), true);
  assert.equal(providerPayload.data?.servers?.some((server) => server.name === serverName), true);

  for (const result of results) {
    await api.providers.deleteMcpServer(result.provider, serverName, { scope: 'user' });
  }
});

test('provider MCP save, list, and delete share user, project, and local scope keys', async () => {
  const stamp = Date.now();
  const projectPath = `/workspace/mcp-scope-${stamp}`;
  const scopedServers: Array<{ name: string; scope: 'user' | 'project' | 'local'; workspacePath?: string }> = [
    { name: `user-mcp-${stamp}`, scope: 'user' as const },
    { name: `project-mcp-${stamp}`, scope: 'project' as const, workspacePath: projectPath },
    { name: `local-mcp-${stamp}`, scope: 'local' as const, workspacePath: projectPath },
  ];

  for (const server of scopedServers) {
    const response = await api.providers.saveMcpServer('claude', {
      ...server,
      transport: 'stdio',
      command: 'local-demo',
    });
    const payload = await response.json() as { data?: { server?: { name?: string; scope?: string; workspacePath?: string } } };

    assert.equal(response.ok, true);
    assert.equal(payload.data?.server?.name, server.name);
    assert.equal(payload.data?.server?.scope, server.scope);
    assert.equal(payload.data?.server?.workspacePath, server.workspacePath);
  }

  const readNames = async (scope: string, workspacePath?: string): Promise<string[]> => {
    const response = await api.providers.mcpServers('claude', { scope, workspacePath });
    const payload = await response.json() as { data?: { servers?: Array<{ name?: string }> } };
    assert.equal(response.ok, true);
    return (payload.data?.servers || []).map((server) => server.name || '');
  };

  const userNames = await readNames('user');
  const projectNames = await readNames('project', projectPath);
  const localNames = await readNames('local', projectPath);

  assert.equal(userNames.includes(scopedServers[0].name), true);
  assert.equal(userNames.includes(scopedServers[1].name), false);
  assert.equal(userNames.includes(scopedServers[2].name), false);
  assert.equal(projectNames.includes(scopedServers[1].name), true);
  assert.equal(projectNames.includes(scopedServers[0].name), false);
  assert.equal(projectNames.includes(scopedServers[2].name), false);
  assert.equal(localNames.includes(scopedServers[2].name), true);
  assert.equal(localNames.includes(scopedServers[0].name), false);
  assert.equal(localNames.includes(scopedServers[1].name), false);

  for (const server of scopedServers) {
    await api.providers.deleteMcpServer('claude', server.name, {
      scope: server.scope,
      workspacePath: server.workspacePath,
    });
  }

  assert.equal((await readNames('user')).includes(scopedServers[0].name), false);
  assert.equal((await readNames('project', projectPath)).includes(scopedServers[1].name), false);
  assert.equal((await readNames('local', projectPath)).includes(scopedServers[2].name), false);
});

test('plugin install, update, toggle, and uninstall update local state', async () => {
  const pluginUrl = `local://fixture/plugin-${Date.now()}`;
  const installResponse = await api.plugins.install(pluginUrl);
  const installPayload = await installResponse.json() as { plugin?: { name?: string; enabled?: boolean } };
  const pluginName = installPayload.plugin?.name || '';

  const toggleResponse = await api.plugins.toggle(pluginName, true);
  const togglePayload = await toggleResponse.json() as { plugin?: { enabled?: boolean } };
  const updateResponse = await api.plugins.update(pluginName);
  const updatePayload = await updateResponse.json() as { plugin?: { version?: string } };
  const uninstallResponse = await api.plugins.uninstall(pluginName);

  assert.equal(installResponse.ok, true);
  assert.equal(installPayload.plugin?.enabled, false);
  assert.equal(togglePayload.plugin?.enabled, true);
  assert.equal(updatePayload.plugin?.version, '0.1.1');
  assert.equal(uninstallResponse.ok, true);
});

test('PRD list and save share fields and persist content locally', async () => {
  const fileName = `local-${Date.now()}.txt`;
  const content = '# Local PRD\n\nPersisted in the browser fixture.';
  const saveResponse = await api.taskmaster.savePrd('demo-project', { fileName, content });
  const savePayload = await saveResponse.json() as { prdFile?: { name?: string; content?: string; isExisting?: boolean } };
  const listResponse = await api.taskmaster.prdFiles('demo-project');
  const listPayload = await listResponse.json() as { prdFiles?: Array<{ name?: string; content?: string }> };
  const fileResponse = await api.taskmaster.prdFile('demo-project', fileName);
  const filePayload = await fileResponse.json() as { content?: string };

  assert.equal(saveResponse.ok, true);
  assert.equal(savePayload.prdFile?.name, fileName);
  assert.equal(savePayload.prdFile?.content, content);
  assert.equal(savePayload.prdFile?.isExisting, true);
  assert.equal(listPayload.prdFiles?.some((file) => file.name === fileName && file.content === content), true);
  assert.equal(filePayload.content, content);
});
