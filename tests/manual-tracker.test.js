'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const tracker = require('../admin/video-redaction/manual-tracker');

test('an established selection follows its original exposed characters behind an overlay', () => {
  const first = makeFrame(320, 260);
  drawTextLikeRow(first, 55, 150);
  const box = { x1: 52, y1: 145, x2: 181, y2: 164 };
  const anchor = tracker.makeTemplate(first, box);
  const next = makeFrame(320, 260);
  drawTextLikeRow(next, 55, 90);
  fillRect(next, 100, 70, 90, 50, 0);
  const match = tracker.findBestMatch(next, box, anchor, anchor, {
    allowPartialIdentity: true,
    elapsedSeconds: 0.1,
    expectedMotion: { dx: 0, dy: -60 },
  });
  assert.equal(match.strong, true);
  assert.equal(match.partialIdentity, true);
  assert.ok(Math.abs(match.box.y1 - 85) <= 1);

  const replaced = makeFrame(320, 260);
  drawTextLikeRow(replaced, 55, 90, 1);
  fillRect(replaced, 100, 70, 90, 50, 0);
  const wrong = tracker.findBestMatch(replaced, match.box, anchor, anchor, {
    allowPartialIdentity: true,
    elapsedSeconds: 1 / 30,
  });
  assert.equal(wrong.strong, false);
});

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

test('a fast dismissing sheet stays reachable across a skipped presented frame', () => {
  const first = makeFrame(320, 640);
  drawTextLikeRow(first, 55, 200);
  const box = { x1: 52, y1: 195, x2: 181, y2: 214 };
  const anchor = tracker.makeTemplate(first, box);
  const next = makeFrame(320, 640);
  drawTextLikeRow(next, 55, 460);
  const options = { elapsedSeconds: 0.1, allowPartialIdentity: true };
  const match = tracker.findBestMatch(next, box, anchor, anchor, options);
  assert.equal(match.strong, true);
  assert.ok(Math.abs(match.box.y1 - 455) <= 1);

  const different = makeFrame(320, 640);
  drawTextLikeRow(different, 55, 460, 1);
  assert.equal(tracker.findBestMatch(different, box, anchor, anchor, options).strong, false);
  assert.equal(tracker.findBestMatch(makeFrame(320, 640), box, anchor, anchor, options).strong, false);
});

test('a skipped callback can reconnect to original characters partly above the frame', () => {
  const first = makeFrame(320, 260);
  drawTextLikeRow(first, 55, 150);
  const box = { x1: 52, y1: 145, x2: 181, y2: 164 };
  const anchor = tracker.makeTemplate(first, box);
  const next = makeFrame(320, 260);
  drawTextLikeRow(next, 55, -2);
  const options = { allowPartialIdentity: true, elapsedSeconds: 1.1 };
  const match = tracker.findBestMatch(next, box, anchor, anchor, options);
  assert.equal(match.strong, true);
  assert.equal(match.partialIdentity, true);
  assert.equal(match.exitingFrame, true);
  assert.ok(Math.abs(match.box.y1 + 7) <= 1);

  const replacement = makeFrame(320, 260);
  drawTextLikeRow(replacement, 55, -2, 1);
  assert.equal(tracker.findBestMatch(replacement, box, anchor, anchor, options).strong, false);
  assert.equal(tracker.findBestMatch(makeFrame(320, 260), box, anchor, anchor, options).strong, false);
});

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
        minimumRecentCorrelation: 0.54,
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
    minimumRecentCorrelation: 0.54,
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
    match.denseAnchorCorrelation < 0.82,
    `replacement dense identity too high: ${JSON.stringify(match)}`,
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
    minimumRecentCorrelation: 0.54,
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


test('dense selected-pixel correlation remains high on the exact target', () => {
  const first = makeFrame(280, 220);
  drawTextLikeRow(first, 64, 92, 0);
  const box = { x1: 58, y1: 82, x2: 190, y2: 116 };
  const anchor = tracker.makeTemplate(first, box, { paddingRatio: 0.08 });

  const next = makeFrame(280, 220);
  drawTextLikeRow(next, 64, 86, 0);
  const moved = { x1: 58, y1: 76, x2: 190, y2: 110 };

  assert.ok(tracker.scoreDenseCorrelation(next, moved, anchor) > 0.90);
});

test('fractional hand-drawn boxes compare the exact pixels captured by the template', () => {
  const frame = makeFrame();
  drawTextLikeRow(frame, 55, 88);
  const box = { x1: 49.333, y1: 78.667, x2: 180.667, y2: 111.333 };
  const anchor = tracker.makeTemplate(frame, box);
  assert.ok(tracker.scoreDenseCorrelation(frame, box, anchor) > 0.9999,
    'sampling must not stretch the fingerprint by one pixel during matching');
  const match = tracker.findBestMatch(frame, box, anchor, anchor);
  assert.equal(match.strong, true);
  assert.deepEqual(match.box, box, 'a stationary fractional mask must not snap to another position');
});

