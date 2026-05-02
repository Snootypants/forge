import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, handleMemoryCommand } from './context.ts';
import type { MemoryService } from '../services/memory.ts';

function fakeMemory(): MemoryService {
  const state = {
    saved: [] as unknown[],
    removed: new Set<string>(['mem-1']),
  };

  return {
    _state: state,
    async save(input: unknown) {
      state.saved.push(input);
      return 'mem-1';
    },
    remove(id: string) {
      return state.removed.delete(id);
    },
    search() {
      return [];
    },
  } as unknown as MemoryService;
}

test('handleMemoryCommand saves only explicit /remember content', async () => {
  const memory = fakeMemory();
  const result = await handleMemoryCommand(memory, '/remember Caleb prefers terse status updates');

  assert.equal(result?.reply, 'Remembered. Memory ID: mem-1');
  assert.equal(result?.memoryId, 'mem-1');
  assert.deepEqual((memory as unknown as { _state: { saved: unknown[] } })._state.saved, [{
    type: 'chat',
    content: 'Caleb prefers terse status updates',
    tags: ['chat', 'explicit'],
    confidence: 1.0,
    importance: 0.7,
  }]);
});

test('handleMemoryCommand forgets only by exact memory id', async () => {
  const memory = fakeMemory();

  assert.equal((await handleMemoryCommand(memory, '/forget mem-1'))?.reply, 'Forgot memory mem-1.');
  assert.equal((await handleMemoryCommand(memory, '/forget mem-1'))?.reply, 'No memory found for ID: mem-1');
  assert.equal(await handleMemoryCommand(memory, 'please remember this generally'), null);
});

test('buildContext treats configured assistant name as assistant role', () => {
  let call = 0;
  const messagesDb = {
    prepare() {
      return {
        all() {
          call += 1;
          if (call === 1) {
            return [
              { userName: 'forge', text: 'Earlier assistant reply', ts: '1' },
              { userName: 'Caleb', text: 'Current message', ts: '2' },
            ];
          }
          return [];
        },
      };
    },
  };

  const context = buildContext({
    messagesDb: messagesDb as never,
    memory: fakeMemory(),
    identity: 'You are forge.',
    assistantName: 'forge',
    channel: 'C123',
    threadTs: '1',
    currentMessage: 'Current message',
    userName: 'Caleb',
  });

  assert.equal(context.messages[0].role, 'assistant');
  assert.equal(context.messages[0].name, 'forge');
});
