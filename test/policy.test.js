import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WINDOW_ID_NONE,
  createFocusScheduler,
  mayPlay,
} from '../src/policy.js';

const FOCUSED = 1;
const OTHER = 2;

test('only the active tab of the focused window may play', () => {
  const cases = [
    {
      name: 'focused window, active tab',
      tab: { id: 10, windowId: FOCUSED },
      focus: FOCUSED,
      active: 10,
      play: true,
    },
    {
      name: 'focused window, other tab',
      tab: { id: 11, windowId: FOCUSED },
      focus: FOCUSED,
      active: 10,
      play: false,
    },
    {
      name: 'unfocused window, its active tab',
      tab: { id: 20, windowId: OTHER },
      focus: FOCUSED,
      active: 10,
      play: false,
    },
    {
      name: 'unfocused window, background tab',
      tab: { id: 21, windowId: OTHER },
      focus: FOCUSED,
      active: 10,
      play: false,
    },
    {
      name: 'no Chrome window focused',
      tab: { id: 10, windowId: FOCUSED },
      focus: WINDOW_ID_NONE,
      active: 10,
      play: false,
    },
  ];

  for (const item of cases) {
    assert.equal(
      mayPlay(item.tab, item.focus, item.active),
      item.play,
      item.name,
    );
  }
});

test('missing focus or active tab pauses everything', () => {
  const tab = { id: 10, windowId: FOCUSED };
  assert.equal(mayPlay(tab, null, 10), false);
  assert.equal(mayPlay(tab, FOCUSED, null), false);
  assert.equal(mayPlay(null, FOCUSED, 10), false);
});

test('unfocused signal waits, and a real window id cancels it', () => {
  const applied = [];
  const pending = [];
  const timers = {
    setTimeout(fn) {
      const id = pending.length + 1;
      pending.push({ id, fn });
      return id;
    },
    clearTimeout(id) {
      const index = pending.findIndex((item) => item.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
  };
  const scheduler = createFocusScheduler((id) => applied.push(id), 150, timers);

  scheduler.push(WINDOW_ID_NONE);
  assert.deepEqual(applied, []);
  assert.equal(pending.length, 1);

  scheduler.push(7);
  assert.deepEqual(applied, [7]);
  assert.equal(pending.length, 0);
});

test('unfocused signal applies only after the debounce fires', () => {
  const applied = [];
  let stored = null;
  const timers = {
    setTimeout(fn) {
      stored = fn;
      return 1;
    },
    clearTimeout() {
      stored = null;
    },
  };
  const scheduler = createFocusScheduler((id) => applied.push(id), 150, timers);

  scheduler.push(WINDOW_ID_NONE);
  scheduler.push(WINDOW_ID_NONE);
  assert.deepEqual(applied, []);
  stored();
  assert.deepEqual(applied, [WINDOW_ID_NONE]);
});