test('fast search retains fractional glyph sampling after a skipped scrolling frame', () => {
  const first = makeFrame();
  drawTextLikeRow(first, 55, 88);
  const box = { x1: 49.333, y1: 78.667, x2: 180.667, y2: 111.333 };
  const anchor = tracker.makeTemplate(first, box);
  const next = makeFrame();
  drawTextLikeRow(next, 79, 18);
  drawTextLikeRow(next, 57, 123, 1);
  const match = tracker.findBestMatch(next, box, anchor, anchor, {elapsedSeconds: 0.08});
  assert.equal(match.strong, true);
  assert.ok(Math.abs(match.box.x1 - (box.x1 + 24)) < 0.01);
  assert.ok(Math.abs(match.box.y1 - (box.y1 - 70)) < 0.01);
});

test('cached dense search preserves RGB sampling across translations and phases', () => {
  const first = makeFrame(120, 100);
  const next = makeFrame(120, 100);
  for (let i = 0; i < first.data.length; i += 4) {
    first.data[i] = (i * 13) % 251;
    first.data[i + 1] = (i * 7) % 241;
    first.data[i + 2] = (i * 17) % 239;
    next.data[i] = (i * 19) % 251;
    next.data[i + 1] = (i * 11) % 241;
    next.data[i + 2] = (i * 3) % 239;
  }
  const anchorBox = {x1: 20.333, y1: 25.667, x2: 80.333, y2: 55.667};
  const template = tracker.makeTemplate(first, anchorBox);
  for (const [dx, dy] of [[0, 0], [5, -7], [0.25, 0.125], [11, 13]]) {
    const box = {x1: anchorBox.x1 + dx, y1: anchorBox.y1 + dy, x2: anchorBox.x2 + dx, y2: anchorBox.y2 + dy};
    const values = template.fingerprint.map(sample => tracker.grayAt(next,
      box.x1 + sample.fx * (box.x2 - box.x1 - 1),
      box.y1 + sample.fy * (box.y2 - box.y1 - 1)));
    const sum = values.reduce((total, value) => total + value, 0);
    const variance = values.reduce((total, value) => total + value * value, 0) - sum * sum / values.length;
    const covariance = values.reduce((total, value, i) => total + (template.fingerprint[i].value - template.fingerprintMean) * value, 0);
    const templateVariance = template.fingerprint.reduce((total, sample) => total + (sample.value - template.fingerprintMean) ** 2, 0);
    const expected = covariance / Math.max(1, Math.sqrt(variance * templateVariance));
    assert.ok(Math.abs(tracker.scoreDenseCorrelation(next, box, template) - expected) < 1e-6);
  }
});


test('established tracking tolerates rasterization drift without accepting a new target', () => {
  function drawRasterizedTarget(frame, x, y, edgeShift) {
    fillRect(frame, x - 8, y - 8, 126, 38, 68);
    const widths = [9, 5, 12, 7, 10, 6, 13, 8];
    let cursor = x;
    for (let i = 0; i < widths.length; i += 1) {
      const width = widths[i];
      const shift = i % 2 ? edgeShift : 0;
      fillRect(frame, cursor + shift, y, width, 3, 225);
      fillRect(frame, cursor + (i % 2) + shift, y + 7, Math.max(3, width - 2), 3, 205);
      if (i % 3 === 0) fillRect(frame, cursor + 2 + shift, y + 2, 2, 8, 235);
      cursor += width + 4;
    }
  }

  const original = makeFrame(300, 220);
  drawRasterizedTarget(original, 64, 92, 0);
  const box = { x1: 58, y1: 82, x2: 190, y2: 116 };
  const anchor = tracker.makeTemplate(original, box, { paddingRatio: 0.08 });

  // Same text after a different rasterization/compression phase. The exact
  // original pixels are no longer a perfect match, but a confirmed recent
  // frame remains an excellent predictor of the same target.
  const previous = makeFrame(300, 220);
  drawRasterizedTarget(previous, 64, 88, 4);
  const previousBox = { x1: 58, y1: 78, x2: 190, y2: 112 };
  const recent = tracker.makeTemplate(previous, previousBox, { paddingRatio: 0.20 });

  const current = makeFrame(300, 220);
  drawRasterizedTarget(current, 64, 83, 4);
  const strict = tracker.findBestMatch(current, previousBox, recent, anchor, {
    expectedMotion: { dx: 0, dy: -5 },
    minimumRecentCorrelation: 0.70,
    minimumAnchorCorrelation: 0.82,
    minimumCombinedScore: 0.60,
  });
  const adaptive = tracker.findBestMatch(current, previousBox, recent, anchor, {
    expectedMotion: { dx: 0, dy: -5 },
    minimumRecentCorrelation: 0.82,
    minimumAnchorCorrelation: 0.50,
    minimumCombinedScore: 0.70,
  });

  assert.ok(
    strict.anchorCorrelation < 0.82,
    `test must exercise original-template drift: ${JSON.stringify(strict)}`,
  );
  assert.equal(strict.strong, false);
  assert.equal(
    adaptive.strong,
    true,
    `established recent identity should carry the same text: ${JSON.stringify(adaptive)}`,
  );
  assert.ok(Math.abs(adaptive.box.y1 - 73) <= 2);
});
