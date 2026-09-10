import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

test('defaults to Simplified Chinese when no language preference is saved', async () => {
  const { resetUserPreferences } = await import('@/shared/userSettings');
  resetUserPreferences();

  const { DEFAULT_LANGUAGE } = await import('@/modules/i18n/languages');
  const { default: i18n } = await import('@/modules/i18n/config');

  assert.equal(DEFAULT_LANGUAGE, 'zh-CN');
  assert.equal(i18n.language, 'zh-CN');
  assert.equal(i18n.t('tabs.chat'), '聊天');
  assert.equal(i18n.t('sessions.options', { ns: 'sidebar' }), '会话选项');
  assert.equal(i18n.t('running.emptyTitle', { ns: 'sidebar' }), '当前没有运行中的会话');
  assert.equal(i18n.t('input.dropFiles', { ns: 'chat' }), '将文件拖放到此处');
  assert.equal(i18n.t('claudeStatus.actions.thinking', { ns: 'chat' }), '思考中');
  assert.equal(i18n.t('modelLibrary.title', { ns: 'chat' }), '模型库');
  assert.equal(i18n.t('fileTree.dropToUpload'), '拖放文件以上传');
  assert.equal(i18n.t('board.status.pending', { ns: 'tasks' }), '待处理');
  assert.equal(i18n.t('prdEditor.generateTasks', { ns: 'tasks' }), '生成任务');
});

test('uses a saved language preference when it is supported', async () => {
  const { resetUserPreferences, writeUserPreference } = await import('@/shared/userSettings');
  resetUserPreferences();
  writeUserPreference('userLanguage', 'en');

  const { default: i18n } = await import('@/modules/i18n/config');

  assert.equal(i18n.language, 'en');
  assert.equal(i18n.t('tabs.chat'), 'Chat');
});
