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
  const terminalStatuses = new Set(['complete', 'needs_review', 'failed']);
  const statusLabels = {
    queued: 'Worker starting',
    analyzing: 'Detecting private text frame by frame',
    redacting: 'Rendering tight protection masks',
    verifying: 'Running independent verification',
    needs_review: 'Manual review required',
    complete: 'Independent verification passed',
    failed: 'Processing stopped',
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
    processButton.disabled = false;
    replaceButton.disabled = false;
    jobStatus.hidden = true;
    reviewSection.hidden = true;
    correctionSection.hidden = true;
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
        processButton.disabled = true;
      }

      display.width = source.videoWidth;
      display.height = source.videoHeight;
      upload.hidden = true;
      workspace.hidden = false;
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
  replaceButton.addEventListener('click', () => fileInput.click());
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
      if (visibleAt(item, now) || item.id === selectedCorrectionId) {
        drawBox(
          item.box,
          colors[item.kind] || '#ffcf32',
          false,
          item.id === selectedCorrectionId,
        );
      }
    }

    const draft = draftBox();
    if (draft) drawBox(draft, '#ffcf32', true, false);
    hint.hidden = !currentJob || busy || !terminalStatuses.has(currentJob.status);
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
      .find((item) => visibleAt(item, source.currentTime) && pointInside(point, item.box));
  }

  display.addEventListener('pointerdown', (event) => {
    if (busy || !currentJob || !terminalStatuses.has(currentJob.status)) return;
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
    } else if (gesture.mode === 'resize') {
      const item = gesture.item;
      item.box.x2 = Math.max(item.box.x1 + 4, Math.min(display.width, point.x));
      item.box.y2 = Math.max(item.box.y1 + 4, Math.min(display.height, point.y));
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
          endSeconds: source.currentTime,
          box,
        };
        corrections.push(item);
        selectedCorrectionId = item.id;
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
  }

  function renderCorrections() {
    correctionList.replaceChildren();
    correctionCount.textContent = String(corrections.length);
    applyCorrections.disabled = busy || corrections.length === 0;
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
      frames.textContent =
        startFrame === endFrame
          ? `Frame ${startFrame + 1}`
          : `Frames ${startFrame + 1}–${endFrame + 1}`;
      head.append(title, frames);

      const detail = document.createElement('p');
      detail.textContent = `${formatTime(item.startSeconds)} to ${formatTime(
        item.endSeconds,
      )}`;

      const actions = document.createElement('div');
      actions.className = 'correction-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn secondary small';
      edit.textContent = item.id === selectedCorrectionId ? 'Selected' : 'Edit box';
      edit.addEventListener('click', () => {
        selectedCorrectionId = item.id;
        source.currentTime = (item.startSeconds + item.endSeconds) / 2;
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
    renderCorrections();
    drawFrame();
  }

  startTime.addEventListener('change', updateSelectedRange);
  endTime.addEventListener('change', updateSelectedRange);
  correctionKind.addEventListener('change', () => {
    const item = selectedCorrection();
    if (!item) return;
    item.kind = correctionKind.value;
    renderCorrections();
    drawFrame();
  });
  removeCorrection.addEventListener('click', () => {
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
    });
  }
  byId('padding').addEventListener('input', () => {
    byId('paddingValue').textContent = `${byId('padding').value} px`;
  });
  byId('confidence').addEventListener('input', () => {
    byId('confidenceValue').textContent = `${byId('confidence').value}%`;
  });

  function selectedKinds() {
    return Array.from(document.querySelectorAll('[data-kind]:checked')).map(
      (input) => input.dataset.kind,
    );
  }

  function redactionConfig() {
    return {
      pii_kinds: selectedKinds(),
      style: protectionStyle,
      padding_pixels: Number(byId('padding').value),
      minimum_ocr_confidence: Number(byId('confidence').value) / 100,
      ocr_every_n_frames: 1,
      max_tracking_gap_frames: 8,
      minimum_tracking_confidence: 0.55,
      scene_cut_threshold: 0.42,
      all_person_names: false,
      require_independent_verifier: true,
    };
  }

  function setBusy(value) {
    busy = value;
    processButton.disabled = value;
    replaceButton.disabled = value;
    fileInput.disabled = value;
    applyCorrections.disabled = value || corrections.length === 0;
    drawFrame();
  }

  function retryableUploadError(message, retryable = true) {
    const error = new Error(message);
    error.retryable = retryable;
    return error;
  }

  async function startUploadSession(config) {
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

  async function uploadJob(config, version) {
    const session = await startUploadSession(config);

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
    }[record.status];
    return Math.max(minimum || 14, reported);
  }

  function updateJobProgress(record) {
    const label = statusLabels[record.status] || 'Processing video';
    showProgress(jobProgress(record), label);
    setJobStatus(
      label,
      record.status === 'queued'
        ? 'The GPU worker may need a moment to start.'
        : `Job ${record.id.slice(0, 8)} · ${Math.round(Number(record.progress || 0) * 100)}%`,
      record.status === 'failed' || record.status === 'needs_review' ? 'warn' : '',
    );
  }

  const delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function pollJob(jobId, version) {
    while (version === runVersion) {
      const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}`);
      if (!response.ok) throw new Error(await readError(response));
      currentJob = await response.json();
      updateJobProgress(currentJob);

      if (terminalStatuses.has(currentJob.status)) {
        await finishJob(version);
        return;
      }
      await delay(2000);
    }
  }

  async function fetchReview() {
    const response = await apiFetch(
      `/v1/jobs/${encodeURIComponent(currentJob.id)}/review`,
    );
    if (!response.ok) throw new Error(await readError(response));
    currentReview = await response.json();
    totalFrames = Number(currentReview?.result?.total_frames || 0);
    renderReview();
    renderCorrections();
  }

  async function loadVerifiedOutput() {
    const response = await apiFetch(
      `/v1/jobs/${encodeURIComponent(currentJob.id)}/download`,
    );
    if (!response.ok) throw new Error(await readError(response));
    const blob = await response.blob();
    resetOutput();
    outputUrl = URL.createObjectURL(blob);
    result.src = outputUrl;
    output.hidden = false;
    outputMeta.textContent = `${totalFrames.toLocaleString()} verified frames · ${(
      blob.size /
      1024 /
      1024
    ).toFixed(1)} MB MP4`;
  }

  async function finishJob(version) {
    if (version !== runVersion) return;
    await fetchReview();
    setBusy(false);
    hideProgress();

    if (currentJob.status === 'complete') {
      setJobStatus(
        'Independent verification passed',
        'The protected MP4 is available below. Review it before publishing.',
        'ok',
      );
      correctionSection.hidden = false;
      await loadVerifiedOutput();
    } else if (currentJob.status === 'needs_review') {
      setJobStatus(
        'Output held for manual review',
        'Nothing unsafe was released. Open each flagged frame and add a tight correction.',
        'warn',
      );
      correctionSection.hidden = false;
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
      currentJob = await uploadJob(redactionConfig(), version);
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
        endSeconds: seconds,
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
