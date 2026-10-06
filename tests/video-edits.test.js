const test = require('node:test');
const assert = require('node:assert/strict');

const {
  segmentAt,
  nextSegment,
  playbackDecision,
} = require('../admin/video-redaction/video-edits.js');

test('deleted gap jumps to next kept segment and does not stop on stale callbacks', () => {
  const segments = [
    { id: 'a', start: 0, end: 10 },
    { id: 'b', start: 12, end: 20 },
  ];

  assert.equal(segmentAt(segments, 9.5, 0.01).id, 'a');
  assert.equal(nextSegment(segments, 10.5, 0.01).id, 'b');

  const jump = playbackDecision({
    segments,
    time: 10.5,
    epsilon: 0.01,
  });
  assert.equal(jump.type, 'jump');
  assert.equal(jump.target, 12);

  const staleCallback = playbackDecision({
    segments,
    time: 10.6,
    epsilon: 0.01,
    pendingSeek: true,
  });
  assert.equal(staleCallback.type, 'hold');

  const landed = playbackDecision({
    segments,
    time: 12.02,
    epsilon: 0.01,
  });
  assert.equal(landed.type, 'keep');
  assert.equal(landed.segment.id, 'b');
});

test('playback stops only after the final kept segment', () => {
  const segments = [
    { id: 'a', start: 0, end: 4 },
    { id: 'b', start: 6, end: 8 },
  ];

  assert.equal(
    playbackDecision({ segments, time: 8.2, epsilon: 0.01 }).type,
    'stop',
  );
});
