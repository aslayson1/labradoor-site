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

    // Dense, exact-position fingerprint of the user's selected region. This
    // is intentionally inside the box only: surrounding cards/buttons may
    // share a visual style, but the actual character texture should not.
    const fingerprintCols = Math.max(
      24,
      Math.min(48, Math.round(width / 2.5)),
    );
    const fingerprintRows = Math.max(
      10,
      Math.min(24, Math.round(height / 2)),
    );
    const fingerprint = [];
    let fingerprintSum = 0;
    for (let row = 0; row < fingerprintRows; row += 1) {
      for (let col = 0; col < fingerprintCols; col += 1) {
        const fx = (col + 0.5) / fingerprintCols;
        const fy = (row + 0.5) / fingerprintRows;
        const px = box.x1 + fx * Math.max(1, width - 1);
        const py = box.y1 + fy * Math.max(1, height - 1);
        const value = grayAt(frame, px, py);
        const gradient = gradientAt(frame, px, py);
        fingerprint.push({
          fx,
          fy,
          value,
          magnitude: gradient.magnitude,
        });
        fingerprintSum += value;
      }
    }
    const fingerprintMean =
      fingerprintSum / Math.max(1, fingerprint.length);
    let fingerprintVariance = 0;
    for (const sample of fingerprint) {
      fingerprintVariance += (sample.value - fingerprintMean) ** 2;
    }
    const fingerprintDeviation = Math.sqrt(
      Math.max(16, fingerprintVariance / Math.max(1, fingerprint.length)),
    );
    for (const sample of fingerprint) {
      sample.normalized =
        (sample.value - fingerprintMean) / fingerprintDeviation;
      sample.weight =
        0.5 +
        Math.min(2.5, Math.abs(sample.normalized)) +
        Math.min(2, sample.magnitude / 36);
    }

    return {
      samples,
      identitySamples,
      fingerprint,
      fingerprintMean,
      fingerprintDeviation,
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

  function scoreCorrelation(frame, box, template) {
    const samples = template?.samples || [];
    if (!samples.length) return -1;

    let candidateWeightedSum = 0;
    let totalWeight = 0;
    const values = [];

    for (const sample of samples) {
      const x = box.x1 + sample.fx * (box.x2 - box.x1);
      const y = box.y1 + sample.fy * (box.y2 - box.y1);
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
        return -1;
      }
      const value = grayAt(frame, x, y);
      values.push(value);
      candidateWeightedSum += value * sample.weight;
      totalWeight += sample.weight;
    }

    const candidateMean =
      candidateWeightedSum / Math.max(1, totalWeight);
    let covariance = 0;
    let candidateVariance = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const weight = sample.weight;
      const a = sample.value - template.mean;
      const b = values[index] - candidateMean;
      covariance += weight * a * b;
      candidateVariance += weight * b * b;
    }

    return covariance /
      Math.max(
        1,
        totalWeight *
          template.deviation *
          Math.sqrt(
            Math.max(
              1,
              candidateVariance / Math.max(1, totalWeight),
            ),
          ),
      );
  }

  function scoreDenseCorrelation(frame, box, template) {
    const samples = template?.fingerprint || [];
    if (!samples.length) return -1;

    const values = new Array(samples.length);
    let candidateSum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const x = box.x1 + sample.fx * (box.x2 - box.x1);
      const y = box.y1 + sample.fy * (box.y2 - box.y1);
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
        return -1;
      }
      const value = grayAt(frame, x, y);
      values[index] = value;
      candidateSum += value;
    }

    const candidateMean = candidateSum / values.length;
    let covariance = 0;
    let templateVariance = 0;
    let candidateVariance = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const a = samples[index].value - template.fingerprintMean;
      const b = values[index] - candidateMean;
      covariance += a * b;
      templateVariance += a * a;
      candidateVariance += b * b;
    }

    return covariance /
      Math.max(1, Math.sqrt(templateVariance * candidateVariance));
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

  function scoreFingerprint(frame, box, template) {
    const fingerprint = template?.fingerprint || [];
    if (!fingerprint.length) return 0;

    const values = [];
    let sum = 0;
    for (const sample of fingerprint) {
      const x = box.x1 + sample.fx * (box.x2 - box.x1);
      const y = box.y1 + sample.fy * (box.y2 - box.y1);
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
        return 0;
      }
      const value = grayAt(frame, x, y);
      values.push(value);
      sum += value;
    }

    const mean = sum / values.length;
    let variance = 0;
    for (const value of values) variance += (value - mean) ** 2;
    const deviation = Math.sqrt(Math.max(16, variance / values.length));

    let weightedError = 0;
    let weightedAgreement = 0;
    let totalWeight = 0;
    for (let index = 0; index < fingerprint.length; index += 1) {
      const sample = fingerprint[index];
      const normalized = (values[index] - mean) / deviation;
      const difference = Math.abs(sample.normalized - normalized);
      const sameSign =
        sample.normalized === 0 ||
        normalized === 0 ||
        Math.sign(sample.normalized) === Math.sign(normalized);
      weightedError += sample.weight * Math.min(3, difference);
      weightedAgreement += sample.weight * (sameSign ? 1 : 0);
      totalWeight += sample.weight;
    }

    const meanError = weightedError / Math.max(1, totalWeight);
    const textureScore = Math.exp(-meanError * 1.15);
    const signAgreement =
      weightedAgreement / Math.max(1, totalWeight);
    return textureScore * 0.72 + signAgreement * 0.28;
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
    const elapsedSeconds = Math.max(
      1 / 240,
      Number(options.elapsedSeconds) || 1 / 60,
    );
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

    if (movingOutward && predictedVisibleFraction < 0.98) {
      const exitedFrame = predictedVisibleFraction <= 0.01;
      return {
        box: predicted,
        score: exitedFrame ? 0 : 1,
        recentScore: exitedFrame ? -1 : 1,
        anchorScore: exitedFrame ? -1 : 1,
        recentCorrelation: exitedFrame ? -1 : 1,
        anchorCorrelation: exitedFrame ? -1 : 1,
        denseAnchorCorrelation: exitedFrame ? -1 : 1,
        strong: !exitedFrame,
        exitingFrame: !exitedFrame,
        exitedFrame,
        predicted,
        predictedVisibleFraction,
        movement: motionMagnitude,
      };
    }

    const fastSearch =
      elapsedSeconds > 0.024 ||
      Math.abs(expectedMotion.dx || 0) > width * 0.22 ||
      Math.abs(expectedMotion.dy || 0) > height * 0.75;

    const skippedFrameAllowance = Math.max(
      0,
      elapsedSeconds - 1 / 60,
    ) * 3400;
    const xRadius = fastSearch
      ? Math.max(
          46,
          Math.min(
            150,
            width * 0.28 +
              Math.abs(expectedMotion.dx || 0) * 1.25 +
              skippedFrameAllowance,
          ),
        )
      : Math.max(
          10,
          Math.min(30, width * 0.22 + Math.abs(expectedMotion.dx || 0) * 0.8),
        );
    const yRadius = fastSearch
      ? Math.max(
          82,
          Math.min(
            190,
            height * 2.0 +
              Math.abs(expectedMotion.dy || 0) * 1.35 +
              skippedFrameAllowance,
          ),
        )
      : Math.max(
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
      const candidate = {
        x1: x,
        y1: y,
        x2: x + width,
        y2: y + height,
      };
      const recentCorrelation = scoreDenseCorrelation(
        frame,
        candidate,
        recentTemplate,
      );
      const anchorCorrelation = scoreDenseCorrelation(
        frame,
        candidate,
        anchorTemplate,
      );

      const predictionDistance = Math.hypot(
        candidate.x1 - predicted.x1,
        candidate.y1 - predicted.y1,
      );
      const scale = Math.max(34, height * 2.8, width * 0.5);
      const continuityPenalty = Math.min(
        fastSearch ? 0.08 : 0.12,
        (predictionDistance / scale) * (fastSearch ? 0.05 : 0.08),
      );

      const overlap = occupied.reduce(
        (maximum, box) => Math.max(maximum, boxIoU(candidate, box)),
        0,
      );
      const collisionPenalty =
        overlap >= 0.55 ? 0.60 : overlap >= 0.2 ? 0.30 : 0;

      const score =
        recentCorrelation * 0.70 +
        anchorCorrelation * 0.30 -
        continuityPenalty -
        collisionPenalty;

      return {
        box: candidate,
        score,
        recentScore: recentCorrelation,
        anchorScore: anchorCorrelation,
        recentCorrelation,
        anchorCorrelation,
        denseAnchorCorrelation: anchorCorrelation,
      };
    }

    let best = evaluate(predicted.x1, predicted.y1);
    const coarseStep = Math.max(
      3,
      Number(options.coarseStep) || (fastSearch ? 5 : 3),
    );

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

    const strong =
      best.recentCorrelation >=
        (options.minimumRecentCorrelation || 0.70) &&
      best.anchorCorrelation >=
        (options.minimumAnchorCorrelation || 0.82) &&
      best.score >=
        (options.minimumCombinedScore || 0.60);

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
      searchRadiusX: xRadius,
      searchRadiusY: yRadius,
    };
  }

  return {
    clampBox,
    grayAt,
    gradientAt,
    makeTemplate,
    scoreTemplate,
    scoreCorrelation,
    scoreDenseCorrelation,
    scoreIdentityEdges,
    scoreFingerprint,
    visibleFraction,
    boxIoU,
    findBestMatch,
  };
});
