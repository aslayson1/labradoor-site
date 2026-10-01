(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const auth = byId('auth');
  const authForm = byId('authForm');
  const authNotice = byId('authNotice');
  const password = byId('password');
  const signIn = byId('signIn');
  const app = byId('app');
  const sessionState = byId('sessionState');
  const sessionDot = byId('sessionDot');
  const upload = byId('upload');
  const fileInput = byId('file');
  const workspace = byId('workspace');
  const source = byId('source');
  const display = byId('display');
  const context = display.getContext('2d');
  const scrub = byId('scrub');
  const timeLabel = byId('time');
  const play = byId('play');
  const manualProcess = byId('manualProcess');
  const processButton = byId('process');
  const replaceButton = byId('replace');
  const progress = byId('progress');
  const progressBar = byId('progressBar');
  const progressText = byId('progressText');
  const jobStatus = byId('jobStatus');
  const reviewSection = byId('reviewSection');
  const reviewList = byId('reviewList');
  const findingCount = byId('findingCount');
  const correctionSection = byId('correctionSection');
  const correctionList = byId('correctionList');
  const correctionCount = byId('correctionCount');
  const selectionEditor = byId('selectionEditor');
  const startTime = byId('startTime');
  const endTime = byId('endTime');
  const correctionKind = byId('correctionKind');
  const trackingMode = byId('trackingMode');
  const endCorrectionHere = byId('endCorrectionHere');
  const removeCorrection = byId('removeCorrection');
  const applyCorrections = byId('applyCorrections');
  const output = byId('output');
  const result = byId('result');
  const outputMeta = byId('outputMeta');
  const download = byId('download');
  const hint = byId('hint');

  const colors = {
    address: '#ffb000',
    owner_name: '#9862d4',
    phone: '#2878d0',
    email: '#1f9d64',
  };
  const terminalStatuses = new Set(['complete', 'needs_review', 'failed', 'cancelled']);
  const statusLabels = {
    queued: 'Worker starting',
    analyzing: 'Inspecting frames and detecting private text',
    redacting: 'Rendering tight protection masks',
    verifying: 'Running independent verification',
    needs_review: 'Manual review required',
    complete: 'Independent verification passed',
    failed: 'Processing stopped',
    cancelled: 'Processing cancelled',
  };
  const reasonLabels = {
    ocr_failure: 'OCR check failed',
    track_lost: 'Region tracking lost',
    scene_cut: 'Scene change',
    verification_hit: 'Verifier found private text',
    missing_frame_plan: 'Frame plan missing',
    unverified_backend: 'Verifier unavailable',
    manual_review: 'Manual review',
  };

  let sessionToken = '';
  let sessionExpiresAt = 0;
  let apiBaseUrl = '';
  let sourceFile = null;
  let sourceUrl = '';
  let outputUrl = '';
  let currentJob = null;
  let currentReview = null;
  let totalFrames = 0;
  let corrections = [];
  let selectedCorrectionId = null;
  let gesture = null;
  let protectionStyle = 'blur';
  let busy = false;
  let runVersion = 0;
  let animationFrame = 0;
  const previewTrackers = new Map();
  const trackingCanvas = document.createElement('canvas');
  const trackingContext = trackingCanvas.getContext('2d', { willReadFrequently: true });
  const previewScratch = document.createElement('canvas');
  const previewScratchContext = previewScratch.getContext('2d');
  const previewStrongMatch = 0.38;
  const previewWeakMatch = 0.24;
  const previewLostFrameLimit = 3;

  function formatTime(value) {
    if (!Number.isFinite(value)) return '00:00.00';
    const minutes = Math.floor(value / 60);
    const seconds = value - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${seconds
      .toFixed(2)
      .padStart(5, '0')}`;
  }

  function setNotice(element, message, tone = '') {
    element.textContent = message;
    element.className = `notice show ${tone}`.trim();
  }

  function clearNotice(element) {
    element.textContent = '';
    element.className = 'notice';
  }

  function setJobStatus(title, detail, tone = '') {
    jobStatus.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = title;
    jobStatus.appendChild(heading);
    if (detail) jobStatus.appendChild(document.createTextNode(detail));
    jobStatus.className = `job-status ${tone}`.trim();
    jobStatus.hidden = false;
  }

  function showProgress(percent, message) {
    progress.classList.add('show');
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progressText.textContent = message;
  }

  function hideProgress() {
    progress.classList.remove('show');
  }

  function expireSession(message) {
    sessionToken = '';
    sessionExpiresAt = 0;
    apiBaseUrl = '';
    sessionState.textContent = 'Locked';
    sessionDot.style.background = '#c73545';
    auth.hidden = false;
    app.hidden = true;
    if (message) setNotice(authNotice, message, 'error');
    password.focus();
  }

  async function readError(response) {
    try {
      const body = await response.json();
      return body.detail || body.error || `Request failed with status ${response.status}`;
    } catch {
      return `Request failed with status ${response.status}`;
    }
  }

  async function apiFetch(path, options = {}) {
    if (!sessionToken || Date.now() >= sessionExpiresAt) {
      expireSession('Your secure session expired. Sign in again to continue.');
      throw new Error('Secure session expired');
    }
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${sessionToken}`);
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });
    if (response.status === 401) {
      expireSession(
        'The redaction worker could not validate this session. This is a server connection problem, not an expired login.',
      );
      throw new Error('Redaction worker authentication failed');
    }
    return response;
  }

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearNotice(authNotice);
    signIn.disabled = true;
    signIn.textContent = 'Opening…';

    try {
      const response = await fetch('/api/redaction-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ password: password.value }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const session = await response.json();
      if (!session.token || !session.expiresAt || !session.apiBaseUrl) {
        throw new Error('The server returned an invalid secure session');
      }

      sessionToken = session.token;
      sessionExpiresAt = new Date(session.expiresAt).getTime();
      apiBaseUrl = session.apiBaseUrl.replace(/\/+$/, '');
      password.value = '';
      auth.hidden = true;
      app.hidden = false;
      sessionState.textContent = 'Secure session active';
      sessionDot.style.background = '#167a48';

      if (currentJob && !terminalStatuses.has(currentJob.status)) {
        pollJob(currentJob.id, runVersion).catch(handleProcessingError);
      }
    } catch (error) {
      setNotice(authNotice, error.message || 'Could not open the editor', 'error');
    } finally {
      signIn.disabled = false;
      signIn.textContent = 'Start secure session';
    }
  });

  function resetOutput() {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = '';
    result.removeAttribute('src');
    result.load();
    output.hidden = true;
  }

  function resetJob() {
    runVersion += 1;
    currentJob = null;
    currentReview = null;
    totalFrames = 0;
    corrections = [];
    selectedCorrectionId = null;
    busy = false;
    gesture = null;
    previewTrackers.clear();
    processButton.disabled = false;
    replaceButton.disabled = false;
    jobStatus.hidden = true;
    reviewSection.hidden = true;
    correctionSection.hidden = !sourceFile;
    hideProgress();
    resetOutput();
    renderCorrections();
    drawFrame();
  }

  function loadVideo(file) {
    if (!file || busy) return;
    if (file.size > 1024 * 1024 * 1024) {
      setJobStatus('Video is too large', 'The upload limit is 1 GB.', 'warn');
      return;
    }

    sourceFile = file;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    resetJob();

    source.onloadedmetadata = () => {
      if (!Number.isFinite(source.duration) || source.duration <= 0) {
        setJobStatus('Video preview is unavailable', 'Try an MP4 encoded with H.264.', 'warn');
        return;
      }
      if (source.duration > 600.05) {
        setJobStatus('Video is too long', 'The current processing limit is 10 minutes.', 'warn');
        manualProcess.disabled = true;
        processButton.disabled = true;
      }

      display.width = source.videoWidth;
      display.height = source.videoHeight;
      upload.hidden = true;
      workspace.hidden = false;
      correctionSection.hidden = false;
      scrub.value = '0';
      source.currentTime = 0;
      updateTime();
      drawFrame();
    };
    source.onerror = () => {
      upload.hidden = true;
      workspace.hidden = false;
      setJobStatus(
        'This browser cannot preview the video',
        'Convert it to an H.264 MP4 so you can review and edit exact frames.',
        'warn',
      );
    };

    source.src = sourceUrl;
    source.load();
  }

  byId('choose').addEventListener('click', () => fileInput.click());
  replaceButton.addEventListener('click', async () => {
    if (busy) await cancelCurrentJob();
    fileInput.click();
  });
  fileInput.addEventListener('change', (event) => loadVideo(event.target.files[0]));

  for (const eventName of ['dragenter', 'dragover']) {
    upload.addEventListener(eventName, (event) => {
      event.preventDefault();
      upload.classList.add('drag');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    upload.addEventListener(eventName, (event) => {
      event.preventDefault();
      upload.classList.remove('drag');
    });
  }
  upload.addEventListener('drop', (event) => loadVideo(event.dataTransfer.files[0]));

  function updateTime() {
    scrub.value = source.duration
      ? String((source.currentTime / source.duration) * 1000)
      : '0';
    timeLabel.textContent = `${formatTime(source.currentTime)} / ${formatTime(
      source.duration,
    )}`;
  }

  function animateSource() {
    cancelAnimationFrame(animationFrame);
    const tick = () => {
      updateTime();
      drawFrame();
      if (!source.paused && !source.ended) {
        animationFrame = requestAnimationFrame(tick);
      }
    };
    tick();
  }

  play.addEventListener('click', async () => {
    if (source.paused) {
      try {
        await source.play();
      } catch {
        setJobStatus('Playback could not start', 'Use the timeline to inspect frames.', 'warn');
      }
    } else {
      source.pause();
    }
  });
  source.addEventListener('play', () => {
    play.textContent = 'Pause';
    animateSource();
  });
  source.addEventListener('pause', () => {
    play.textContent = 'Play';
    animateSource();
  });
  source.addEventListener('ended', () => {
    play.textContent = 'Play';
    animateSource();
  });
  source.addEventListener('seeked', animateSource);
  source.addEventListener('loadeddata', animateSource);
  scrub.addEventListener('input', () => {
    if (!source.duration) return;
    source.currentTime = (Number(scrub.value) / 1000) * source.duration;
    updateTime();
  });

  function selectedCorrection() {
    return corrections.find((item) => item.id === selectedCorrectionId) || null;
  }

  function frameDuration() {
    if (!totalFrames || !source.duration) return 1 / 30;
    return source.duration / totalFrames;
  }

  function visibleAt(item, time) {
    const margin = frameDuration() * 0.55;
    return time >= item.startSeconds - margin && time <= item.endSeconds + margin;
  }

  function findings() {
    const raw = currentReview?.result?.findings;
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.filter((item) => {
      const box = item.box
        ? `${item.box.x1}:${item.box.y1}:${item.box.x2}:${item.box.y2}`
        : '';
      const key = `${item.frame_index}:${item.reason}:${box}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function drawBox(box, color, dashed = false, selected = false) {
    const width = box.x2 - box.x1;
    const height = box.y2 - box.y1;
    context.save();
    context.fillStyle = `${color}28`;
    context.fillRect(box.x1, box.y1, width, height);
    context.strokeStyle = color;
    context.lineWidth = Math.max(2, display.width / 700);
    context.setLineDash(dashed ? [10, 6] : []);
    context.strokeRect(box.x1, box.y1, width, height);
    if (selected) {
      const handle = Math.max(12, display.width / 80);
      context.setLineDash([]);
      context.fillStyle = '#ffcf32';
      context.fillRect(
        box.x2 - handle / 2,
        box.y2 - handle / 2,
        handle,
        handle,
      );
    }
    context.restore();
  }

  function draftBox() {
    if (!gesture || gesture.mode !== 'draw') return null;
    return {
      x1: Math.min(gesture.startX, gesture.currentX),
      y1: Math.min(gesture.startY, gesture.currentY),
      x2: Math.max(gesture.startX, gesture.currentX),
      y2: Math.max(gesture.startY, gesture.currentY),
    };
  }

  function clampPreviewBox(box) {
    const width = Math.max(4, box.x2 - box.x1);
    const height = Math.max(4, box.y2 - box.y1);
    const x1 = Math.max(0, Math.min(display.width - width, box.x1));
    const y1 = Math.max(0, Math.min(display.height - height, box.y1));
    return {
      x1,
      y1,
      x2: x1 + width,
      y2: y1 + height,
    };
  }

  function grayAt(data, width, x, y) {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(data.height - 1, Math.round(y)));
    const index = (py * width + px) * 4;
    return (
      data.data[index] * 0.299 +
      data.data[index + 1] * 0.587 +
      data.data[index + 2] * 0.114
    );
  }

  function makePreviewTemplate(box) {
    const x1 = Math.max(0, Math.floor(box.x1));
    const y1 = Math.max(0, Math.floor(box.y1));
    const width = Math.max(4, Math.min(display.width - x1, Math.ceil(box.x2 - box.x1)));
    const height = Math.max(4, Math.min(display.height - y1, Math.ceil(box.y2 - box.y1)));
    if (width < 4 || height < 4) return null;

    let image;
    try {
      image = trackingContext.getImageData(x1, y1, width, height);
    } catch {
      return null;
    }

    const cols = 9;
    const rows = 5;
    const samples = [];
    let sum = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const fx = (col + 0.5) / cols;
        const fy = (row + 0.5) / rows;
        const value = grayAt(image, width, fx * (width - 1), fy * (height - 1));
        samples.push({ fx, fy, value });
        sum += value;
      }
    }
    const mean = sum / samples.length;
    const variance =
      samples.reduce((total, sample) => total + (sample.value - mean) ** 2, 0) /
      samples.length;
    return {
      samples,
      mean,
      deviation: Math.sqrt(Math.max(variance, 1)),
      width: box.x2 - box.x1,
      height: box.y2 - box.y1,
    };
  }

  function candidateCorrelation(searchImage, searchOrigin, box, template) {
    let candidateSum = 0;
    let absoluteDelta = 0;
    const values = [];
    for (const sample of template.samples) {
      const x = box.x1 + sample.fx * (box.x2 - box.x1) - searchOrigin.x;
      const y = box.y1 + sample.fy * (box.y2 - box.y1) - searchOrigin.y;
      const value = grayAt(searchImage, searchImage.width, x, y);
      values.push(value);
      candidateSum += value;
      absoluteDelta += Math.abs(sample.value - value);
    }
    const candidateMean = candidateSum / values.length;
    let candidateVariance = 0;
    let covariance = 0;
    for (let index = 0; index < values.length; index += 1) {
      const a = template.samples[index].value - template.mean;
      const b = values[index] - candidateMean;
      candidateVariance += b * b;
      covariance += a * b;
    }
    const candidateDeviation = Math.sqrt(
      Math.max(candidateVariance / values.length, 1),
    );
    const correlation =
      covariance /
      values.length /
      Math.max(1, template.deviation * candidateDeviation);
    const appearanceScore = Math.max(
      0,
      1 - absoluteDelta / values.length / 90,
    );
    return correlation * 0.78 + appearanceScore * 0.22;
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

  function otherTrackedBoxes(itemId, now) {
    return corrections.flatMap((other) => {
      if (other.id === itemId || !visibleAt(other, now)) return [];
      if (other.trackingMode !== 'forward') return [other.box];
      const tracker = previewTrackers.get(other.id);
      if (!tracker || tracker.lost) return [];
      return [tracker.box];
    });
  }

  function candidateStabilityPenalty(candidate, current, occupied) {
    const currentCenterX = (current.x1 + current.x2) / 2;
    const currentCenterY = (current.y1 + current.y2) / 2;
    const candidateCenterX = (candidate.x1 + candidate.x2) / 2;
    const candidateCenterY = (candidate.y1 + candidate.y2) / 2;
    const distance = Math.hypot(
      candidateCenterX - currentCenterX,
      candidateCenterY - currentCenterY,
    );
    const scale = Math.max(
      36,
      (current.x2 - current.x1) * 1.4,
      (current.y2 - current.y1) * 3.2,
    );
    const motionPenalty = Math.min(0.18, (distance / scale) * 0.12);
    const collision = occupied.reduce(
      (maximum, box) => Math.max(maximum, boxIoU(candidate, box)),
      0,
    );
    const collisionPenalty = collision >= 0.55 ? 0.55 : collision >= 0.2 ? 0.28 : 0;
    return motionPenalty + collisionPenalty;
  }

  function searchPreviewBox(item, tracker, now) {
    const current = tracker.box;
    const width = current.x2 - current.x1;
    const height = current.y2 - current.y1;
    const xRadius = Math.max(18, Math.min(72, width * 0.9));
    const yRadius = Math.max(42, Math.min(180, height * 5));

    const searchX1 = Math.max(0, Math.floor(current.x1 - xRadius));
    const searchY1 = Math.max(0, Math.floor(current.y1 - yRadius));
    const searchX2 = Math.min(
      display.width,
      Math.ceil(current.x2 + xRadius),
    );
    const searchY2 = Math.min(
      display.height,
      Math.ceil(current.y2 + yRadius),
    );

    let searchImage;
    try {
      searchImage = trackingContext.getImageData(
        searchX1,
        searchY1,
        Math.max(1, searchX2 - searchX1),
        Math.max(1, searchY2 - searchY1),
      );
    } catch {
      return { box: current, score: -Infinity };
    }

    const occupied = otherTrackedBoxes(item.id, now);
    const coarseStep = 4;
    let best = { box: current, score: -Infinity };
    const minX = searchX1;
    const maxX = Math.max(minX, searchX2 - width);
    const minY = searchY1;
    const maxY = Math.max(minY, searchY2 - height);

    for (let y = minY; y <= maxY; y += coarseStep) {
      for (let x = minX; x <= maxX; x += coarseStep) {
        const candidate = { x1: x, y1: y, x2: x + width, y2: y + height };
        const identityScore = candidateCorrelation(
          searchImage,
          { x: searchX1, y: searchY1 },
          candidate,
          tracker.template,
        );
        const score =
          identityScore -
          candidateStabilityPenalty(candidate, current, occupied);
        if (score > best.score) best = { box: candidate, score };
      }
    }

    const refine = 5;
    const refineMinX = Math.max(minX, best.box.x1 - refine);
    const refineMaxX = Math.min(maxX, best.box.x1 + refine);
    const refineMinY = Math.max(minY, best.box.y1 - refine);
    const refineMaxY = Math.min(maxY, best.box.y1 + refine);
    for (let y = refineMinY; y <= refineMaxY; y += 1) {
      for (let x = refineMinX; x <= refineMaxX; x += 1) {
        const candidate = { x1: x, y1: y, x2: x + width, y2: y + height };
        const identityScore = candidateCorrelation(
          searchImage,
          { x: searchX1, y: searchY1 },
          candidate,
          tracker.template,
        );
        const score =
          identityScore -
          candidateStabilityPenalty(candidate, current, occupied);
        if (score > best.score) best = { box: candidate, score };
      }
    }

    return {
      box: clampPreviewBox(best.box),
      score: best.score,
    };
  }

  function previewBoxFor(item, now) {
    if (!visibleAt(item, now)) return null;
    if (item.trackingMode !== 'forward') return item.box;

    let tracker = previewTrackers.get(item.id);
    const anchorWindow = Math.max(0.06, frameDuration() * 1.2);
    const atAnchor = Math.abs(now - item.startSeconds) <= anchorWindow;

    if (!tracker && atAnchor) {
      const template = makePreviewTemplate(item.box);
      if (template) {
        tracker = {
          template,
          box: { ...item.box },
          lastTime: now,
          confidence: 1,
          mismatchFrames: 0,
          lost: false,
        };
        previewTrackers.set(item.id, tracker);
      }
    }
    if (!tracker) return atAnchor ? item.box : null;

    if (now < item.startSeconds - anchorWindow || now > item.endSeconds + anchorWindow) {
      return null;
    }

    if (atAnchor) {
      tracker.box = { ...item.box };
      tracker.lastTime = now;
      tracker.confidence = 1;
      tracker.mismatchFrames = 0;
      tracker.lost = false;
      return tracker.box;
    }

    if (tracker.lost) return null;

    const delta = now - tracker.lastTime;
    const jumped = delta < -0.03 || delta > 0.35;
    if (jumped) {
      // Never scan the whole frame after a seek or playback jump. That was
      // the main path that allowed a finished mask to latch onto unrelated text.
      tracker.lost = true;
      return null;
    }

    if (delta > 0.004) {
      const match = searchPreviewBox(item, tracker, now);
      tracker.confidence = match.score;
      tracker.lastTime = now;

      if (match.score >= previewStrongMatch) {
        tracker.box = match.box;
        tracker.mismatchFrames = 0;
      } else {
        if (match.score >= previewWeakMatch) {
          // A weak-but-plausible frame can happen during scrolling/motion blur.
          // Follow it briefly, but require the original visual identity to
          // recover quickly or terminate this occurrence.
          tracker.box = match.box;
        }
        tracker.mismatchFrames += 1;
        if (tracker.mismatchFrames >= previewLostFrameLimit) {
          tracker.lost = true;
          return null;
        }
      }
    }

    return tracker.box;
  }

  function applyPreviewProtection(box) {
    const padding = Math.max(0, Number(byId('padding').value) || 0);
    const x1 = Math.max(0, Math.floor(box.x1 - padding));
    const y1 = Math.max(0, Math.floor(box.y1 - padding));
    const x2 = Math.min(display.width, Math.ceil(box.x2 + padding));
    const y2 = Math.min(display.height, Math.ceil(box.y2 + padding));
    const width = Math.max(1, x2 - x1);
    const height = Math.max(1, y2 - y1);

    context.save();
    context.beginPath();
    context.rect(x1, y1, width, height);
    context.clip();

    if (protectionStyle === 'blackout') {
      context.fillStyle = '#000';
      context.fillRect(x1, y1, width, height);
    } else if (protectionStyle === 'pixelate') {
      const scale = Math.max(3, Math.round(Math.min(width, height) / 8));
      previewScratch.width = Math.max(1, Math.ceil(width / scale));
      previewScratch.height = Math.max(1, Math.ceil(height / scale));
      previewScratchContext.imageSmoothingEnabled = true;
      previewScratchContext.clearRect(
        0,
        0,
        previewScratch.width,
        previewScratch.height,
      );
      previewScratchContext.drawImage(
        source,
        x1,
        y1,
        width,
        height,
        0,
        0,
        previewScratch.width,
        previewScratch.height,
      );
      context.imageSmoothingEnabled = false;
      context.drawImage(
        previewScratch,
        0,
        0,
        previewScratch.width,
        previewScratch.height,
        x1,
        y1,
        width,
        height,
      );
      context.imageSmoothingEnabled = true;
    } else {
      const bleed = Math.max(10, Math.round(Math.min(width, height) * 0.45));
      const sx = Math.max(0, x1 - bleed);
      const sy = Math.max(0, y1 - bleed);
      const sx2 = Math.min(display.width, x2 + bleed);
      const sy2 = Math.min(display.height, y2 + bleed);
      context.filter = 'blur(12px)';
      context.drawImage(
        source,
        sx,
        sy,
        sx2 - sx,
        sy2 - sy,
        sx,
        sy,
        sx2 - sx,
        sy2 - sy,
      );
      context.filter = 'none';
    }
    context.restore();
  }

  function drawFrame() {
    if (!source.videoWidth || !display.width) return;
    try {
      context.drawImage(source, 0, 0, display.width, display.height);
    } catch {
      return;
    }

    const now = source.currentTime;
    for (const item of findings()) {
      if (
        item.box &&
        Math.abs(Number(item.timestamp_seconds) - now) <=
          Math.max(0.05, frameDuration() * 0.75)
      ) {
        drawBox(item.box, '#e34b58', true, false);
      }
    }

    for (const item of corrections) {
      const previewBox = previewBoxFor(item, now);
      if (!previewBox) continue;
      applyPreviewProtection(previewBox);
      drawBox(
        previewBox,
        colors[item.kind] || '#ffcf32',
        false,
        item.id === selectedCorrectionId,
      );
    }

    const draft = draftBox();
    if (draft) drawBox(draft, '#ffcf32', true, false);
    hint.hidden = !sourceFile || busy;
  }

  function canvasPoint(event) {
    const rect = display.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(display.width, ((event.clientX - rect.left) * display.width) / rect.width),
      ),
      y: Math.max(
        0,
        Math.min(display.height, ((event.clientY - rect.top) * display.height) / rect.height),
      ),
    };
  }

  function pointInside(point, box) {
    return (
      point.x >= box.x1 &&
      point.x <= box.x2 &&
      point.y >= box.y1 &&
      point.y <= box.y2
    );
  }

  function correctionAt(point) {
    return corrections
      .slice()
      .reverse()
      .find((item) => {
        const atAnchor =
          Math.abs(source.currentTime - item.startSeconds) <=
          Math.max(0.05, frameDuration() * 0.75);
        const visible =
          item.trackingMode === 'forward'
            ? atAnchor
            : visibleAt(item, source.currentTime);
        return visible && pointInside(point, item.box);
      });
  }

  display.addEventListener('pointerdown', (event) => {
    if (busy || !sourceFile) return;
    const point = canvasPoint(event);
    const selected = selectedCorrection();
    const handleSize = Math.max(18, display.width / 55);

    if (
      selected &&
      Math.hypot(point.x - selected.box.x2, point.y - selected.box.y2) <= handleSize
    ) {
      gesture = { mode: 'resize', item: selected };
    } else {
      const hit = correctionAt(point);
      if (hit) {
        selectedCorrectionId = hit.id;
        gesture = {
          mode: 'move',
          item: hit,
          offsetX: point.x - hit.box.x1,
          offsetY: point.y - hit.box.y1,
        };
      } else {
        selectedCorrectionId = null;
        gesture = {
          mode: 'draw',
          startX: point.x,
          startY: point.y,
          currentX: point.x,
          currentY: point.y,
        };
      }
    }
    display.setPointerCapture(event.pointerId);
    renderCorrections();
    drawFrame();
  });

  display.addEventListener('pointermove', (event) => {
    if (!gesture) return;
    const point = canvasPoint(event);

    if (gesture.mode === 'draw') {
      gesture.currentX = point.x;
      gesture.currentY = point.y;
    } else if (gesture.mode === 'move') {
      const item = gesture.item;
      const width = item.box.x2 - item.box.x1;
      const height = item.box.y2 - item.box.y1;
      const x1 = Math.max(0, Math.min(display.width - width, point.x - gesture.offsetX));
      const y1 = Math.max(0, Math.min(display.height - height, point.y - gesture.offsetY));
      item.box = { x1, y1, x2: x1 + width, y2: y1 + height };
      previewTrackers.delete(item.id);
    } else if (gesture.mode === 'resize') {
      const item = gesture.item;
      item.box.x2 = Math.max(item.box.x1 + 4, Math.min(display.width, point.x));
      item.box.y2 = Math.max(item.box.y1 + 4, Math.min(display.height, point.y));
      previewTrackers.delete(item.id);
    }

    updateSelectionEditor();
    drawFrame();
  });

  function finishGesture(event) {
    if (!gesture) return;
    if (gesture.mode === 'draw') {
      const box = draftBox();
      if (box && box.x2 - box.x1 >= 4 && box.y2 - box.y1 >= 4) {
        const item = {
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
          kind: firstEnabledKind(),
          startSeconds: source.currentTime,
          endSeconds: source.duration || source.currentTime,
          trackingMode: 'forward',
          box,
        };
        corrections.push(item);
        selectedCorrectionId = item.id;
        previewTrackers.delete(item.id);
        setJobStatus(
          'Live mask preview ready',
          'Press Play to preview the blur following this text. Then use Track & mask selected text to render the final protected video.',
          'ok',
        );
      }
    }
    gesture = null;
    if (display.hasPointerCapture(event.pointerId)) {
      display.releasePointerCapture(event.pointerId);
    }
    renderCorrections();
    drawFrame();
  }

  display.addEventListener('pointerup', finishGesture);
  display.addEventListener('pointercancel', finishGesture);

  function firstEnabledKind() {
    return (
      document.querySelector('[data-kind]:checked')?.dataset.kind ||
      'address'
    );
  }

  function currentFrameIndex(seconds = source.currentTime) {
    if (!totalFrames || !source.duration) return 0;
    return Math.max(
      0,
      Math.min(totalFrames - 1, Math.round((seconds / source.duration) * totalFrames)),
    );
  }

  function updateSelectionEditor() {
    const item = selectedCorrection();
    selectionEditor.hidden = !item;
    if (!item) return;

    byId('cx').textContent = Math.round(item.box.x1);
    byId('cy').textContent = Math.round(item.box.y1);
    byId('cw').textContent = Math.round(item.box.x2 - item.box.x1);
    byId('ch').textContent = Math.round(item.box.y2 - item.box.y1);
    startTime.value = item.startSeconds.toFixed(2);
    endTime.value = item.endSeconds.toFixed(2);
    startTime.max = String(source.duration || 0);
    endTime.max = String(source.duration || 0);
    correctionKind.value = item.kind;
    trackingMode.value = item.trackingMode || 'static';
  }

  function renderCorrections() {
    correctionList.replaceChildren();
    correctionCount.textContent = String(corrections.length);
    applyCorrections.disabled =
      busy ||
      corrections.length === 0 ||
      !currentJob ||
      !terminalStatuses.has(currentJob.status);
    updateSelectionEditor();

    for (const item of corrections) {
      const card = document.createElement('div');
      card.className = 'correction';

      const head = document.createElement('div');
      head.className = 'correction-head';
      const title = document.createElement('b');
      title.textContent =
        item.kind === 'owner_name'
          ? 'Owner name'
          : item.kind.charAt(0).toUpperCase() + item.kind.slice(1);
      const frames = document.createElement('span');
      frames.className = 'sub';
      const startFrame = currentFrameIndex(item.startSeconds);
      const endFrame = currentFrameIndex(item.endSeconds);
      frames.textContent = totalFrames
        ? startFrame === endFrame
          ? `Frame ${startFrame + 1}`
          : `Frames ${startFrame + 1}–${endFrame + 1}`
        : `Starts ${formatTime(item.startSeconds)}`;
      head.append(title, frames);

      const detail = document.createElement('p');
      detail.textContent = [
        `${formatTime(item.startSeconds)} to ${formatTime(item.endSeconds)}`,
        item.trackingMode === 'forward' ? 'follows motion forward' : 'fixed position',
      ].join(' · ');

      const actions = document.createElement('div');
      actions.className = 'correction-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn secondary small';
      edit.textContent = item.id === selectedCorrectionId ? 'Selected' : 'Edit box';
      edit.addEventListener('click', () => {
        selectedCorrectionId = item.id;
        source.currentTime =
          item.trackingMode === 'forward'
            ? item.startSeconds
            : (item.startSeconds + item.endSeconds) / 2;
        renderCorrections();
        drawFrame();
      });
      actions.appendChild(edit);
      card.append(head, detail, actions);
      correctionList.appendChild(card);
    }
  }

  function updateSelectedRange() {
    const item = selectedCorrection();
    if (!item) return;
    const start = Math.max(0, Math.min(source.duration, Number(startTime.value) || 0));
    const end = Math.max(0, Math.min(source.duration, Number(endTime.value) || 0));
    item.startSeconds = Math.min(start, end);
    item.endSeconds = Math.max(start, end);
    previewTrackers.delete(item.id);
    renderCorrections();
    drawFrame();
  }

  startTime.addEventListener('change', updateSelectedRange);
  endTime.addEventListener('change', updateSelectedRange);
  correctionKind.addEventListener('change', () => {
    const item = selectedCorrection();
    if (!item) return;
    item.kind = correctionKind.value;
    previewTrackers.delete(item.id);
    renderCorrections();
    drawFrame();
  });
  trackingMode.addEventListener('change', () => {
    const item = selectedCorrection();
    if (!item) return;
    item.trackingMode = trackingMode.value;
    previewTrackers.delete(item.id);
    if (item.trackingMode === 'forward' && item.endSeconds <= item.startSeconds) {
      item.endSeconds = source.duration || item.startSeconds;
    }
    renderCorrections();
    drawFrame();
  });
  removeCorrection.addEventListener('click', () => {
    previewTrackers.delete(selectedCorrectionId);
    corrections = corrections.filter((item) => item.id !== selectedCorrectionId);
    selectedCorrectionId = null;
    renderCorrections();
    drawFrame();
  });

  for (const button of document.querySelectorAll('#styles [data-style]')) {
    button.addEventListener('click', () => {
      protectionStyle = button.dataset.style;
      for (const sibling of document.querySelectorAll('#styles [data-style]')) {
        sibling.classList.toggle('on', sibling === button);
      }
      drawFrame();
    });
  }
  byId('padding').addEventListener('input', () => {
    byId('paddingValue').textContent = `${byId('padding').value} px`;
    drawFrame();
  });
  function detectionSensitivityLabel() {
    const sensitivity = Number(byId('confidence').value);
    if (sensitivity >= 75) return `${sensitivity}% · Maximum recall`;
    if (sensitivity >= 60) return `${sensitivity}% · High recall`;
    if (sensitivity >= 45) return `${sensitivity}% · Balanced`;
    return `${sensitivity}% · Strict`;
  }

  function minimumOcrConfidence() {
    // Higher visible sensitivity should include more uncertain OCR, not less.
    // 25% sensitivity -> 85% OCR confidence; 85% sensitivity -> 25%.
    return Math.max(
      0.25,
      Math.min(0.85, (110 - Number(byId('confidence').value)) / 100),
    );
  }

  byId('confidence').addEventListener('input', () => {
    byId('confidenceValue').textContent = detectionSensitivityLabel();
  });
  byId('confidenceValue').textContent = detectionSensitivityLabel();

  function selectedKinds() {
    return Array.from(document.querySelectorAll('[data-kind]:checked')).map(
      (input) => input.dataset.kind,
    );
  }

  function redactionConfig(manualOnly = false) {
    return {
      pii_kinds: selectedKinds(),
      style: protectionStyle,
      padding_pixels: Number(byId('padding').value),
      minimum_ocr_confidence: minimumOcrConfidence(),
      ocr_every_n_frames: 1,
      max_tracking_gap_frames: 8,
      minimum_tracking_confidence: 0.55,
      scene_cut_threshold: 0.42,
      all_person_names: false,
      manual_only: manualOnly,
      require_independent_verifier: true,
    };
  }

  function setBusy(value) {
    busy = value;
    manualProcess.disabled = value;
    processButton.disabled = value;
    replaceButton.disabled = false;
    replaceButton.textContent = value
      ? 'Cancel & choose another video'
      : 'Choose another video';
    fileInput.disabled = false;
    applyCorrections.disabled =
      value ||
      corrections.length === 0 ||
      !currentJob ||
      !terminalStatuses.has(currentJob.status);
    drawFrame();
  }

  async function cancelCurrentJob() {
    const job = currentJob;
    runVersion += 1;
    if (job && !terminalStatuses.has(job.status)) {
      try {
        const response = await apiFetch(
          `/v1/jobs/${encodeURIComponent(job.id)}/cancel`,
          { method: 'POST' },
        );
        if (response.ok) currentJob = await response.json();
      } catch {
        // Replacing the local video should not be blocked by a cancellation
        // request failure. The worker also has a hard timeout and private data
        // retention policy.
      }
    }
    setBusy(false);
    hideProgress();
  }

  function retryableUploadError(message, retryable = true) {
    const error = new Error(message);
    error.retryable = retryable;
    return error;
  }

  async function startUploadSession(config, deferProcessing = false) {
    let response;
    try {
      response = await apiFetch('/v1/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: sourceFile.name,
          content_type: sourceFile.type || 'application/octet-stream',
          total_bytes: sourceFile.size,
          config,
          defer_processing: deferProcessing,
        }),
      });
    } catch (error) {
      if (error.message === 'Secure session expired') throw error;
      throw new Error('Could not start the resumable private upload');
    }

    if (!response.ok) throw new Error(await readError(response));
    const session = await response.json();
    const expectedParts = Math.ceil(sourceFile.size / Number(session.chunk_size));
    if (
      !session.upload_id ||
      !Number.isInteger(session.chunk_size) ||
      session.chunk_size <= 0 ||
      session.total_parts !== expectedParts
    ) {
      throw new Error('The worker returned an invalid upload session');
    }
    return session;
  }

  function sendUploadPart(session, partNumber, blob, uploadedBefore, version) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(
        'PUT',
        `${apiBaseUrl}/v1/uploads/${encodeURIComponent(
          session.upload_id,
        )}/parts/${partNumber}`,
      );
      request.setRequestHeader('Authorization', `Bearer ${sessionToken}`);
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.responseType = 'json';
      request.timeout = 120000;

      request.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable || version !== runVersion) return;
        const uploaded = Math.min(sourceFile.size, uploadedBefore + event.loaded);
        showProgress(
          2 + (uploaded / sourceFile.size) * 10,
          `Private upload ${Math.round((uploaded / sourceFile.size) * 100)}%`,
        );
      });

      request.addEventListener('load', () => {
        if (request.status === 204) {
          resolve();
          return;
        }
        const message =
          request.response?.detail ||
          request.response?.error ||
          `Upload part failed with status ${request.status}`;
        if (request.status === 401) {
          expireSession('Your secure session expired. Sign in again to continue.');
          reject(retryableUploadError(message, false));
          return;
        }
        reject(retryableUploadError(message, request.status >= 500 || request.status === 0));
      });
      request.addEventListener('error', () => {
        reject(retryableUploadError('The upload connection was interrupted'));
      });
      request.addEventListener('timeout', () => {
        reject(retryableUploadError('The upload connection timed out'));
      });
      request.addEventListener('abort', () => {
        reject(retryableUploadError('The upload was interrupted'));
      });
      request.send(blob);
    });
  }

  async function uploadPartWithRetry(
    session,
    partNumber,
    blob,
    uploadedBefore,
    version,
  ) {
    const retryDelays = [0, 750, 2000, 5000];
    let lastError = null;

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (version !== runVersion) {
        throw retryableUploadError('The upload was replaced by another video', false);
      }
      if (retryDelays[attempt]) await delay(retryDelays[attempt]);
      try {
        await sendUploadPart(session, partNumber, blob, uploadedBefore, version);
        return;
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt === retryDelays.length - 1) throw error;
        const completedPercent = Math.round((uploadedBefore / sourceFile.size) * 100);
        showProgress(
          2 + (uploadedBefore / sourceFile.size) * 10,
          `Connection interrupted at ${completedPercent}%. Retrying safely…`,
        );
      }
    }
    throw lastError || new Error('The resumable upload stopped');
  }

  async function uploadJob(config, version, deferProcessing = false) {
    const session = await startUploadSession(config, deferProcessing);

    for (let partNumber = 0; partNumber < session.total_parts; partNumber += 1) {
      const startByte = partNumber * session.chunk_size;
      const endByte = Math.min(sourceFile.size, startByte + session.chunk_size);
      const blob = sourceFile.slice(startByte, endByte, 'application/octet-stream');
      await uploadPartWithRetry(session, partNumber, blob, startByte, version);
    }

    showProgress(13, 'Validating completed private upload…');
    let response;
    try {
      response = await apiFetch(
        `/v1/uploads/${encodeURIComponent(session.upload_id)}/complete`,
        { method: 'POST' },
      );
    } catch (error) {
      if (error.message === 'Secure session expired') throw error;
      throw new Error(
        'The video finished uploading, but the worker could not validate it. Please try again.',
      );
    }
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  }

  function jobProgress(record) {
    const reported = Number(record.progress || 0) * 100;
    const minimum = {
      queued: 14,
      analyzing: 20,
      redacting: 58,
      verifying: 84,
      needs_review: 100,
      complete: 100,
      failed: 100,
      cancelled: 100,
      ready: 14,
    }[record.status];
    return Math.max(minimum || 14, reported);
  }

  function updateJobProgress(record) {
    const label = statusLabels[record.status] || 'Processing video';
    const currentFrame = Number(record.progress_current);
    const totalFramesForStage = Number(record.progress_total);
    const hasFrameProgress =
      Number.isInteger(currentFrame) &&
      currentFrame >= 0 &&
      Number.isInteger(totalFramesForStage) &&
      totalFramesForStage > 0 &&
      (record.status === 'analyzing' || record.status === 'verifying');
    const frameDetail = hasFrameProgress
      ? `Frame ${Math.min(currentFrame, totalFramesForStage).toLocaleString()} of ${totalFramesForStage.toLocaleString()}`
      : '';
    const percent = Math.round(Number(record.progress || 0) * 100);

    showProgress(
      jobProgress(record),
      frameDetail ? `${label} · ${frameDetail}` : label,
    );
    setJobStatus(
      label,
      record.status === 'queued'
        ? 'The GPU worker may need a moment to start.'
        : frameDetail
        ? `${frameDetail} · ${percent}%`
        : `Job ${record.id.slice(0, 8)} · ${percent}%`,
      record.status === 'failed' || record.status === 'needs_review' ? 'warn' : '',
    );
  }

  const delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function pollJob(jobId, version) {
    let consecutiveFailures = 0;

    while (version === runVersion) {
      try {
        const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}`);
        if (!response.ok) {
          if (response.status >= 500) {
            throw new Error(await readError(response));
          }
          throw retryableUploadError(await readError(response), false);
        }

        currentJob = await response.json();
        consecutiveFailures = 0;
        updateJobProgress(currentJob);

        if (terminalStatuses.has(currentJob.status)) {
          await finishJob(version);
          return;
        }
        await delay(2000);
      } catch (error) {
        if (version !== runVersion) return;
        if (
          error.message === 'Secure session expired' ||
          error.message === 'Redaction worker authentication failed' ||
          error.retryable === false
        ) {
          throw error;
        }

        consecutiveFailures += 1;

        const reconnectDelay = Math.min(
          15_000,
          1000 * 2 ** Math.min(consecutiveFailures - 1, 4),
        );
        const progressPercent = currentJob ? jobProgress(currentJob) : 14;
        showProgress(progressPercent, 'Connection interrupted · reconnecting to worker…');
        setJobStatus(
          'Reconnecting to worker',
          consecutiveFailures <= 3
            ? `The private job is still running. Reconnect attempt ${consecutiveFailures}…`
            : 'The private job is still running. This page will keep reconnecting automatically.',
          'warn',
        );
        await delay(reconnectDelay);
      }
    }
  }

  async function fetchReview() {
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await apiFetch(
          `/v1/jobs/${encodeURIComponent(currentJob.id)}/review`,
        );
        if (!response.ok) throw new Error(await readError(response));
        currentReview = await response.json();
        totalFrames = Number(currentReview?.result?.total_frames || 0);
        renderReview();
        renderCorrections();
        return;
      } catch (error) {
        if (
          error.message === 'Secure session expired' ||
          error.message === 'Redaction worker authentication failed'
        ) {
          throw error;
        }
        lastError = error;
        if (attempt < 4) await delay(Math.min(8000, 1000 * 2 ** attempt));
      }
    }
    throw lastError || new Error('Could not load the verification review');
  }

  function performanceSummary() {
    const metrics = currentReview?.result?.performance;
    if (!metrics) return '';
    const seconds = (value) => {
      const numeric = Number(value || 0);
      if (numeric < 60) return `${numeric.toFixed(1)}s`;
      return `${(numeric / 60).toFixed(1)}m`;
    };
    return [
      `Total ${seconds(metrics.total_seconds)}`,
      `analysis ${seconds(metrics.analysis_seconds)}`,
      `render ${seconds(metrics.render_seconds)}`,
      `verify ${seconds(metrics.verification_seconds)}`,
      `OCR ${Number(metrics.analysis_frames_ocr || 0).toLocaleString()} frames`,
      `reused ${Number(metrics.analysis_frames_reused || 0).toLocaleString()}`,
    ].join(' · ');
  }

  async function loadVerifiedOutput() {
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await apiFetch(
          `/v1/jobs/${encodeURIComponent(currentJob.id)}/download`,
        );
        if (!response.ok) throw new Error(await readError(response));
        const blob = await response.blob();
        resetOutput();
        outputUrl = URL.createObjectURL(blob);
        result.src = outputUrl;
        output.hidden = false;
        const performance = performanceSummary();
        outputMeta.textContent = [
          `${totalFrames.toLocaleString()} verified frames`,
          `${(blob.size / 1024 / 1024).toFixed(1)} MB MP4`,
          performance,
        ].filter(Boolean).join(' · ');
        return;
      } catch (error) {
        if (
          error.message === 'Secure session expired' ||
          error.message === 'Redaction worker authentication failed'
        ) {
          throw error;
        }
        lastError = error;
        if (attempt < 4) await delay(Math.min(8000, 1000 * 2 ** attempt));
      }
    }
    throw lastError || new Error('Could not load the verified output');
  }

  async function finishJob(version) {
    if (version !== runVersion) return;
    await fetchReview();
    setBusy(false);
    hideProgress();

    if (currentJob.status === 'complete') {
      setJobStatus(
        'Independent verification passed',
        performanceSummary() ||
          'The protected MP4 is available below. Review it before publishing.',
        'ok',
      );
      correctionSection.hidden = false;
      await loadVerifiedOutput();
    } else if (currentJob.status === 'needs_review') {
      setJobStatus(
        'Output held for manual review',
        performanceSummary() ||
          'Nothing unsafe was released. Open each flagged frame and add a tight correction.',
        'warn',
      );
      correctionSection.hidden = false;
      output.hidden = true;
    } else if (currentJob.status === 'cancelled') {
      setJobStatus(
        'Processing cancelled',
        'The worker was stopped and no unverified output was released.',
        'warn',
      );
      output.hidden = true;
    } else {
      const detail =
        currentJob.error ||
        'The worker stopped without releasing an unverified video. Try again or inspect the flagged frames.';
      setJobStatus('Processing stopped safely', detail, 'warn');
      correctionSection.hidden = findings().length === 0;
    }
    drawFrame();
  }

  function handleProcessingError(error) {
    setBusy(false);
    hideProgress();
    setJobStatus(
      'Could not finish processing',
      error.message || 'The worker request failed.',
      'warn',
    );
  }

  processButton.addEventListener('click', async () => {
    if (!sourceFile || busy) return;
    if (selectedKinds().length === 0) {
      setJobStatus('Choose at least one private-text type', '', 'warn');
      return;
    }

    resetOutput();
    currentReview = null;
    totalFrames = 0;
    corrections = [];
    selectedCorrectionId = null;
    reviewSection.hidden = true;
    correctionSection.hidden = true;
    renderCorrections();
    const version = ++runVersion;
    setBusy(true);
    showProgress(2, 'Preparing secure upload…');
    setJobStatus('Preparing video', 'The original will upload directly to the private worker.');

    try {
      currentJob = await uploadJob(redactionConfig(false), version);
      if (version !== runVersion) return;
      updateJobProgress(currentJob);
      await pollJob(currentJob.id, version);
    } catch (error) {
      if (version === runVersion) handleProcessingError(error);
    }
  });

  function createFindingCard(item, index) {
    const card = document.createElement('div');
    card.className = 'finding';

    const head = document.createElement('div');
    head.className = 'finding-head';
    const title = document.createElement('b');
    title.textContent = reasonLabels[item.reason] || 'Review finding';
    const at = document.createElement('span');
    at.className = 'sub';
    at.textContent = `Frame ${Number(item.frame_index) + 1}`;
    head.append(title, at);

    const detail = document.createElement('p');
    detail.textContent =
      item.message || `Inspect ${formatTime(Number(item.timestamp_seconds))}`;

    const actions = document.createElement('div');
    actions.className = 'finding-actions';
    const seekButton = document.createElement('button');
    seekButton.type = 'button';
    seekButton.className = 'btn secondary small';
    seekButton.textContent = 'Open frame';
    seekButton.addEventListener('click', () => {
      source.currentTime = Number(item.timestamp_seconds) || 0;
      drawFrame();
    });
    actions.appendChild(seekButton);

    if (item.box) {
      const useButton = document.createElement('button');
      useButton.type = 'button';
      useButton.className = 'btn small';
      useButton.textContent = 'Use exact box';
      useButton.addEventListener('click', () => addFindingCorrection(item, index));
      actions.appendChild(useButton);
    }

    card.append(head, detail, actions);
    return card;
  }

  function renderReview() {
    const items = findings();
    findingCount.textContent = String(items.length);
    reviewList.replaceChildren();
    reviewSection.hidden = items.length === 0;

    items.slice(0, 200).forEach((item, index) => {
      reviewList.appendChild(createFindingCard(item, index));
    });
    if (items.length > 200) {
      const note = document.createElement('p');
      note.className = 'sub';
      note.textContent = `Showing the first 200 of ${items.length} findings.`;
      reviewList.appendChild(note);
    }
  }

  function addFindingCorrection(item, index) {
    const seconds = Number(item.timestamp_seconds) || 0;
    const existing = corrections.find(
      (correction) =>
        correction.findingIndex === index &&
        currentFrameIndex(correction.startSeconds) === Number(item.frame_index),
    );
    if (existing) {
      selectedCorrectionId = existing.id;
    } else {
      const correction = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        findingIndex: index,
        kind: item.kind || firstEnabledKind(),
        startSeconds: seconds,
        endSeconds: source.duration || seconds,
        trackingMode: 'forward',
        box: {
          x1: Number(item.box.x1),
          y1: Number(item.box.y1),
          x2: Number(item.box.x2),
          y2: Number(item.box.y2),
        },
      };
      corrections.push(correction);
      selectedCorrectionId = correction.id;
    }
    source.currentTime = seconds;
    renderCorrections();
    drawFrame();
  }

  function timedCorrectionPayload() {
    return corrections.map((item) => ({
      start_seconds: Math.max(0, Number(item.startSeconds) || 0),
      end_seconds: Math.max(
        Number(item.startSeconds) || 0,
        Number(item.endSeconds) || 0,
      ),
      kind: item.kind,
      text: 'manual tracked mask',
      tracking_mode: item.trackingMode || 'forward',
      box: {
        x1: item.box.x1,
        y1: item.box.y1,
        x2: item.box.x2,
        y2: item.box.y2,
      },
    }));
  }

  manualProcess.addEventListener('click', async () => {
    if (!sourceFile || busy) return;
    if (corrections.length === 0) {
      setJobStatus(
        'Draw at least one mask',
        'Pause on the text, then drag a tight box around it.',
        'warn',
      );
      return;
    }

    resetOutput();
    currentReview = null;
    totalFrames = 0;
    reviewSection.hidden = true;
    const version = ++runVersion;
    setBusy(true);
    showProgress(2, 'Preparing manual tracking…');
    setJobStatus(
      'Preparing tracked masks',
      'The worker will follow each selected region from its anchor frame forward.',
    );

    try {
      currentJob = await uploadJob(redactionConfig(true), version, true);
      if (version !== runVersion) return;
      if (currentJob.status !== 'ready') {
        throw new Error('The private worker did not pause for manual masks');
      }

      showProgress(14, 'Starting motion tracking…');
      const response = await apiFetch(
        `/v1/jobs/${encodeURIComponent(currentJob.id)}/timed-corrections`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections: timedCorrectionPayload() }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      currentJob = await response.json();
      updateJobProgress(currentJob);
      await pollJob(currentJob.id, version);
    } catch (error) {
      if (version === runVersion) handleProcessingError(error);
    }
  });

  function correctionPayload() {
    if (!totalFrames || !source.duration) {
      throw new Error('Frame timing is unavailable for corrections');
    }
    return corrections.map((item) => {
      let startFrame = currentFrameIndex(item.startSeconds);
      let endFrame = currentFrameIndex(item.endSeconds);
      if (endFrame < startFrame) [startFrame, endFrame] = [endFrame, startFrame];
      return {
        start_frame: startFrame,
        end_frame: endFrame,
        kind: item.kind,
        text: 'manual correction',
        tracking_mode: item.trackingMode || 'static',
        box: {
          x1: item.box.x1,
          y1: item.box.y1,
          x2: item.box.x2,
          y2: item.box.y2,
        },
      };
    });
  }

  applyCorrections.addEventListener('click', async () => {
    if (!currentJob || corrections.length === 0 || busy) return;
    const version = ++runVersion;
    setBusy(true);
    resetOutput();
    showProgress(4, 'Sending exact frame corrections…');

    try {
      const response = await apiFetch(
        `/v1/jobs/${encodeURIComponent(currentJob.id)}/corrections`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections: correctionPayload() }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      currentJob = await response.json();
      updateJobProgress(currentJob);
      await pollJob(currentJob.id, version);
    } catch (error) {
      if (version === runVersion) handleProcessingError(error);
    }
  });

  download.addEventListener('click', () => {
    if (!outputUrl) return;
    const link = document.createElement('a');
    const baseName = (sourceFile?.name || 'video').replace(/\.[^.]+$/, '');
    link.href = outputUrl;
    link.download = `${baseName}-redacted.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  window.addEventListener('beforeunload', () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  });

  setInterval(() => {
    if (sessionToken && Date.now() >= sessionExpiresAt) {
      expireSession('Your secure session expired. Sign in again to continue.');
    }
  }, 30_000);

  renderCorrections();
})();
