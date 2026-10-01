(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LabradoorManualTracker = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clampBox(box, width, height) {
    const boxWidth = Math.max(4, box.x2 - box.x1);
    const boxHeight = Math.max(4, box.y2 - box.y1);
    const x1 = clamp(box.x1, 0, Math.max(0, width - boxWidth));
    const y1 = clamp(box.y1, 0, Math.max(0, height - boxHeight));
    return { x1, y1, x2: x1 + boxWidth, y2: y1 + boxHeight };
  }

  function grayAt(frame, x, y) {
    const px = clamp(Math.round(x), 0, frame.width - 1);
    const py = clamp(Math.round(y), 0, frame.height - 1);
    const index = (py * frame.width + px) * 4;
    return (
      frame.data[index] * 0.299 +
      frame.data[index + 1] * 0.587 +
      frame.data[index + 2] * 0.114
    );
  }

  function gradientAt(frame, x, y) {
    const gx = grayAt(frame, x + 1, y) - grayAt(frame, x - 1, y);
    const gy = grayAt(frame, x, y + 1) - grayAt(frame, x, y - 1);
    return { gx, gy, magnitude: Math.hypot(gx, gy) };
  }

  function makeTemplate(frame, box, options = {}) {
    if (!frame || !frame.data || !frame.width || !frame.height) return null;
    const width = Math.max(4, box.x2 - box.x1);
    const height = Math.max(4, box.y2 - box.y1);

    // Use the exact selected region. The previous tracker mixed surrounding UI
    // into the identity signature, which let cards/buttons inherit the mask.
    const cols = Math.max(
      20,
      Math.min(48, Number(options.cols) || Math.round(width / 4)),
    );
    const rows = Math.max(
      8,
      Math.min(24, Number(options.rows) || Math.round(height / 3)),
    );

    const samples = [];
    let sum = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const fx = (col + 0.5) / cols;
        const fy = (row + 0.5) / rows;
        const x = box.x1 + fx * Math.max(1, width - 1);
        const y = box.y1 + fy * Math.max(1, height - 1);
        const value = grayAt(frame, x, y);
        samples.push({ fx, fy, value });
        sum += value;
      }
    }

    const mean = sum / Math.max(1, samples.length);
    let variance = 0;
    for (const sample of samples) {
      variance += (sample.value - mean) ** 2;
    }

    return {
      samples,
      mean,
      deviation: Math.sqrt(
        Math.max(1, variance / Math.max(1, samples.length)),
      ),
      width,
      height,
    };
  }

  function scoreCorrelation(frame, box, template) {
    const samples = template?.samples || [];
    if (!samples.length) return -1;

    const values = [];
    let sum = 0;
    for (const sample of samples) {
      const x = box.x1 + sample.fx * (box.x2 - box.x1);
      const y = box.y1 + sample.fy * (box.y2 - box.y1);
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
        return -1;
      }
      const value = grayAt(frame, x, y);
      values.push(value);
      sum += value;
    }

    const mean = sum / values.length;
    let covariance = 0;
    let candidateVariance = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const a = samples[index].value - template.mean;
      const b = values[index] - mean;
      covariance += a * b;
      candidateVariance += b * b;
    }

    return covariance /
      Math.max(
        1,
        samples.length *
          template.deviation *
          Math.sqrt(
            Math.max(1, candidateVariance / Math.max(1, samples.length)),
          ),
      );
  }

  function scoreTemplate(frame, box, template) {
    return clamp((scoreCorrelation(frame, box, template) + 1) / 2, 0, 1);
  }

  function scoreIdentityEdges(frame, box, template) {
    return scoreTemplate(frame, box, template);
  }

  function scoreFingerprint(frame, box, template) {
    return scoreTemplate(frame, box, template);
  }

  function visibleFraction(box, width, height) {
    const x1 = Math.max(0, box.x1);
    const y1 = Math.max(0, box.y1);
    const x2 = Math.min(width, box.x2);
    const y2 = Math.min(height, box.y2);
    const visibleArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area = Math.max(1, (box.x2 - box.x1) * (box.y2 - box.y1));
    return visibleArea / area;
  }

  function boxIoU(a, b) {
    const x1 = Math.max(a.x1, b.x1);
    const y1 = Math.max(a.y1, b.y1);
    const x2 = Math.min(a.x2, b.x2);
    const y2 = Math.min(a.y2, b.y2);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (!intersection) return 0;
    const areaA = Math.max(1, (a.x2 - a.x1) * (a.y2 - a.y1));
    const areaB = Math.max(1, (b.x2 - b.x1) * (b.y2 - b.y1));
    return intersection / Math.max(1, areaA + areaB - intersection);
  }

  function translate(box, dx, dy) {
    return {
      x1: box.x1 + dx,
      y1: box.y1 + dy,
      x2: box.x2 + dx,
      y2: box.y2 + dy,
    };
  }

  function findBestMatch(
    frame,
    currentBox,
    _recentTemplate,
    anchorTemplate,
    options = {},
  ) {
    const occupied = Array.isArray(options.occupied) ? options.occupied : [];
    const expectedMotion = options.expectedMotion || { dx: 0, dy: 0 };
    const dx = Number(expectedMotion.dx) || 0;
    const dy = Number(expectedMotion.dy) || 0;
    const width = currentBox.x2 - currentBox.x1;
    const height = currentBox.y2 - currentBox.y1;
    const predicted = translate(currentBox, dx, dy);
    const predictedVisibleFraction = visibleFraction(
      predicted,
      frame.width,
      frame.height,
    );
    const currentVisibleFraction = visibleFraction(
      currentBox,
      frame.width,
      frame.height,
    );
    const motionMagnitude = Math.hypot(dx, dy);
    const movingOutward =
      motionMagnitude >= 0.8 &&
      predictedVisibleFraction + 0.03 < currentVisibleFraction;

    // If a confirmed target is crossing an edge, do not search the remaining
    // image for a replacement. Carry the established motion until fully gone.
    if (movingOutward && predictedVisibleFraction < 0.98) {
      const exitedFrame = predictedVisibleFraction <= 0.01;
      return {
        box: predicted,
        score: exitedFrame ? -1 : 1,
        correlation: exitedFrame ? -1 : 1,
        anchorCorrelation: exitedFrame ? -1 : 1,
        recentScore: exitedFrame ? 0 : 1,
        anchorScore: exitedFrame ? 0 : 1,
        identityScore: exitedFrame ? 0 : 1,
        fingerprintScore: exitedFrame ? 0 : 1,
        strong: !exitedFrame,
        exitingFrame: !exitedFrame,
        exitedFrame,
        predicted,
        predictedVisibleFraction,
        movement: motionMagnitude,
      };
    }

    const xRadius = Math.max(
      18,
      Math.min(50, width * 0.16 + Math.abs(dx) * 1.2),
    );
    const yRadius = Math.max(
      30,
      Math.min(120, height * 2.5 + Math.abs(dy) * 1.2),
    );

    const minX = Math.max(0, Math.floor(predicted.x1 - xRadius));
    const maxX = Math.min(
      frame.width - width,
      Math.ceil(predicted.x1 + xRadius),
    );
    const minY = Math.max(0, Math.floor(predicted.y1 - yRadius));
    const maxY = Math.min(
      frame.height - height,
      Math.ceil(predicted.y1 + yRadius),
    );

    function evaluate(x, y) {
      const candidate = { x1: x, y1: y, x2: x + width, y2: y + height };
      const correlation = scoreCorrelation(frame, candidate, anchorTemplate);
      const predictionDistance = Math.hypot(
        candidate.x1 - predicted.x1,
        candidate.y1 - predicted.y1,
      );
      const scale = Math.max(24, height * 2.2, width * 0.25);
      const continuityPenalty = Math.min(
        0.12,
        (predictionDistance / scale) * 0.10,
      );
      const overlap = occupied.reduce(
        (maximum, box) => Math.max(maximum, boxIoU(candidate, box)),
        0,
      );
      const collisionPenalty =
        overlap >= 0.55 ? 0.55 : overlap >= 0.2 ? 0.24 : 0;
      const score = correlation - continuityPenalty - collisionPenalty;
      return {
        box: candidate,
        score,
        correlation,
        anchorCorrelation: correlation,
        recentScore: clamp((correlation + 1) / 2, 0, 1),
        anchorScore: clamp((correlation + 1) / 2, 0, 1),
        identityScore: clamp((correlation + 1) / 2, 0, 1),
        fingerprintScore: clamp((correlation + 1) / 2, 0, 1),
      };
    }

    let best = evaluate(predicted.x1, predicted.y1);
    const coarseStep = Math.max(3, Number(options.coarseStep) || 5);
    for (let y = minY; y <= maxY; y += coarseStep) {
      for (let x = minX; x <= maxX; x += coarseStep) {
        const candidate = evaluate(x, y);
        if (candidate.score > best.score) best = candidate;
      }
    }

    const refine = 5;
    const refineMinX = Math.max(minX, Math.floor(best.box.x1 - refine));
    const refineMaxX = Math.min(maxX, Math.ceil(best.box.x1 + refine));
    const refineMinY = Math.max(minY, Math.floor(best.box.y1 - refine));
    const refineMaxY = Math.min(maxY, Math.ceil(best.box.y1 + refine));
    for (let y = refineMinY; y <= refineMaxY; y += 1) {
      for (let x = refineMinX; x <= refineMaxX; x += 1) {
        const candidate = evaluate(x, y);
        if (candidate.score > best.score) best = candidate;
      }
    }

    const minimumCorrelation = Number.isFinite(options.minimumCorrelation)
      ? options.minimumCorrelation
      : 0.72;
    const strong =
      best.correlation >= minimumCorrelation &&
      best.score >= minimumCorrelation - 0.08;

    return {
      ...best,
      strong,
      exitingFrame: false,
      exitedFrame: false,
      predicted,
      predictedVisibleFraction,
      movement: Math.hypot(
        best.box.x1 - currentBox.x1,
        best.box.y1 - currentBox.y1,
      ),
    };
  }

  return {
    clampBox,
    grayAt,
    gradientAt,
    makeTemplate,
    scoreTemplate,
    scoreCorrelation,
    scoreIdentityEdges,
    scoreFingerprint,
    visibleFraction,
    boxIoU,
    findBestMatch,
  };
});
