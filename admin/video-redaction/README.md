# Labradoor Video Redaction Admin

Private-beta, browser-based editor for automatically detecting and protecting sensitive text in moving screen videos.

## Current workflow

1. Choose a local MP4, MOV, or WebM file.
2. Select addresses, owner names, phone numbers, and/or email addresses.
3. Scan the current frame or the full video.
4. Review the tight word-level masks.
5. Click and drag a box to move it, drag its yellow corner to resize it, toggle a detected item, or draw an additional manual box.
6. Choose blackout, pixelation, or heavy blur and set tight safety padding.
7. Protect, review, and download the finished video.

The OCR engine runs locally in the browser. A full-video scan creates word-level OCR anchors every 0.75 seconds. Before export, a first playback pass measures vertical screen movement on every decoded frame. A second playback pass projects each tight OCR box through that measured motion path and corrects it against the surrounding OCR anchors. Failed OCR samples, unresolved motion, large frame gaps, saturated motion searches, or materially disagreeing anchors cause the affected frame to be fully blacked out. Videos, OCR inputs, and output blobs are not uploaded by the page.

## Detection rules

- Email addresses use a structured email pattern.
- Phone numbers support common US formatting and an optional country code.
- Street addresses require a street number and recognized street suffix.
- Owner names are detected only in the context of labels such as Owner, Homeowner, Property Owner, Owner Name, or Owner Information.
- Category controls and individual detections can be disabled by the editor.
- Masks use the OCR word bounding box plus user-controlled padding, rather than a card-sized region.

## Private-beta constraints

- OCR anchors are sampled, so the browser beta cannot prove it found PII that appears only between anchors. Per-frame motion tracking keeps detected text covered but cannot protect text that OCR never detected.
- OCR can miss stylized, animated, obstructed, low-contrast, or motion-blurred text.
- Owner-name detection depends on an owner label or known UI context.
- Browser export uses the best MediaRecorder format available, typically WebM in Chrome. Server-side FFmpeg is required for consistent MP4 output.
- Audio is retained only when the browser exposes a source audio track through captureStream.
- The route is excluded from search engines, but the current static site does not provide route-level authentication.
- A human must review every finished video before publishing.

## Production engine boundary

The production version should use an authenticated server-side worker for frame-accurate FFmpeg decoding and encoding, GPU OCR on every relevant frame, optical-flow or feature tracking between detections, periodic re-detection, encrypted temporary storage, automatic deletion, and an independent verification pass. The current editor is designed to remain the control surface for that worker.

## Acceptance tests

- Each supported PII type alone and all four types together.
- Addresses containing apartment, suite, unit, and directional suffixes.
- Phone numbers with parentheses, spaces, dots, dashes, and +1.
- Owner labels above, beside, and on the same line as the name.
- Constant, accelerating, decelerating, and abruptly reversing vertical scrolling.
- PII entering, leaving, and re-entering the frame.
- Motion blur, compression, low contrast, rotation, scale changes, and scene cuts.
- Manual move, resize, add, remove, and category toggle behavior.
- Failed OCR, unresolved motion, dropped-frame gaps, and disagreeing anchors are fully blacked out.
- Export duration and audio alignment match the source.
- Output is manually inspected frame by frame before publication.
