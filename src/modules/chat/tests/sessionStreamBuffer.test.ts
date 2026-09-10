import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createSessionStreamBuffer } from '@/modules/chat/utils/sessionStreamBuffer';

test('keeps stream text and timers isolated for each session', () => {
  const buffer = createSessionStreamBuffer();

  buffer.append('session-a', 'A1');
  buffer.append('session-b', 'B1');
  buffer.append('session-a', 'A2');
  buffer.setTimer('session-a', 11);
  buffer.setTimer('session-b', 22);

  assert.equal(buffer.read('session-a'), 'A1A2');
  assert.equal(buffer.read('session-b'), 'B1');
  assert.equal(buffer.getTimer('session-a'), 11);
  assert.equal(buffer.getTimer('session-b'), 22);

  assert.equal(buffer.take('session-a'), 'A1A2');
  assert.equal(buffer.read('session-a'), '');
  assert.equal(buffer.read('session-b'), 'B1');
  assert.equal(buffer.getTimer('session-b'), 22);
});

test('clearAll returns every session timer for cleanup', () => {
  const buffer = createSessionStreamBuffer();
  buffer.append('session-a', 'A');
  buffer.setTimer('session-a', 11);
  buffer.append('session-b', 'B');
  buffer.setTimer('session-b', 22);

  assert.deepEqual(buffer.clearAll(), [
    { sessionId: 'session-a', text: 'A', timerId: 11 },
    { sessionId: 'session-b', text: 'B', timerId: 22 },
  ]);
  assert.equal(buffer.read('session-a'), '');
  assert.equal(buffer.getTimer('session-b'), null);
});

test('clearing the newly selected session does not remove another session prefix', () => {
  const buffer = createSessionStreamBuffer();
  buffer.append('session-a', 'A prefix');
  buffer.setTimer('session-a', 11);
  buffer.append('session-b', 'B prefix');
  buffer.setTimer('session-b', 22);

  assert.deepEqual(buffer.clearSession('session-b'), {
    sessionId: 'session-b',
    text: 'B prefix',
    timerId: 22,
  });
  assert.equal(buffer.read('session-a'), 'A prefix');
  assert.equal(buffer.getTimer('session-a'), 11);
  assert.equal(buffer.read('session-b'), '');
  assert.equal(buffer.getTimer('session-b'), null);
});

test('leaving one session via clearSession keeps a background stream buffer', () => {
  const buffer = createSessionStreamBuffer();
  buffer.append('session-a', 'viewed');
  buffer.setTimer('session-a', 11);
  buffer.append('session-b', 'background');
  buffer.setTimer('session-b', 22);

  buffer.clearSession('session-a');

  assert.equal(buffer.read('session-b'), 'background');
  assert.equal(buffer.getTimer('session-b'), 22);
});
