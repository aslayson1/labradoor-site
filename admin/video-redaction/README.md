# Labradoor Video Redaction Admin

Private-beta browser implementation for selecting and protecting a sensitive region in a moving screen video.

## Current workflow

1. Choose a local MP4, MOV, or WebM file.
2. Scrub to a clear frame and draw a box around the sensitive information.
3. Choose blackout, pixelation, or heavy blur and set safety padding.
4. Run Track & Protect.
5. Review the exported video and confidence report before publishing.

The browser tracks vertical motion by comparing a grayscale sample of the selected region against candidate positions in every decoded frame. A frame below the configured confidence threshold is fully blacked out. Fail-closed behavior cannot be disabled. Videos and output blobs remain in the browser and are not uploaded by this page.

## Private-beta constraints

- The tracker is optimized for vertical screen movement. Rotation, perspective changes, cuts, horizontal movement, occlusion, and major scale changes can cause full-frame fallbacks.
- Export uses the best MediaRecorder format supported by the browser, typically WebM in Chrome. MP4 requires a server-side FFmpeg worker or a browser with MP4 MediaRecorder support.
- Audio is preserved when the browser exposes an audio track through captureStream.
- The route is excluded from search engines, but the current static site does not provide route-level authentication.
- A human must review every finished video before publishing.

## Production engine boundary

The production version should send an authenticated job to a separate worker that performs frame-accurate FFmpeg decode/encode, segmentation or feature tracking, periodic re-detection, encrypted object storage, automatic deletion, and an independent verification pass. The UI can remain the control surface for that service.

## Acceptance tests

- Constant vertical scrolling with the selected field remaining visible.
- Rapid vertical movement beyond the normal search window.
- Field leaving and re-entering the frame.
- Motion blur and compression artifacts.
- Resolution and orientation changes.
- Scene cuts.
- Low-confidence frames are fully black, never passed through.
- Export duration and audio alignment match the source.
- Output is manually inspected frame by frame before publication.
