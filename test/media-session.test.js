import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

function loadMediaSession() {
  const code = readFileSync(new URL('../src/media-session.js', import.meta.url), 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  runInContext(code, createContext(sandbox), { filename: 'media-session.js' });
  return sandbox.FocusPauseMedia;
}

function fakeMedia({ paused = false, ended = false } = {}) {
  const el = {
    paused,
    ended,
    playCalls: 0,
    pauseCalls: 0,
    pause() {
      el.pauseCalls += 1;
      el.paused = true;
    },
    play() {
      el.playCalls += 1;
      el.paused = false;
      return Promise.resolve();
    },
  };
  return el;
}

const { createMediaSession } = loadMediaSession();

test('deny pauses playing media and does not mark media already paused', async () => {
  const playing = fakeMedia();
  const userPaused = fakeMedia({ paused: true });
  const session = createMediaSession(() => [playing, userPaused]);

  await session.setAllowed(false);

  assert.equal(playing.paused, true);
  assert.equal(playing.pauseCalls, 1);
  assert.equal(session.wasPausedByUs(playing), true);
  assert.equal(userPaused.pauseCalls, 0);
  assert.equal(session.wasPausedByUs(userPaused), false);
});

test('allow resumes only media this session paused', async () => {
  const ours = fakeMedia();
  const userPaused = fakeMedia({ paused: true });
  const session = createMediaSession(() => [ours, userPaused]);

  await session.setAllowed(false);
  await session.setAllowed(true);

  assert.equal(ours.playCalls, 1);
  assert.equal(ours.paused, false);
  assert.equal(session.wasPausedByUs(ours), false);
  assert.equal(userPaused.playCalls, 0);
  assert.equal(userPaused.paused, true);
});

test('a pause while allowed is not resumed later', async () => {
  const el = fakeMedia();
  const session = createMediaSession(() => [el]);

  await session.setAllowed(false);
  await session.setAllowed(true);
  el.pause();
  session.onPause({ target: el });
  await session.setAllowed(false);
  await session.setAllowed(true);

  assert.equal(el.playCalls, 1);
  assert.equal(el.paused, true);
});

test('play while denied is paused and resumed on the next allow', async () => {
  const el = fakeMedia({ paused: true });
  const session = createMediaSession(() => [el]);
  await session.setAllowed(false);

  el.paused = false;
  session.onPlay({ target: el });
  assert.equal(el.paused, true);
  assert.equal(session.wasPausedByUs(el), true);

  await session.setAllowed(true);
  assert.equal(el.playCalls, 1);
  assert.equal(el.paused, false);
});

test('page pause echo while denied does not forget the resume mark', async () => {
  const el = fakeMedia();
  el.pause = () => {
    el.pauseCalls += 1;
    el.paused = true;
    session.onPause({ target: el });
  };
  const session = createMediaSession(() => [el]);

  await session.setAllowed(false);
  session.onPause({ target: el });

  assert.equal(session.wasPausedByUs(el), true);
  await session.setAllowed(true);
  assert.equal(el.playCalls, 1);
});

test('rejected play() keeps the resume mark', async () => {
  const el = fakeMedia();
  el.play = () => {
    el.playCalls += 1;
    return Promise.reject(new Error('NotAllowedError'));
  };
  const session = createMediaSession(() => [el]);

  await session.setAllowed(false);
  await session.setAllowed(true);

  assert.equal(el.playCalls, 1);
  assert.equal(el.paused, true);
  assert.equal(session.wasPausedByUs(el), true);
});

test('markForResume remembers a blocked play without a play event', async () => {
  const el = fakeMedia({ paused: true });
  const session = createMediaSession(() => []);
  await session.setAllowed(false);

  session.markForResume(el);
  assert.equal(session.wasPausedByUs(el), true);

  await session.setAllowed(true);
  assert.equal(el.playCalls, 1);
  assert.equal(session.wasPausedByUs(el), false);
});

test('ended media is dropped instead of resumed', async () => {
  const el = fakeMedia();
  const session = createMediaSession(() => [el]);

  await session.setAllowed(false);
  el.ended = true;
  await session.setAllowed(true);

  assert.equal(el.playCalls, 0);
  assert.equal(session.wasPausedByUs(el), false);
});

test('disconnected DOM media that was paused is dropped, not resumed', async () => {
  const el = fakeMedia();
  el.isConnected = true;
  const session = createMediaSession(() => [el]);

  await session.setAllowed(false);
  el.isConnected = false;
  el.parentNode = null;
  await session.setAllowed(true);

  assert.equal(el.playCalls, 0);
  assert.equal(session.wasPausedByUs(el), false);
});

test('non-NotAllowedError rejection drops the resume mark', async () => {
  for (const name of ['AbortError', 'NotSupportedError']) {
    const el = fakeMedia();
    el.play = () => {
      el.playCalls += 1;
      const err = new Error(name);
      err.name = name;
      return Promise.reject(err);
    };
    const session = createMediaSession(() => [el]);

    await session.setAllowed(false);
    await session.setAllowed(true);
    assert.equal(session.wasPausedByUs(el), false, name);

    // A later retry (click/key) must not call play() again.
    await session.setAllowed(true);
    assert.equal(el.playCalls, 1, name);
  }
});

test('synchronous non-NotAllowedError throw drops the resume mark', async () => {
  const el = fakeMedia();
  el.play = () => {
    el.playCalls += 1;
    const err = new Error('AbortError');
    err.name = 'AbortError';
    throw err;
  };
  const session = createMediaSession(() => [el]);

  await session.setAllowed(false);
  await session.setAllowed(true);

  assert.equal(session.wasPausedByUs(el), false);
});

test('detached media is re-attached before resume', async () => {
  const el = fakeMedia({ paused: true });
  el.isConnected = false;
  el.parentNode = null;
  const holder = {
    children: [],
    attrs: {},
    setAttribute(k, v) {
      holder.attrs[k] = v;
    },
    addEventListener() {},
    appendChild(child) {
      child.parentNode = holder;
      child.isConnected = true;
      holder.children.push(child);
      return child;
    },
  };
  const head = {
    appendChild(child) {
      child.parentNode = head;
      child.isConnected = true;
      return child;
    },
  };
  const doc = {
    head,
    documentElement: head,
    querySelector() {
      return null;
    },
    createElement() {
      return holder;
    },
  };
  el.ownerDocument = doc;
  const session = createMediaSession(() => []);
  await session.setAllowed(false);

  // First seen disconnected (new Audio()): mark then resume.
  session.markForResume(el);
  await session.setAllowed(true);

  assert.equal(el.playCalls, 1);
  assert.equal(el.isConnected, true);
  assert.equal(el.parentNode, holder);
  assert.equal(holder.attrs['data-focuspause-holder'], '');
});

test('media seen only via play is resumed even if later collection misses it', async () => {
  const el = fakeMedia({ paused: true });
  let visible = [];
  const session = createMediaSession(() => visible);
  await session.setAllowed(false);

  el.paused = false;
  session.onPlay({ target: el });
  visible = [];
  await session.setAllowed(true);

  assert.equal(el.playCalls, 1);
});
