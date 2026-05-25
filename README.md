# UniFlow

**UniFlow** is a Chrome extension that intercepts the DegreeWorks JSON payload on your university's degree audit page and transforms it into an interactive, visual flowchart. Instead of squinting at DegreeWorks' cluttered table layout, you get a clean, D3-powered graph of your course requirements — with an AI advisor layer that can analyze your progress and answer questions about your academic path.

## What It Does

- **Intercepts DegreeWorks data** — Automatically captures the JSON payload when you load your degree audit worksheet, with no manual export needed.
- **Renders an interactive flowchart** — Visualizes your courses, requirements, and completion status as a navigable node graph using D3.js.
- **AI-powered advising** — Includes an AI advisor that can process your audit data locally and answer questions about your degree progress.
- **Works across universities** — Designed to match any `.edu` domain running DegreeWorks.

---

## Installing in Chrome (Developer Mode)

Since UniFlow is not published to the Chrome Web Store, you load it manually as an unpacked extension.

### 1. Clone the Repository

```bash
git clone https://github.com/Kushagra0514/UniFlow.git
```

Or download the ZIP from GitHub and extract it to a folder you'll remember.

### 2. Open Chrome Extensions

Navigate to:

```
chrome://extensions
```

Or go to **Chrome menu (⋮) → Extensions → Manage Extensions**.

### 3. Enable Developer Mode

In the top-right corner of the Extensions page, toggle **Developer mode** ON.

### 4. Load the Extension

Click **"Load unpacked"** and select the folder where you cloned/extracted the repo (the folder that contains `manifest.json`).

UniFlow will now appear in your extensions list.

### 5. Use It

1. Log in to your university's DegreeWorks portal and navigate to your degree audit worksheet.
   - The extension activates on URLs matching `*.edu/worksheets/*` or any URL containing `degreeworks`.
2. Once the page loads, UniFlow intercepts the audit data automatically.
3. A visualizer panel will open (or you can trigger it via the extension) showing your interactive degree flowchart.
4. Use the AI advisor panel to ask questions about your remaining requirements, course sequences, or graduation timeline.

---

## File Overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension config — permissions, content scripts, service worker |
| `interceptor.js` | Injected into the page at `document_start` (MAIN world) to capture the DegreeWorks JSON payload |
| `content.js` | Runs in the ISOLATED world after page load; coordinates data passing between the page and extension |
| `background.js` | Service worker handling background tasks and messaging |
| `transformer.js` | Parses and transforms raw DegreeWorks JSON into graph-ready data |
| `visualizer.html` | The extension's visualizer page, opened as a tab or panel |
| `visualizer.js` | Renders the D3 flowchart from transformed data |
| `d3.v7.min.js` | Bundled D3.js v7 (no CDN dependency) |
| `ai_advisor.js` | AI advising layer that processes your audit data |
| `ai_entry.js` | Entry point for AI model loading and inference |

---

## Notes

- No data leaves your machine — all processing happens locally in the browser.
- The extension requests permissions for `storage` and `tabs`, and host permissions for HuggingFace (used for AI model weights).
- If your university's DegreeWorks URL doesn't match the default patterns, you may need to update the `matches` fields in `manifest.json`.
