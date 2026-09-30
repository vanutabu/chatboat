# Site chat assistant - setup

## What was added
- `backend/services/chatService.js` - calls the Anthropic API with your
  site's facts (services, contact info, stats, how ordering works) as
  context. Edit the `SITE_KNOWLEDGE` block in this file whenever the
  homepage content changes - it's not live-crawled, it's a static context
  block kept in sync by hand, which is faster and more reliable than
  crawling on every request.
- `backend/controllers/chatController.js`, `backend/routes/chat.js` -
  wires `POST /api/chat` into your existing Express app.
- `backend/middleware/chatRateLimit.js` - caps each visitor to 15
  messages per 5 minutes (in-memory, no new dependency) so the endpoint
  can't be used to run up your Anthropic bill.
- `js/chat-widget.js` - a floating chat bubble (bottom-right, stacked
  above your existing back-to-top button) that talks to `/api/chat`.
  It's a single self-contained file, loaded with `defer`, so it can't
  block first paint or affect the FCP/LCP work from before. It keeps the
  last few messages in `sessionStorage` so a page refresh doesn't lose
  the conversation, and never stores anything server-side.

## What you need to do
1. Get a **free** API key at https://console.groq.com/keys - just an
   email address, no credit card required.
2. In Railway, add an environment variable:
   ```
   GROQ_API_KEY=gsk_...
   ```
   Do **not** put this in `.env.example` or commit it anywhere.
3. Deploy. That's it - no frontend build step, no new npm packages.

If `GROQ_API_KEY` isn't set, the widget still loads and looks normal,
but sending a message returns a friendly "chat is not configured yet"
error instead of crashing anything.

## Free tier limits (Groq, as of this writing)
~30 requests/minute and ~14,400/day, at no cost - no credit card on
file, nothing to accidentally get billed for. If you outgrow that, Groq
also has a paid tier with higher limits on the same endpoint.

## Guardrails already built in
- The assistant only answers from the facts in `SITE_KNOWLEDGE` - it's
  told explicitly not to invent prices, order status, or policies.
- Anything account-specific (an actual order, a refund, an exact quote)
  gets redirected to support@assignmenthelp.com / +1 (800) 123-4567
  rather than guessed at.
- Messages are capped at 600 characters and conversation history sent to
  the API is capped at the last 6 turns, to bound cost/load per request.
- Rate limited per IP (15 messages / 5 min) on top of Groq's own limits,
  so it can't be spammed.

## If you'd rather use Google Gemini instead of Groq
Also free, no card required (https://aistudio.google.com/apikey), just a
different API shape. The whole integration is isolated to
`backend/services/chatService.js` - ask and I can swap it over.

## Chat bar v2: file attachments, free limit, paid plan
Files: `css/chatbar.css` (styles), `js/chat-widget.js` (behaviour),
`build-chatbar.py` (writes the styles + markup into `index.html` and refreshes
the `.gz` copies the server prefers). After editing the CSS run
`python3 build-chatbar.py`; after editing the JS just bump `?v=` in the script
tag (the build script does this) and regenerate the `.gz`.

### Attachments
- Visitors can attach up to 5 files (10 MB each): PDF, Word (.docx), .txt,
  .md, .csv, .json and images (png/jpg/webp/gif). Drag-and-drop, paste and
  "Take a photo" on phones all work. Clicking a file chip previews it.
- The server reads the files for that one question only. Nothing is written to
  disk or the database.
- Documents are converted to text (`pdf-parse`, `mammoth`), capped at ~12,000
  characters per question so Groq's free-tier token limits aren't hit. Images
  are sent to `CHAT_VISION_MODEL`. Scanned PDFs have no text - visitors are
  told to attach photos of the pages instead.
- **Run `npm install` after pulling this change** (two new dependencies:
  `pdf-parse`, `mammoth`) and commit the updated `package-lock.json`.

### Free limit and $20/month plan
- Each browser gets 5 free questions (`FREE_CHAT_LIMIT`). The count is kept
  server-side in a `chat_usage` table (created automatically), keyed by an
  httpOnly cookie, plus a looser per-IP cap of 3x the limit so clearing
  cookies doesn't give unlimited free use. A question that fails to get an
  answer is refunded.
- The 6th question opens a sign-up dialog. "Sign up for $20/month" creates a
  Stripe Checkout subscription. On return, `/api/billing/confirm` verifies the
  session with Stripe and sets a signed `ah_pro` cookie (35 days) that removes
  the limit. Active status is re-checked with Stripe every ~10 minutes, so
  cancellations take effect quickly.
- Set `STRIPE_SECRET_KEY` in Railway to switch payments on (see
  `.env.example`). Until then the dialog shows a polite "not switched on yet".
- Known gap: subscribers are recognised by their cookie, so they must re-buy
  or contact support on a new browser/device. A proper login (email + magic
  link, or Stripe customer portal + webhook) is the natural next step.

## Rotate credentials
An earlier version of `backend/.env.example` contained a real-looking database
password, JWT secret and Gmail app password. They have been replaced with
placeholders here, but anything that was ever committed should be treated as
exposed: rotate them and keep real values only in Railway's environment
variables.


### Copy / PDF / Word for answers
Every assistant answer has three buttons: **Copy**, **PDF** and **Word** (.docx).
- Built into `js/chat-widget.js` (the `EX` block) - no libraries, nothing extra to load.
- The file contains the visitor's question, the answer (headings, bullets, numbered
  lists and bold are kept; raw markdown symbols are removed) and a small footer.
- PDF is a real downloadable file for Latin-alphabet text. If an answer contains
  other scripts (Hindi, Arabic, Chinese...), the PDF button opens the browser's print
  dialog instead - choose "Save as PDF" there. The Word file supports all languages.
- Error messages ("something went wrong") do not show these buttons.
