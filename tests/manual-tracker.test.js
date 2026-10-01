'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const tracker = require('../admin/video-redaction/manual-tracker');

function makeFrame(width = 240, height = 220, background = 20) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    data[offset] = background;
    data[offset + 1] = background;
    data[offset + 2] = background;
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

function fillRect(frame, x, y, width, height, value) {
  const x1 = Math.max(0, Math.floor(x));
  const y1 = Math.max(0, Math.floor(y));
  const x2 = Math.min(frame.width, Math.ceil(x + width));
  const y2 = Math.min(frame.height, Math.ceil(y + height));
  for (let py = y1; py < y2; py += 1) {
    for (let px = x1; px < x2; px += 1) {
      const offset = (py * frame.width + px) * 4;
      frame.data[offset] = value;
      frame.data[offset + 1] = value;
      frame.data[offset + 2] = value;
      frame.data[offset + 3] = 255;
    }
  }
}

function drawTextLikeRow(frame, x, y, variant = 0) {
  // Card background.
  fillRect(frame, x - 8, y - 8, 126, 38, 68);

  // Text-like high-frequency strokes. Different variants share enough visual
  // structure to be plausible distractors without being identical.
  const widths = variant === 0
    ? [9, 5, 12, 7, 10, 6, 13, 8]
    : [7, 11, 6, 12, 5, 10, 8, 13];
  let cursor = x;
  for (let i = 0; i < widths.length; i += 1) {
    const width = widths[i];
    fillRect(frame, cursor, y, width, 3, 225);
    fillRect(frame, cursor + (i % 2), y + 7, Math.max(3, width - 2), 3, 205);
    if (i % 3 === 0) fillRect(frame, cursor + 2, y + 2, 2, 8, 235);
    cursor += width + 4;
  }
}

function drawPhoneSheet(frame, offsetY) {
  fillRect(frame, 38, 38 + offsetY, 164, 158, 42);
  drawTextLikeRow(frame, 58, 88 + offsetY, 0);

  // A button below the selected address: strong edges, similar horizontal
  // rhythm, and moving with exactly the same scroll. This models the failure
  // where the address mask jumped down onto "Analyze Property."
  fillRect(frame, 50, 142 + offsetY, 140, 28, 92);
  for (let x = 72; x < 168; x += 12) {
    fillRect(frame, x, 151 + offsetY, 7, 3, 220);
  }
}

test('frame-to-frame tracking follows a scrolling address instead of the button below', () => {
  const startBox = { x1: 52, y1: 78, x2: 184, y2: 112 };
  let frame = makeFrame();
  drawPhoneSheet(frame, 0);

  const anchorTemplate = tracker.makeTemplate(frame, startBox, {
    paddingRatio: 0.08,
    cols: 19,
    rows: 11,
  });
  let recentTemplate = tracker.makeTemplate(frame, startBox, {
    paddingRatio: 0.20,
    cols: 17,
    rows: 11,
  });
  assert.ok(anchorTemplate);
  assert.ok(recentTemplate);

  let box = { ...startBox };
  let motion = { dx: 0, dy: 0 };

  for (let index = 1; index <= 10; index += 1) {
    frame = makeFrame();
    const offsetY = -6 * index;
    drawPhoneSheet(frame, offsetY);

    const match = tracker.findBestMatch(
      frame,
      box,
      recentTemplate,
      anchorTemplate,
      {
        expectedMotion: motion,
        elapsedSeconds: 1 / 60,
        minimumAnchorCorrelation: 0.70,
        minimumCombinedScore: 0.60,
      },
    );

    assert.equal(
      match.strong,
      true,
      `frame ${index} should have a confident address match: ${JSON.stringify(match)}`,
    );

    motion = {
      dx: match.box.x1 - box.x1,
      dy: match.box.y1 - box.y1,
    };
    box = match.box;
    recentTemplate = tracker.makeTemplate(frame, box, {
      paddingRatio: 0.20,
      cols: 17,
      rows: 11,
    });
  }

  assert.ok(Math.abs(box.x1 - startBox.x1) <= 2);
  assert.ok(Math.abs(box.y1 - (startBox.y1 - 60)) <= 3);
  assert.ok(box.y1 < 60, 'mask should remain with the address, not the lower button');
});

test('tracking stays with one of two nearby moving text rows', () => {
  const first = makeFrame();
  drawTextLikeRow(first, 55, 88, 0);
  drawTextLikeRow(first, 55, 122, 1);

  const box = { x1: 49, y1: 78, x2: 180, y2: 111 };
  const anchor = tracker.makeTemplate(first, box, { paddingRatio: 0.08 });
  const recent = tracker.makeTemplate(first, box, { paddingRatio: 0.18 });

  const next = makeFrame();
  drawTextLikeRow(next, 57, 82, 0);
  drawTextLikeRow(next, 53, 128, 1);

  const match = tracker.findBestMatch(next, box, recent, anchor, {
    expectedMotion: { dx: 2, dy: -6 },
    occupied: [{ x1: 48, y1: 118, x2: 181, y2: 151 }],
    minimumAnchorCorrelation: 0.70,
    minimumCombinedScore: 0.60,
  });

  assert.equal(
    match.strong,
    true,
    `nearby-row target should stay locked: ${JSON.stringify(match)}`,
  );
  assert.ok(Math.abs(match.box.x1 - 51) <= 3);
  assert.ok(Math.abs(match.box.y1 - 72) <= 3);
});

