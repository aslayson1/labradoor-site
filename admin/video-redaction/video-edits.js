(() => {
  'use strict';

  function orderedSegments(segments) {
    return (segments || []).slice().sort((a, b) => a.start - b.start);
  }

  function segmentAt(segments, time, epsilon = 0) {
    return (
      orderedSegments(segments).find(
        (segment) =>
          time >= segment.start - epsilon && time < segment.end - epsilon,
      ) || null
    );
  }

  function nextSegment(segments, time, epsilon = 0) {
    return (
      orderedSegments(segments).find(
        (segment) => segment.start > time + epsilon,
      ) || null
    );
  }

  function playbackDecision({
    segments,
    time,
    epsilon = 0,
    paused = false,
    seeking = false,
    pendingSeek = false,
  }) {
    if (paused || !segments || segments.length === 0) {
      return { type: 'none' };
    }

    if (pendingSeek || seeking) {
      return { type: 'hold' };
    }

    const active = segmentAt(segments, time, epsilon);
    if (active) {
      return { type: 'keep', segment: active };
    }

    const next = nextSegment(segments, time, epsilon);
    if (next) {
      return { type: 'jump', segment: next, target: next.start };
    }

    return { type: 'stop' };
  }

  const api = {
    orderedSegments,
    segmentAt,
    nextSegment,
    playbackDecision,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.LabradoorVideoEdits = api;
  }
})();
