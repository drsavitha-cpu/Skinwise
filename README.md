# Skinwise — Acne Severity Analyzer

A free, deploy-ready web app that uses live camera capture and AI to analyze acne severity using the Global Acne Grading System (GAGS).

**Stack:** Vanilla HTML/CSS/JS + MediaPipe Face Detection + Google Gemini Vision (free tier) + Vercel hosting

---

## What you need (all free, no credit card)

1. A free **Google account** (for the Gemini API key)
2. A free **GitHub account** (optional but recommended)
3. A free **Vercel account**

Total setup time: ~10 minutes.

---

## Step 1 — Get your free Gemini API key

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **"Create API key"** → **"Create API key in new project"**
4. Copy the key (looks like `AIzaSy...`). Keep it private — don't paste it anywhere public.

Free tier limits: 1,500 requests per day on Gemini 1.5 Flash. More than enough.

---

## Step 2 — Deploy to Vercel

### Easiest path (drag and drop, no Git needed):

1. Go to **https://vercel.com/signup** and sign up (use your Google account)
2. On the dashboard, click **"Add New..." → "Project"**
3. Click **"Import a Third-Party Git Repository"** OR scroll down for the deploy option
4. Easier alternative: install the **Vercel CLI**:
   ```bash
   npm install -g vercel
   cd skinwise
   vercel
   ```
   Follow the prompts. Pick "no" when asked about linking to existing project.

### Recommended path (via GitHub):

1. Create a new GitHub repo named `skinwise`
2. Upload all files in this folder (or push via Git)
3. Go to **https://vercel.com/new**
4. Click **"Import"** next to your `skinwise` repo
5. On the configuration screen, leave everything as default
6. Before clicking "Deploy", expand **"Environment Variables"**:
   - Key: `GEMINI_API_KEY`
   - Value: paste your Gemini key from Step 1
7. Click **"Deploy"**

After ~60 seconds you'll get a live URL like `skinwise-xyz.vercel.app`.

---

## Step 3 — Add your API key (if you used the CLI)

If you deployed via CLI without setting the env var:

1. Go to **https://vercel.com/dashboard**
2. Click your `skinwise` project
3. Settings → Environment Variables
4. Add: `GEMINI_API_KEY` = your key from Step 1
5. Save, then redeploy: Deployments tab → click the latest → "Redeploy"

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  ┌────────────────┐  ┌───────────────┐  ┌────────────────┐ │
│  │ Live camera    │→ │ MediaPipe     │→ │ 3 photos       │ │
│  │ (getUserMedia) │  │ face detect   │  │ captured       │ │
│  └────────────────┘  └───────────────┘  └────────────────┘ │
│                                                  ↓           │
│                                          POST /api/analyze   │
└──────────────────────────────────────────────────┼──────────┘
                                                   ↓
┌─────────────────────────────────────────────────────────────┐
│  Vercel serverless function (api/analyze.js)                │
│  ─ Reads GEMINI_API_KEY from env (secret)                   │
│  ─ Forwards images + prompt to Gemini 1.5 Flash             │
│  ─ Parses JSON response, validates, returns to browser      │
└─────────────────────────────────────────────────────────────┘
                                                   ↓
                                          GAGS score computed
                                          client-side from
                                          per-region lesion counts
```

The API key never touches the browser. Photos are processed transiently and not stored.

---

## File structure

```
skinwise/
├── index.html        UI: 7 views (landing → about → prep → scan → complete → analyzing → results)
├── style.css         Skinwise design system (red/white/grey)
├── app.js            All client logic: camera, face detection, capture, results, region zoom
├── api/
│   └── analyze.js    Vercel serverless function — proxies Gemini API
├── vercel.json       Deploy config
├── package.json      Marks as Node project
└── README.md         This file
```

---

## GAGS scoring (Doshi et al.)

Each region's score = local factor × worst lesion grade.

| Region       | Factor |
|--------------|--------|
| Forehead     | × 2    |
| Right cheek  | × 2    |
| Left cheek   | × 2    |
| Nose         | × 1    |
| Chin         | × 1    |

(Original scale also includes chest/back factor 3 — omitted in this face-only tool.)

Grades: 0 = none, 1 = comedones, 2 = papules, 3 = pustules, 4 = nodules.
Max face-only score = 44.

| GAGS score | Severity      |
|------------|---------------|
| 0          | No acne       |
| 1–18       | Mild          |
| 19–30      | Moderate      |
| 31–38      | Severe        |
| 39+        | Very severe   |

---

## Local development

The app needs HTTPS (or localhost) for the camera to work. Open `index.html` directly via `file://` will not give camera access.

Easiest local test:
```bash
cd skinwise
npx vercel dev
```
This runs Vercel's dev server with the serverless function working locally. Add your Gemini key to a `.env.local` file:
```
GEMINI_API_KEY=AIzaSy...
```

---

## Troubleshooting

**Camera doesn't open**
- Make sure you're on HTTPS (Vercel gives this automatically). Plain `file://` blocks the camera.
- Check browser permissions: click the lock icon in the address bar → camera → Allow.

**"GEMINI_API_KEY not configured"**
- Go to Vercel project → Settings → Environment Variables → add `GEMINI_API_KEY` → redeploy.

**"Gemini API error 429"**
- You hit the free tier limit (1,500/day). Wait until tomorrow or upgrade.

**Face detection checks never turn green**
- Lighting too dim or too bright (the check requires brightness between 70 and 220 on a 0–255 scale).
- Face too small or too far from center. Move closer to camera.
- For profile poses, make sure to turn fully 90° — the system expects a clearly narrow face shape.

**Analysis gives strange counts**
- Gemini is a general vision model, not trained specifically on acne. For wellness/demo it's fine; for clinical use you'd want a custom-trained model.

---

## Disclaimer

This tool is for **wellness and educational purposes only**. It is not a medical device and does not provide medical diagnosis. For persistent, worsening, or scarring acne, consult a board-certified dermatologist.