test('a vanished target is not confidently reacquired from unrelated content', () => {
  const first = makeFrame();
  drawTextLikeRow(first, 60, 90, 0);
  const box = { x1: 54, y1: 80, x2: 188, y2: 113 };
  const anchor = tracker.makeTemplate(first, box, { paddingRatio: 0.08 });
  const recent = tracker.makeTemplate(first, box, { paddingRatio: 0.18 });

  const next = makeFrame();
  fillRect(next, 50, 135, 140, 28, 92);
  for (let x = 70; x < 170; x += 12) {
    fillRect(next, x, 144, 7, 3, 220);
  }

  const match = tracker.findBestMatch(next, box, recent, anchor, {
    expectedMotion: { dx: 0, dy: -6 },
  });

  assert.equal(match.strong, false);
});


test('a target crossing the frame edge is carried out without reacquiring', () => {
  const frame = makeFrame(240, 220);
  drawTextLikeRow(frame, 58, 182, 0);
  const box = { x1: 52, y1: 172, x2: 184, y2: 206 };
  const anchor = tracker.makeTemplate(frame, box, { paddingRatio: 0.08 });
  const recent = tracker.makeTemplate(frame, box, { paddingRatio: 0.18 });

  const next = makeFrame(240, 220);
  const partial = tracker.findBestMatch(next, box, recent, anchor, {
    expectedMotion: { dx: 0, dy: 20 },
  });

  assert.equal(partial.exitingFrame, true);
  assert.equal(partial.exitedFrame, false);
  assert.equal(partial.strong, true);
  assert.ok(partial.predicted.y2 > next.height);

  const gone = tracker.findBestMatch(next, box, recent, anchor, {
    expectedMotion: { dx: 0, dy: 55 },
  });

  assert.equal(gone.exitingFrame, false);
  assert.equal(gone.exitedFrame, true);
  assert.equal(gone.strong, false);
  assert.ok(gone.predicted.y1 > next.height);
});

test('different text appearing near the old location cannot inherit the mask', () => {
  const first = makeFrame();
  drawTextLikeRow(first, 58, 88, 0);
  const box = { x1: 52, y1: 78, x2: 184, y2: 112 };
  const anchor = tracker.makeTemplate(first, box, {
    paddingRatio: 0.08,
    cols: 19,
    rows: 11,
  });
  const recent = tracker.makeTemplate(first, box, {
    paddingRatio: 0.18,
    cols: 17,
    rows: 11,
  });

  const next = makeFrame();
  // Original target is gone. A different text-like row appears close enough
  // that a generic visual matcher could latch onto it.
  drawTextLikeRow(next, 60, 94, 1);

  const match = tracker.findBestMatch(next, box, recent, anchor, {
    expectedMotion: { dx: 0, dy: 6 },
  });

  assert.equal(
    match.strong,
    false,
    `replacement content must not inherit target: ${JSON.stringify(match)}`,
  );
  assert.ok(
    match.anchorCorrelation < 0.74,
    `replacement anchor correlation too high: ${JSON.stringify(match)}`,
  );
});


test('fast 60fps UI motion remains reachable even when a browser callback is skipped', () => {
  const first = makeFrame(320, 260);
  drawTextLikeRow(first, 72, 142, 0);
  const box = { x1: 66, y1: 132, x2: 198, y2: 166 };
  const anchor = tracker.makeTemplate(first, box, {
    paddingRatio: 0.08,
    cols: 19,
    rows: 11,
  });
  const recent = tracker.makeTemplate(first, box, {
    paddingRatio: 0.20,
    cols: 17,
    rows: 11,
  });

  const next = makeFrame(320, 260);
  // Models roughly two skipped 60fps source frames during the fast sheet
  // animation in the uploaded Labradoor recording.
  drawTextLikeRow(next, 72, 54, 0);

  const match = tracker.findBestMatch(next, box, recent, anchor, {
    expectedMotion: { dx: 0, dy: -44 },
    elapsedSeconds: 3 / 60,
    minimumAnchorCorrelation: 0.70,
    minimumCombinedScore: 0.60,
  });

  assert.equal(
    match.strong,
    true,
    `fast jump should remain trackable: ${JSON.stringify(match)}`,
  );
  assert.ok(match.searchRadiusY >= 120);
  assert.ok(Math.abs(match.box.y1 - 44) <= 4);
});
