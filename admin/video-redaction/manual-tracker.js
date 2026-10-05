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
          gx: gradient.gx,
          gy: gradient.gy,
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

    const foregroundSamples = fingerprint.filter(sample =>
      sample.value > fingerprintMean + fingerprintDeviation * 0.35 && sample.magnitude >= 28);

    // Immutable, textured portions of the selected characters can remain
    // visible when a fixed overlay covers the middle of the selection.
    const identityParts = [
      sample => sample.fx < 0.30,
      sample => sample.fx > 0.70,
      sample => sample.fy < 0.35,
      sample => sample.fy > 0.65,
    ].map(select => {
      const part = fingerprint.filter(select);
      const mean = part.reduce((sum, sample) => sum + sample.value, 0) / part.length;
      const deviation = Math.sqrt(part.reduce((sum, sample) => sum + (sample.value - mean) ** 2, 0) / part.length);
      return deviation >= 12 && part.filter(sample => sample.magnitude >= 28).length >= 12
        ? { fingerprint: part, fingerprintMean: mean, foregroundSamples: foregroundSamples.filter(select) }
        : null;
    });

    return {
      samples,
      identitySamples,
      fingerprint,
      foregroundSamples,
      identityParts,
      phaseX: box.x1 - Math.floor(box.x1),
      phaseY: box.y1 - Math.floor(box.y1),
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

  const frameLumaCache = new WeakMap();
  const denseSamplerCache = new WeakMap();

  function frameLuma(frame) {
    let luma = frameLumaCache.get(frame);
    if (luma) return luma;
    luma = new Float32Array(frame.width * frame.height);
    for (let pixel = 0; pixel < luma.length; pixel += 1) {
      const offset = pixel * 4;
      luma[pixel] = frame.data[offset] * 0.299 + frame.data[offset + 1] * 0.587 + frame.data[offset + 2] * 0.114;
    }
    frameLumaCache.set(frame, luma);
    return luma;
  }

  function denseSampler(template, box, frameWidth) {
    const phaseX = box.x1 - Math.floor(box.x1);
    const phaseY = box.y1 - Math.floor(box.y1);
    const width = Math.max(1, box.x2 - box.x1 - 1);
    const height = Math.max(1, box.y2 - box.y1 - 1);
    const cached = denseSamplerCache.get(template);
    if (cached && cached.phaseX === phaseX && cached.phaseY === phaseY && cached.width === width && cached.height === height && cached.frameWidth === frameWidth) return cached;
    const samples = template.fingerprint;
    const offsets = new Int32Array(samples.length);
    const centered = new Float64Array(samples.length);
    let variance = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      const x = Math.round(phaseX + sample.fx * width);
      const y = Math.round(phaseY + sample.fy * height);
      offsets[i] = y * frameWidth + x;
      centered[i] = sample.value - template.fingerprintMean;
      variance += centered[i] * centered[i];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const sampler = {phaseX, phaseY, width, height, frameWidth, offsets, centered, variance, minX, maxX, minY, maxY};
    denseSamplerCache.set(template, sampler);
    return sampler;
  }

  function scoreDenseCorrelation(frame, box, template) {
    const samples = template?.fingerprint || [];
    if (!samples.length) return -1;

    let sum = 0;
    let squareSum = 0;
    let covariance = 0;
    const sampler = denseSampler(template, box, frame.width);
    const x = Math.floor(box.x1), y = Math.floor(box.y1);
    if (x + sampler.minX < 0 || y + sampler.minY < 0 || x + sampler.maxX >= frame.width || y + sampler.maxY >= frame.height) return -1;
    const origin = y * frame.width + x;
    const luma = frameLuma(frame);
    for (let i = 0; i < samples.length; i += 1) {
      const value = luma[origin + sampler.offsets[i]];
      sum += value;
      squareSum += value * value;
      covariance += sampler.centered[i] * value;
    }
    const candidateVariance = Math.max(0, squareSum - sum * sum / samples.length);
    return covariance / Math.max(1, Math.sqrt(sampler.variance * candidateVariance));
  }

  function scoreForegroundEdges(frame, box, template) {
    const samples = template?.foregroundSamples || [];
    if (samples.length < 16) return 0;
    let agreement = 0;
    for (const sample of samples) {
      const x = box.x1 + sample.fx * Math.max(1, box.x2 - box.x1 - 1);
      const y = box.y1 + sample.fy * Math.max(1, box.y2 - box.y1 - 1);
      if (x < 1 || y < 1 || x >= frame.width - 1 || y >= frame.height - 1) continue;
      const current = gradientAt(frame, x, y);
      if (current.magnitude < Math.max(9, sample.magnitude * 0.30)) continue;
      const cosine = (sample.gx * current.gx + sample.gy * current.gy) /
        Math.max(1, sample.magnitude * current.magnitude);
      const ratio = Math.min(sample.magnitude, current.magnitude) /
        Math.max(1, Math.max(sample.magnitude, current.magnitude));
      agreement += Math.max(0, cosine) * 0.85 + ratio * 0.15;
    }
    return agreement / samples.length;
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
      const denseRecentCorrelation = scoreDenseCorrelation(
        frame,
        candidate,
        recentTemplate,
      );
      const denseAnchorCorrelation = scoreDenseCorrelation(
        frame,
        candidate,
        anchorTemplate,
      );

      // Character edges retain identity when a photo loads behind white text.
      // Keep dense texture as default, with a strict foreground-only fallback.
      const needsForeground = denseAnchorCorrelation >= 0.25 && denseAnchorCorrelation < (options.minimumAnchorCorrelation || 0.82);
      const foregroundAnchor = needsForeground ? scoreForegroundEdges(frame, candidate, anchorTemplate) : 0;
      const foregroundRecent = needsForeground ? scoreForegroundEdges(frame, candidate, recentTemplate) : 0;
      const foregroundConfirmed = foregroundAnchor >= 0.85 && foregroundRecent >= 0.80 && denseAnchorCorrelation >= 0.25;
      const anchorCorrelation = foregroundConfirmed ? Math.max(denseAnchorCorrelation, foregroundAnchor) : denseAnchorCorrelation;
      const recentCorrelation = foregroundConfirmed ? Math.max(denseRecentCorrelation, foregroundRecent) : denseRecentCorrelation;

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

      let partialIdentity = false;
      let partialScore = 0;
      if (options.allowPartialIdentity && overlap < 0.2 &&
          (recentCorrelation < (options.minimumRecentCorrelation || 0.70) ||
           anchorCorrelation < (options.minimumAnchorCorrelation || 0.82))) {
        for (let part = 0; part < (anchorTemplate.identityParts || []).length; part++) {
          const anchorPart = anchorTemplate.identityParts[part];
          const recentPart = recentTemplate.identityParts?.[part];
          if (!anchorPart) continue;
          const original = scoreDenseCorrelation(frame, candidate, anchorPart);
          const previous = scoreDenseCorrelation(frame, candidate, recentPart);
          const originalEdges = scoreForegroundEdges(frame, candidate, anchorPart);
          if ((original >= 0.94 && previous >= 0.70) ||
              (original >= 0.85 && originalEdges >= 0.80)) {
            partialIdentity = true;
            partialScore = Math.max(partialScore, original * 0.7 + previous * 0.3,
              originalEdges);
          }
        }
      }

      const score =
        Math.max(recentCorrelation * 0.70 + anchorCorrelation * 0.30, partialScore) -
        continuityPenalty -
        collisionPenalty;

      return {
        box: candidate,
        score,
        recentScore: recentCorrelation,
        anchorScore: anchorCorrelation,
        recentCorrelation,
        anchorCorrelation,
        denseAnchorCorrelation,
        partialIdentity,
      };
    }

    // Preserve the subpixel sampling phase of a hand-drawn box. Snapping
    // candidates to integer origins can change which thin glyph pixels are
    // sampled even when the text itself has not changed.
    const phaseX = anchorTemplate.phaseX ?? (currentBox.x1 - Math.floor(currentBox.x1));
    const phaseY = anchorTemplate.phaseY ?? (currentBox.y1 - Math.floor(currentBox.y1));

    function confirmed(candidate) {
      return candidate.partialIdentity || (candidate.recentCorrelation >= (options.minimumRecentCorrelation || 0.70) &&
        candidate.anchorCorrelation >= (options.minimumAnchorCorrelation || 0.82) &&
        candidate.score >= (options.minimumCombinedScore || 0.60));
    }
    function result(candidate) {
      return {
        ...candidate, strong: confirmed(candidate), exitingFrame: false, exitedFrame: false,
        predicted, predictedVisibleFraction,
        movement: Math.hypot(candidate.box.x1 - currentBox.x1, candidate.box.y1 - currentBox.y1),
        searchRadiusX: xRadius, searchRadiusY: yRadius,
      };
    }
    // Most UI frames are stationary or move a few pixels. Confirm them close
    // to the motion prediction before paying for a full search. This also
    // prevents skipped frames caused by exhaustive matching on every tick.
    let localBest = evaluate(predicted.x1, predicted.y1);
    const stationary = evaluate(currentBox.x1, currentBox.y1);
    if (stationary.anchorCorrelation >= localBest.anchorCorrelation && stationary.score >= localBest.score - 0.01) localBest = stationary;
    if (confirmed(localBest) && localBest.score >= 0.88) return result(localBest);
    for (let y = Math.max(minY, Math.floor(predicted.y1 - 4)); y <= Math.min(maxY, Math.ceil(predicted.y1 + 4)); y++) {
      for (let x = Math.max(minX, Math.floor(predicted.x1 - 3)); x <= Math.min(maxX, Math.ceil(predicted.x1 + 3)); x++) {
        const candidate = evaluate(x + phaseX, y + phaseY);
        if (candidate.score > localBest.score) localBest = candidate;
      }
    }
    if (confirmed(localBest)) return result(localBest);

    // Scrolling panels usually keep their horizontal position. Search that
    // narrow strip first, with the same full identity checks, so a rapid
    // vertical movement does not stall playback on a two-dimensional search.
    if (Math.abs(Number(expectedMotion.dx) || 0) <= 3) {
      const verticalSeeds = [];
      const centerX = Math.floor(currentBox.x1);
      for (let y = minY; y <= maxY; y += 3) {
        for (let x = Math.max(minX, centerX - 1); x <= Math.min(maxX, centerX + 1); x += 1) {
          verticalSeeds.push(evaluate(x + phaseX, y + phaseY));
        }
      }
      verticalSeeds.sort((a, b) => b.score - a.score);
      for (const seed of verticalSeeds.slice(0, 4)) {
        for (let y = Math.max(minY, Math.floor(seed.box.y1 - 3)); y <= Math.min(maxY, Math.ceil(seed.box.y1 + 3)); y += 1) {
          for (let x = Math.max(minX, Math.floor(seed.box.x1 - 1)); x <= Math.min(maxX, Math.ceil(seed.box.x1 + 1)); x += 1) {
            const candidate = evaluate(x + phaseX, y + phaseY);
            if (candidate.score > localBest.score) localBest = candidate;
          }
        }
      }
      if (confirmed(localBest)) return result(localBest);
    }

    // Character texture has narrow correlation peaks. A single coarse-grid
    // winner can be an unrelated alias while the real text falls between grid
    // positions. Refine several independent candidates, always including the
    // last known and predicted positions.
    let best = evaluate(predicted.x1, predicted.y1);
    const seeds = [best, evaluate(currentBox.x1, currentBox.y1)];
    const coarseStep = Math.max(3, Number(options.coarseStep) || (fastSearch ? 5 : 3));
    for (let y = minY; y <= maxY; y += coarseStep) {
      for (let x = minX; x <= maxX; x += coarseStep) {
        const candidate = evaluate(x + phaseX, y + phaseY);
        if (candidate.score > best.score) best = candidate;
        seeds.push(candidate);
      }
    }
    seeds.sort((a, b) => b.score - a.score);
    const finalists = [evaluate(predicted.x1, predicted.y1), evaluate(currentBox.x1, currentBox.y1), ...seeds.slice(0, 8)];
    const visited = new Set();
    const refine = coarseStep;
    for (const seed of finalists) {
      const left = Math.max(minX, Math.floor(seed.box.x1 - refine));
      const right = Math.min(maxX, Math.ceil(seed.box.x1 + refine));
      const top = Math.max(minY, Math.floor(seed.box.y1 - refine));
      const bottom = Math.min(maxY, Math.ceil(seed.box.y1 + refine));
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const key = y * frame.width + x;
          if (visited.has(key)) continue;
          visited.add(key);
          const candidate = evaluate(x + phaseX, y + phaseY);
          if (candidate.score > best.score) best = candidate;
        }
      }
    }

    return result(best);
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
    scoreForegroundEdges,
    scoreFingerprint,
    visibleFraction,
    boxIoU,
    findBestMatch,
  };
});
