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
    const paddingRatio = Number.isFinite(options.paddingRatio)
      ? Math.max(0, options.paddingRatio)
      : 0.18;
    const padding = Math.max(2, Math.min(12, Math.round(height * paddingRatio)));
    const x1 = Math.max(0, box.x1 - padding);
    const y1 = Math.max(0, box.y1 - padding);
    const x2 = Math.min(frame.width, box.x2 + padding);
    const y2 = Math.min(frame.height, box.y2 + padding);

    const cols = Math.max(
      11,
      Math.min(21, Number(options.cols) || Math.round((x2 - x1) / 6)),
    );
    const rows = Math.max(
      7,
      Math.min(15, Number(options.rows) || Math.round((y2 - y1) / 4)),
    );

    const samples = [];
    let weightedSum = 0;
    let totalWeight = 0;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const canvasX = x1 + ((col + 0.5) / cols) * Math.max(1, x2 - x1 - 1);
        const canvasY = y1 + ((row + 0.5) / rows) * Math.max(1, y2 - y1 - 1);
        const value = grayAt(frame, canvasX, canvasY);
        const gradient = gradientAt(frame, canvasX, canvasY);
        const weight = 1 + Math.min(2.5, gradient.magnitude / 38);
        const sample = {
          fx: (canvasX - box.x1) / width,
          fy: (canvasY - box.y1) / height,
          value,
          gx: gradient.gx,
          gy: gradient.gy,
          magnitude: gradient.magnitude,
          weight,
        };
        samples.push(sample);
        weightedSum += value * weight;
        totalWeight += weight;
      }
    }

    const mean = weightedSum / Math.max(1, totalWeight);
    let variance = 0;
    for (const sample of samples) {
      variance += sample.weight * (sample.value - mean) ** 2;
    }

    const identitySamples = samples
      .slice()
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, Math.max(20, Math.round(samples.length * 0.38)));

    return {
      samples,
      identitySamples,
      mean,
      deviation: Math.sqrt(Math.max(1, variance / Math.max(1, totalWeight))),
      width,
      height,
      padding,
    };
  }

  function scoreTemplate(frame, box, template) {
    if (!template || !template.samples || !template.samples.length) return 0;

    let candidateWeightedSum = 0;
    let totalWeight = 0;
    const observed = [];

    for (const sample of template.samples) {
      const x = box.x1 + sample.fx * (box.x2 - box.x1);
      const y = box.y1 + sample.fy * (box.y2 - box.y1);
      const value = grayAt(frame, x, y);
      const gradient = gradientAt(frame, x, y);
      observed.push({ value, gradient });
      candidateWeightedSum += value * sample.weight;
      totalWeight += sample.weight;
    }

    const candidateMean = candidateWeightedSum / Math.max(1, totalWeight);
    let covariance = 0;
    let candidateVariance = 0;
    let appearance = 0;
    let edge = 0;

    for (let index = 0; index < template.samples.length; index += 1) {
      const sample = template.samples[index];
      const current = observed[index];
      const weight = sample.weight;
      const a = sample.value - template.mean;
      const b = current.value - candidateMean;
      covariance += weight * a * b;
      candidateVariance += weight * b * b;
      appearance +=
        weight * Math.max(0, 1 - Math.abs(sample.value - current.value) / 100);

      const denominator = Math.max(
        1,
        sample.magnitude * current.gradient.magnitude,
      );
      const orientation =
        (sample.gx * current.gradient.gx + sample.gy * current.gradient.gy) /
        denominator;
      const orientationScore = Math.max(0, (orientation + 1) / 2);
      const magnitudeScore = Math.max(
        0,
        1 -
          Math.abs(sample.magnitude - current.gradient.magnitude) /
            Math.max(24, sample.magnitude * 1.8),
      );
      edge += weight * (orientationScore * 0.65 + magnitudeScore * 0.35);
    }

    const correlation =
      covariance /
      Math.max(
        1,
        totalWeight * template.deviation *
          Math.sqrt(Math.max(1, candidateVariance / Math.max(1, totalWeight))),
      );
    const correlationScore = clamp((correlation + 1) / 2, 0, 1);
    const appearanceScore = appearance / Math.max(1, totalWeight);
    const edgeScore = edge / Math.max(1, totalWeight);

    return correlationScore * 0.62 + edgeScore * 0.23 + appearanceScore * 0.15;
  }

  function scoreIdentityEdges(frame, box, template) {
    const samples = template?.identitySamples || [];
    if (!samples.length) return 0;

    let matchedWeight = 0;
    let totalWeight = 0;

    for (const sample of samples) {
      const x = box.x1 + sample.fx * (box.x2 - box.x1);
      const y = box.y1 + sample.fy * (box.y2 - box.y1);
      if (x < 1 || y < 1 || x >= frame.width - 1 || y >= frame.height - 1) {
        continue;
      }

      const current = gradientAt(frame, x, y);
      const weight = Math.max(1, sample.weight);
      const denominator = Math.max(
        1,
        sample.magnitude * current.magnitude,
      );
      const cosine =
        (sample.gx * current.gx + sample.gy * current.gy) / denominator;
      const orientationScore = clamp((cosine + 1) / 2, 0, 1);
      const magnitudeRatio =
        Math.min(sample.magnitude, current.magnitude) /
        Math.max(1, Math.max(sample.magnitude, current.magnitude));
      const present =
        current.magnitude >= Math.max(7, sample.magnitude * 0.34) &&
        orientationScore >= 0.58;

      matchedWeight +=
        weight *
        (present
          ? orientationScore * 0.62 + magnitudeRatio * 0.38
          : 0);
      totalWeight += weight;
    }

    return matchedWeight / Math.max(1, totalWeight);
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

  function findBestMatch(frame, currentBox, recentTemplate, anchorTemplate, options = {}) {
    const occupied = Array.isArray(options.occupied) ? options.occupied : [];
    const expectedMotion = options.expectedMotion || { dx: 0, dy: 0 };
    const width = currentBox.x2 - currentBox.x1;
    const height = currentBox.y2 - currentBox.y1;
    const predicted = translate(
      currentBox,
      Number(expectedMotion.dx) || 0,
      Number(expectedMotion.dy) || 0,
    );
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
    const motionMagnitude = Math.hypot(
      Number(expectedMotion.dx) || 0,
      Number(expectedMotion.dy) || 0,
    );
    const movingOutward =
      motionMagnitude >= 0.8 &&
      predictedVisibleFraction + 0.04 < currentVisibleFraction;

    // Never pin a tracked box to the screen edge. If the motion model says
    // the selected text is leaving the visible frame, allow the occurrence
    // to end instead of forcing a replacement match somewhere on-screen.
    if (movingOutward && predictedVisibleFraction < 0.58) {
      return {
        box: predicted,
        score: 0,
        recentScore: 0,
        anchorScore: 0,
        identityScore: 0,
        strong: false,
        exitedFrame: true,
        predicted,
        predictedVisibleFraction,
        movement: motionMagnitude,
      };
    }

    const xRadius = Math.max(
      10,
      Math.min(30, width * 0.22 + Math.abs(expectedMotion.dx || 0) * 0.8),
    );
    const yRadius = Math.max(
      16,
      Math.min(46, height * 1.55 + Math.abs(expectedMotion.dy || 0) * 0.8),
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
      const recentScore = scoreTemplate(frame, candidate, recentTemplate);
      const anchorScore = scoreTemplate(frame, candidate, anchorTemplate);
      const identityScore = scoreIdentityEdges(
        frame,
        candidate,
        anchorTemplate,
      );
      const predictionDistance = Math.hypot(
        candidate.x1 - predicted.x1,
        candidate.y1 - predicted.y1,
      );
      const scale = Math.max(28, height * 2.4, width * 0.45);
      const continuityPenalty = Math.min(
        0.16,
        (predictionDistance / scale) * 0.13,
      );
      const overlap = occupied.reduce(
        (maximum, box) => Math.max(maximum, boxIoU(candidate, box)),
        0,
      );
      const collisionPenalty = overlap >= 0.55 ? 0.55 : overlap >= 0.2 ? 0.26 : 0;
      const score =
        recentScore * 0.68 +
        anchorScore * 0.20 +
        identityScore * 0.12 -
        continuityPenalty -
        collisionPenalty;
      return {
        box: candidate,
        score,
        recentScore,
        anchorScore,
        identityScore,
      };
    }

    let best = evaluate(predicted.x1, predicted.y1);
    const coarseStep = Math.max(2, Number(options.coarseStep) || 3);

    for (let y = minY; y <= maxY; y += coarseStep) {
      for (let x = minX; x <= maxX; x += coarseStep) {
        const candidate = evaluate(x, y);
        if (candidate.score > best.score) best = candidate;
      }
    }

    const refine = 4;
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

    const strong =
      best.recentScore >= (options.minimumRecentScore || 0.60) &&
      best.anchorScore >= (options.minimumAnchorScore || 0.50) &&
      best.identityScore >= (options.minimumIdentityScore || 0.72) &&
      best.score >= (options.minimumCombinedScore || 0.52);

    return {
      ...best,
      strong,
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
    scoreIdentityEdges,
    visibleFraction,
    boxIoU,
    findBestMatch,
  };
});
