# Labradoor Video Redaction Admin

Private admin editor for automatic, frame-accurate video PII redaction.

## Workflow

1. Sign in with the redaction admin password.
2. Choose a local MP4, MOV, or WebM file.
3. Select addresses, owner names, phone numbers, and/or email addresses.
4. Choose blackout, pixelation, or heavy blur and set tight safety padding.
5. Click **Detect, protect, and verify**.
6. Review the independently verified MP4.
7. If anything needs adjustment, seek the source to that exact frame and drag a tight correction box over the text.
8. Reprocess the corrections and review the new verified output.

New manual boxes default to one frame. The start and end controls can widen a correction when several adjacent frames need it.

## Processing boundary

The browser receives a signed session that expires after four hours. The permanent `REDACTION_API_KEY` stays server-side. Modal first checks its local key and, when keys were rotated independently, asks the Labradoor Vercel verifier to validate the signed session. Videos upload directly from the browser to the authenticated Modal worker, so large sensitive bodies do not pass through Vercel.

The worker:

- decodes every frame with FFmpeg;
- runs OCR and PII classification on every frame by default;
- tracks each text region independently through translation, scale, and rotation;
- resets stale tracking at scene changes;
- renders tight word-level masks with selected padding;
- verifies the encoded result using an independent OCR backend;
- releases only an output that passes the verification gate;
- stores originals, plans, quarantine files, and outputs in private job storage;
- deletes job artifacts within the configured retention period, currently 24 hours.

An uncertain result reaches `needs_review`. It is not replaced with black footage and cannot be downloaded until corrections pass verification.

## Required Vercel environment variables

- `REDACTION_API_KEY`: a long server-side secret used to sign and verify browser sessions
- `REDACTION_ADMIN_PASSWORD`: a separate strong password used only to open the admin editor
- `REDACTION_API_BASE_URL`: optional override for the Modal API URL

Environment values must be configured for each Vercel environment that should run the editor, then that environment must be redeployed. The Modal deployment keeps its own `REDACTION_API_KEY` for legacy service authentication, so rotating either deployment no longer breaks browser sessions.

## Detection rules

- Email addresses use a structured email pattern.
- Phone numbers support common US formatting and an optional country code.
- Street addresses require a street number and recognized street suffix.
- Owner names are detected beside or beneath labels such as Owner, Homeowner, Property Owner, Owner Name, or Owner Information.
- Masks use detected word coordinates plus user-controlled padding, not a card-sized region.

## Safety limits

No automatic vision system can recognize information that is unreadable in the source. The editor therefore keeps human review in the release workflow. If OCR, tracking, frame accounting, or independent verification is uncertain, the worker withholds the output for manual correction.

Do not commit customer or homeowner footage to Git. Use synthetic text videos for CI and keep private regression footage in access-controlled storage.
