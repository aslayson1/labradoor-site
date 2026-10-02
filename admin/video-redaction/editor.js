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
  const ManualTracker = window.LabradoorManualTracker;
  if (!ManualTracker) {
    throw new Error('Manual tracking engine failed to load');
  }

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
    outside_selection: 'Optional unselected text',
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
  let activeProcessingMode = '';
  let runVersion = 0;
  let animationFrame = 0;
  let animationFrameKind = '';
  let lastTrackingFrame = null;
  let trackingScale = 1;
  const previewTrackers = new Map();
  const trackingCanvas = document.createElement('canvas');
  const trackingContext = trackingCanvas.getContext('2d', { willReadFrequently: true });
  const previewScratch = document.createElement('canvas');
  const previewScratchContext = previewScratch.getContext('2d');
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
    activeProcessingMode = '';
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

  function cancelSourceAnimation() {
    if (!animationFrame) return;
    if (
      animationFrameKind === 'video' &&
      typeof source.cancelVideoFrameCallback === 'function'
    ) {
      source.cancelVideoFrameCallback(animationFrame);
    } else {
      cancelAnimationFrame(animationFrame);
    }
    animationFrame = 0;
    animationFrameKind = '';
  }

  function scheduleSourceFrame(tick) {
    if (typeof source.requestVideoFrameCallback === 'function') {
      animationFrameKind = 'video';
      animationFrame = source.requestVideoFrameCallback(tick);
    } else {
      animationFrameKind = 'raf';
      animationFrame = requestAnimationFrame(tick);
    }
  }

  function animateSource() {
    cancelSourceAnimation();

    const tick = (_timestamp, metadata) => {
      updateTime();
      const mediaTime = Number(metadata?.mediaTime);
      drawFrame(Number.isFinite(mediaTime) ? mediaTime : source.currentTime);
      if (!source.paused && !source.ended) {
        scheduleSourceFrame(tick);
      }
    };

    // Draw the current paused/starting frame immediately. Once playback is
    // moving, advance tracking only when the browser presents a new video
    // frame rather than on every display refresh.
    updateTime();
    drawFrame(source.currentTime);
    if (!source.paused && !source.ended) {
      scheduleSourceFrame(tick);
    }
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
  source.addEventListener('seeking', () => {
    for (const tracker of previewTrackers.values()) tracker.seeked = true;
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

  function toTrackingBox(box) {
    return {
      x1: box.x1 * trackingScale,
      y1: box.y1 * trackingScale,
      x2: box.x2 * trackingScale,
      y2: box.y2 * trackingScale,
    };
  }

  function fromTrackingBox(box) {
    const scale = Math.max(0.0001, trackingScale);
    return {
      x1: box.x1 / scale,
      y1: box.y1 / scale,
      x2: box.x2 / scale,
      y2: box.y2 / scale,
    };
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

  function makeAnchorTemplate(box) {
    return lastTrackingFrame
      ? ManualTracker.makeTemplate(lastTrackingFrame, toTrackingBox(box), {
          paddingRatio: 0.08,
          cols: 19,
          rows: 11,
        })
      : null;
  }

  function makeRecentTemplate(box) {
    return lastTrackingFrame
      ? ManualTracker.makeTemplate(lastTrackingFrame, toTrackingBox(box), {
          paddingRatio: 0.20,
          cols: 17,
          rows: 11,
        })
      : null;
  }

  function searchPreviewBox(item, tracker, now) {
    if (!lastTrackingFrame) {
      return {
        box: tracker.box,
        strong: false,
        recentScore: 0,
        anchorScore: 0,
        score: 0,
      };
    }

    const delta = Math.max(1 / 120, now - tracker.lastTime);
    const motionScale =
      tracker.lastDelta && tracker.lastDelta > 0
        ? Math.max(0.45, Math.min(2.2, delta / tracker.lastDelta))
        : 1;
    const expectedMotion = tracker.hasMotion
      ? {
          dx: tracker.motionX * motionScale,
          dy: tracker.motionY * motionScale,
        }
      : { dx: 0, dy: 0 };

    const match = ManualTracker.findBestMatch(
      lastTrackingFrame,
      toTrackingBox(tracker.box),
      tracker.recentTemplate,
      tracker.anchorTemplate,
      {
        occupied: otherTrackedBoxes(item.id, now).map(toTrackingBox),
        expectedMotion: {
          dx: expectedMotion.dx * trackingScale,
          dy: expectedMotion.dy * trackingScale,
        },
        elapsedSeconds: delta,
        minimumAnchorCorrelation: 0.82,
      },
    );
    return {
      ...match,
      box: fromTrackingBox(match.box),
      predicted: fromTrackingBox(match.predicted),
      movement: match.movement / Math.max(0.0001, trackingScale),
    };
  }

  function resetPreviewTracker(item, now) {
    const anchorTemplate = makeAnchorTemplate(item.box);
    const recentTemplate = makeRecentTemplate(item.box);
    if (!anchorTemplate || !recentTemplate) return null;

    const tracker = {
      anchorTemplate,
      recentTemplate,
      box: { ...item.box },
      lastTime: now,
      lastDelta: 0,
      confidence: 1,
      mismatchFrames: 0,
      lost: false,
      hasMotion: false,
      motionX: 0,
      motionY: 0,
    };
    previewTrackers.set(item.id, tracker);
    return tracker;
  }

  function losePreviewTracker(item, tracker, now, reason) {
    tracker.lost = true;
    setJobStatus(
      'Mask tracking needs review',
      `${item.kind === 'owner_name' ? 'Owner name' : item.kind || 'Selected'} mask stopped at ${formatTime(now)}. ${reason} Pause on the text and draw a new anchor; review this point before rendering.`,
      'warn',
    );
  }

  function previewBoxFor(item, now) {
    if (!visibleAt(item, now)) return null;
    if (item.trackingMode !== 'forward') return item.box;

    let tracker = previewTrackers.get(item.id);
    const anchorWindow = Math.max(0.012, frameDuration() * 0.48);
    const atAnchor = Math.abs(now - item.startSeconds) <= anchorWindow;

    if (!tracker && atAnchor) {
      tracker = resetPreviewTracker(item, now);
    }
    if (!tracker) return atAnchor ? item.box : null;

    if (
      now < item.startSeconds - anchorWindow ||
      now > item.endSeconds + anchorWindow
    ) {
      return null;
    }

    if (atAnchor || (source.paused && Math.abs(source.currentTime - item.startSeconds) <= 0.12)) {
      // A newly hand-drawn mask must remain exactly where the user placed it
      // until playback actually advances. A queued video-frame callback can
      // arrive after pause/mouse-up with a slightly newer mediaTime; never let
      // that stale callback move the anchor before the user presses Play.
      if (
        now < tracker.lastTime - 0.02 ||
        (source.paused && Math.abs(source.currentTime - item.startSeconds) <= 0.12)
      ) {
        tracker = resetPreviewTracker(item, source.currentTime) || tracker;
        tracker.box = { ...item.box };
      }
      return item.box;
    }

    if (tracker.lost) return null;

    const delta = now - tracker.lastTime;
    // A delayed presented-frame callback during normal playback is not a seek.
    // The exact identity search can safely reconnect across skipped callbacks;
    // only an actual timeline seek invalidates that continuity.
    const seeked = tracker.seeked;
    tracker.seeked = false;
    const jumped = delta < -0.02 || (seeked && delta > 0.35);
    if (jumped) {
      // A seek has no reliable previous-frame motion. Do not guess or scan
      // broadly for a lookalike elsewhere on screen.
      losePreviewTracker(item, tracker, now, 'The timeline jumped beyond the tracked frames.');
      return null;
    }

    if (delta > 0.004) {
      const previousBox = tracker.box;
      const match = searchPreviewBox(item, tracker, now);
      tracker.confidence = match.score;
      tracker.lastTime = now;

      if (match.exitedFrame) {
        losePreviewTracker(item, tracker, now, 'The selected region left the frame.');
        return null;
      }

      if (match.exitingFrame) {
        const dx = match.box.x1 - previousBox.x1;
        const dy = match.box.y1 - previousBox.y1;
        tracker.box = { ...match.box };
        tracker.motionX = dx;
        tracker.motionY = dy;
        tracker.hasMotion = true;
        tracker.lastDelta = delta;
        tracker.mismatchFrames = 0;
        return tracker.box;
      }

      if (match.strong) {
        const dx = match.box.x1 - previousBox.x1;
        const dy = match.box.y1 - previousBox.y1;

        if (Math.hypot(dx, dy) >= 0.75) {
          if (!tracker.hasMotion) {
            tracker.motionX = dx;
            tracker.motionY = dy;
            tracker.hasMotion = true;
          } else {
            tracker.motionX = tracker.motionX * 0.55 + dx * 0.45;
            tracker.motionY = tracker.motionY * 0.55 + dy * 0.45;
          }
          tracker.lastDelta = delta;
        }

        tracker.box = ManualTracker.clampBox(
          match.box,
          display.width,
          display.height,
        );
        tracker.recentTemplate =
          makeRecentTemplate(tracker.box) || tracker.recentTemplate;
        tracker.mismatchFrames = 0;
      } else {
        // Never move on an uncertain match. Keep the last confirmed box for
        // a couple of presented video frames, then end this occurrence rather
        // than drifting onto a button, neighboring row, or repeated text.
        tracker.mismatchFrames += 1;
        if (tracker.mismatchFrames >= previewLostFrameLimit) {
          losePreviewTracker(item, tracker, now, 'The selected region could no longer be matched confidently.');
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

  function drawFrame(frameTime = source.currentTime) {
    if (!source.videoWidth || !display.width) return;
    try {
      const maxTrackingDimension = 1280;
      const nextTrackingScale = Math.min(
        1,
        maxTrackingDimension / Math.max(display.width, display.height),
      );
      const trackingWidth = Math.max(
        1,
        Math.round(display.width * nextTrackingScale),
      );
      const trackingHeight = Math.max(
        1,
        Math.round(display.height * nextTrackingScale),
      );
      if (
        trackingCanvas.width !== trackingWidth ||
        trackingCanvas.height !== trackingHeight
      ) {
        trackingCanvas.width = trackingWidth;
        trackingCanvas.height = trackingHeight;
        previewTrackers.clear();
      }
      trackingScale = trackingCanvas.width / display.width;
      trackingContext.drawImage(
        source,
        0,
        0,
        trackingCanvas.width,
        trackingCanvas.height,
      );
      lastTrackingFrame = trackingContext.getImageData(
        0,
        0,
        trackingCanvas.width,
        trackingCanvas.height,
      );
      context.drawImage(source, 0, 0, display.width, display.height);
    } catch {
      lastTrackingFrame = null;
      return;
    }

    const now = Number.isFinite(frameTime) ? frameTime : source.currentTime;
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
        if (item.trackingMode !== 'forward') {
          return visibleAt(item, source.currentTime) && pointInside(point, item.box);
        }
        if (atAnchor && pointInside(point, item.box)) return true;
        const tracker = previewTrackers.get(item.id);
        return Boolean(
          tracker &&
            !tracker.lost &&
            visibleAt(item, source.currentTime) &&
            pointInside(point, tracker.box),
        );
      });
  }

  function beginMaskEdit() {
    if (!gesture || gesture.started || gesture.mode === 'draw') return;
    const item = gesture.item;
    const now = gesture.atTime;
    // A tracked mask's original anchor belongs to earlier frames. Editing
    // its current location makes a new anchor from this frame onward.
    if (
      item.trackingMode === 'forward' &&
      now > item.startSeconds + frameDuration() * 1.5 &&
      now <= item.endSeconds
    ) {
      const continuation = {
        ...item,
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        startSeconds: now,
        box: { ...gesture.displayBox },
      };
      item.endSeconds = Math.max(item.startSeconds, now - frameDuration());
      corrections.splice(corrections.indexOf(item) + 1, 0, continuation);
      gesture.item = continuation;
      selectedCorrectionId = continuation.id;
      previewTrackers.delete(item.id);
    }
    gesture.started = true;
    previewTrackers.delete(gesture.item.id);
    renderCorrections();
  }

  display.addEventListener('pointerdown', (event) => {
    if (busy || !sourceFile) return;
    source.pause();
    drawFrame();
    const point = canvasPoint(event);
    const selected = selectedCorrection();
    const selectedBox = selected && visibleAt(selected, source.currentTime)
      ? previewBoxFor(selected, source.currentTime)
      : null;
    const handleSize = Math.max(18, display.width / 55);

    if (
      selected && selectedBox &&
      Math.hypot(point.x - selectedBox.x2, point.y - selectedBox.y2) <= handleSize
    ) {
      gesture = {
        mode: 'resize',
        item: selected,
        displayBox: { ...selectedBox },
        atTime: source.currentTime,
      };
    } else {
      const hit = correctionAt(point);
      if (hit) {
        const box = previewBoxFor(hit, source.currentTime) || hit.box;
        selectedCorrectionId = hit.id;
        gesture = {
          mode: 'move',
          item: hit,
          displayBox: { ...box },
          atTime: source.currentTime,
          offsetX: point.x - box.x1,
          offsetY: point.y - box.y1,
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
    } else {
      const box = gesture.displayBox;
      const movement = gesture.mode === 'move'
        ? Math.hypot(
          point.x - gesture.offsetX - box.x1,
          point.y - gesture.offsetY - box.y1,
        )
        : Math.hypot(point.x - box.x2, point.y - box.y2);
      if (!gesture.started && movement >= 2) beginMaskEdit();
      if (!gesture.started) return;

      const item = gesture.item;
      if (gesture.mode === 'move') {
        const width = box.x2 - box.x1;
        const height = box.y2 - box.y1;
        const x1 = Math.max(0, Math.min(display.width - width, point.x - gesture.offsetX));
        const y1 = Math.max(0, Math.min(display.height - height, point.y - gesture.offsetY));
        item.box = { x1, y1, x2: x1 + width, y2: y1 + height };
      } else {
        item.box = {
          ...item.box,
          x2: Math.max(item.box.x1 + 4, Math.min(display.width, point.x)),
          y2: Math.max(item.box.y1 + 4, Math.min(display.height, point.y)),
        };
      }
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
        // Capture the exact hand-drawn region as the anchor immediately.
        // This prevents the first preview redraw from searching and jumping
        // to another nearby UI feature before playback has advanced.
        resetPreviewTracker(item, source.currentTime);
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
      // A paused video presents the frame whose timestamp is at or before
      // currentTime. Rounding selects the next frame during fast motion and
      // anchors export to different pixels than the hand-drawn preview.
      Math.min(totalFrames - 1, Math.floor((seconds / source.duration) * totalFrames + 1e-6)),
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
        source.pause();
        previewTrackers.delete(item.id);
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
  endCorrectionHere.addEventListener('click', () => {
    const item = selectedCorrection();
    if (!item || !Number.isFinite(source.currentTime)) return;
    const stopBefore = Math.max(
      item.startSeconds,
      source.currentTime - Math.max(frameDuration(), 0.01),
    );
    if (stopBefore <= item.startSeconds + 0.001) {
      setJobStatus(
        'Move later in the video',
        'The playhead needs to be after the mask starts before it can be ended.',
        'warn',
      );
      return;
    }
    item.endSeconds = Math.min(item.endSeconds, stopBefore);
    previewTrackers.delete(item.id);
    setJobStatus(
      'Mask ended at this point',
      'Earlier frames keep this mask. This frame and later frames will no longer use it.',
      'ok',
    );
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
    const manualLabels = {
      queued: 'Preparing manual render',
      analyzing: 'Following selected masks',
      redacting: 'Rendering manual masks',
      verifying: 'Verifying masked video',
      needs_review: 'Manual review required',
      complete: 'Manual masking verified',
      failed: 'Processing stopped',
      cancelled: 'Processing cancelled',
    };
    const labels =
      activeProcessingMode === 'manual' ? manualLabels : statusLabels;
    const label = labels[record.status] || 'Processing video';
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
        ? activeProcessingMode === 'manual'
          ? 'Automatic detection is off. The private worker is only preparing the final manual render.'
          : 'The GPU worker may need a moment to start.'
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
        const manual = currentJob?.config?.manual_only || activeProcessingMode === 'manual';
        const title = byId('outputTitle') || output.querySelector('strong');
        if (title) title.textContent = manual ? 'Selected masks verified' : 'Verified protected video';
        const performance = performanceSummary();
        outputMeta.textContent = [
          `${totalFrames.toLocaleString()} checked frames`,
          manual ? 'Only your selections are masked' : '',
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
        currentJob?.config?.manual_only ? 'Selected masks verified' : 'Independent verification passed',
        [currentJob?.config?.manual_only ? 'Only your selections are masked. Other text may remain visible.' : '',
          performanceSummary()].filter(Boolean).join(' · ') ||
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
    activeProcessingMode = 'automatic';
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
    const title = byId('reviewTitle') || reviewSection.querySelector('.label span');
    if (title) title.textContent = items.length && items.every((item) => item.reason === 'outside_selection')
      ? 'Optional unselected text' : 'Frames needing attention';
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
    activeProcessingMode = 'manual';
    setBusy(true);
    showProgress(2, 'Preparing manual render…');
    setJobStatus(
      'Preparing manual masks',
      'Automatic detection is off. The browser previews tracking; the private worker renders and verifies the masks you selected.',
    );

    try {
      currentJob = await uploadJob(redactionConfig(true), version, true);
      if (version !== runVersion) return;
      if (currentJob.status !== 'ready') {
        throw new Error('The private worker did not pause for manual masks');
      }

      showProgress(14, 'Applying manual mask tracking…');
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
    activeProcessingMode = 'manual';
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
