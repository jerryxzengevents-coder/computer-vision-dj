# CVISION_DJ — Portfolio case study (handoff for portfolio site)

Use this document to write a **full case study page** on your portfolio site. It summarizes what the project is, how it was built, tradeoffs, and what another engineer or agent should highlight.

---

## One-line pitch

**Browser-based twin-deck DJ app** with **beat-grid waveforms**, **Web Audio** mixing, and **live hand-gesture control** (MediaPipe) over EQ, volume, transport, tempo/phase sync, and crossfader—no native app, runs in Chrome/Safari-class browsers.

---

## Problem & intent

- **Problem:** DJ UIs and gesture research are often split across proprietary tools, native apps, or papers without a cohesive, hackable playground.
- **Intent:** Ship a **credible DJ surface** (two decks, zoom waveforms, mixer, sync affordances) that is **actually playable**, while proving **vision-in-the-loop** control that maps naturally to deck A (left) vs deck B (right) in a mirrored camera preview.

---

## What shipped (feature snapshot)

| Area | Details |
|------|---------|
| **Audio engine** | Two `AudioBuffer` decks, per-deck 3-band EQ, channel trim, crossfader bus, varispeed playback, scrub + zoomed waveform windows. |
| **Analysis** | Client-side BPM/key-style estimates, kick markers for phase nudge heuristics, beat phase UI (not Rekordbox-class beat grids). |
| **Waveforms** | High-bin peaks + **signed min/max** bins for **granular**, Rekordbox-style **RGB-ish columns** (low/mid/high energy per bin); zoom window uses **max-in-column** resampling so zoomed views stay truthful. |
| **Gestures** | MediaPipe **Hand Landmarker** (tasks-vision); chord + dwell detection for EQ, volume, play/pause, vinyl jog nudge, two-hand tempo match + phase align. |
| **Reactive layer** | Fullscreen canvas: **red strobes** + **multi-shape lasers** (sweep, fan, slash, helix, orbit) driven by analyser + mixer snapshot; **off by default** with a **Lights** toggle for GPU/CPU cost. |
| **Demo UX** | Two **default demo tracks** loaded from `public/demo/` on first paint so visitors hear something immediately. |
| **UI pass** | Tighter layout: camera-first panel, toolbar (sync + loading + lights + camera), removed redundant copy and the separate “hand gestures” toggle (gestures run whenever camera is on). |

---

## Tech stack & tools

| Layer | Choice |
|-------|--------|
| **Build** | Vite 8, TypeScript 6, `npm` scripts (`dev`, `build`, `preview`). |
| **Audio** | Web Audio API: `AudioContext`, `BiquadFilterNode`, `GainNode`, `AnalyserNode` for visuals tap. |
| **Vision** | `@mediapipe/tasks-vision` (Hand Landmarker), WASM + `.task` model from Google storage; overlay on `<canvas>` over `<video>`. |
| **Rendering** | Canvas 2D for waveforms, hand overlay, fullscreen reactive viz. |
| **Repo** | GitHub (`computer-vision-dj`); static `public/` assets for icons + **demo audio**. |

**Process tools (how the work was done):** Cursor IDE + agent-assisted iteration, iterative UI refactors in `main.ts` / `style.css`, waveform logic isolated in `waveform.ts`, gestures in `handGestures.ts`, viz in `reactiveViz.ts`.

---

## Architecture (high level)

```
index.html
  └─ #reactive-viz (fullscreen, z-index behind app)
  └─ #app (Vite-mounted UI)
       ├─ Camera block: video + hand overlay + gesture cheat sheet
       └─ Performance: zoom waveforms, decks, crossfader

src/main.ts        — UI shell, wiring, demo load, viz toggle, transport
src/deck.ts        — Deck buffer, EQ chain, play/pause, seek, rate/jog
src/mixer.ts       — Crossfader + analyser tap
src/waveform.ts    — Peak + signed min/max bins, granular draw, beat grid
src/analysis.ts    — BPM/key/kick helpers (estimates)
src/handGestures.ts— MediaPipe loop, gesture state machines, HUD
src/reactiveViz.ts — Strobes + lasers (optional)
src/webcam.ts      — getUserMedia preview
```

**Worth calling out on a portfolio:** clear separation between **audio graph**, **visualization**, and **input modality** (mouse vs hands).

---

## Build & deploy notes (for “prod”)

- **Production build:** `npm run build` → static output in `dist/` (Vite). Host on **Netlify, Vercel, Cloudflare Pages, GitHub Pages**, or any static host.
- **Important:** App uses **microphone/camera** and **decodeAudioData** → requires **HTTPS** (or localhost) for camera; users may need to **allow permissions**.
- **Large assets:** Demo tracks live under `public/demo/` (~10 MB combined in typical setup). Keep an eye on **repo size** and **CDN caching** if you swap longer masters.

---

## What worked well

1. **Web Audio as single source of truth** — Decoding once per file, simple deck class, predictable `getCurrentTime()` after seeks and rate changes.
2. **Waveform pipeline split** — `computePeaks` + `computeSignedMinMaxBins` + `computeTriBandPeaks` keeps drawing code readable; windowed view re-aggregates per column so zoom doesn’t “stripe” wrong.
3. **Gesture “chord + dwell” design** — Loose touch thresholds + hold times reduced accidental EQ grabs vs instant pinch detectors.
4. **Reactive viz behind `#app`** — Fullscreen atmosphere without blocking deck UI; **default-off** avoids burning laptops during normal mixing.
5. **Demo tracks in `public/`** — Instant “it works” moment for reviewers; `fetch` + `decodeAudioData` mirrors real file load path.

---

## What was harder / didn’t work ideally

1. **Waveform fidelity vs performance** — Granular columns + 1600 bins + many screen columns is correct but heavier on weak GPUs; needed caps and optional lights-off.
2. **RGB “DJ software” look without proprietary analysis** — Tri-band is a **rough spectral split** per bin, not Serato’s analyzed library; honest portfolio framing: *stylized*, research-grade.
3. **Asset pipeline friction** — User-supplied **`.pfl`** sidecar files were not decodable audio; real **WAV** lived elsewhere. **ffmpeg** was broken in one dev environment; **afconvert** used to produce a smaller **AAC `.m4a`** demo for deck A.
4. **Beat detection** — Header copy correctly notes this is **not** Essentia/aubio-grade locked phase; BPM is **estimated**—fine for UX demo, not for pro sync claims.
5. **Hand gestures + mirrored video** — Mirroring is consistent for “left = A” but increases cognitive load in write-ups; document the mapping clearly on the portfolio page.

---

## Risks & ethics (good for case study “reflection”)

- **Camera on disk:** Clear disclosure that video is processed in-browser; no server upload in this codebase path—verify before claiming “privacy-first” if hosting changes.
- **Music rights:** Demo tracks should be **owned or licensed** for public hosting; replace with royalty-safe loops for a public portfolio fork if needed.

---

## Suggested portfolio narrative arc

1. **Hook** — “I wanted a DJ surface I could extend with computer vision in the open web.”
2. **Constraints** — No Electron; must run static; must feel responsive; must degrade gracefully.
3. **Deep dives (optional sections)**  
   - Waveform: from wrong zoom resampling → column max + signed min/max.  
   - Gestures: chord grammar, dwell, two-hand sync.  
   - Viz: music features → strobes + parametric lasers; perf toggle.
4. **Outcome** — Playable demo, gesture-controlled mix path, clear module boundaries.
5. **Next** — Stem-aware coloring, proper beat grid from beat tracker WASM, Bluetooth DJ controller MIDI, optional TensorFlow.js fallback.

---

## Files another agent should read first

| File | Why |
|------|-----|
| `src/main.ts` | All UX wiring, demo load, camera/reactive toggles. |
| `src/deck.ts` | Audio graph + transport model. |
| `src/waveform.ts` | All waveform math + drawing modes. |
| `src/handGestures.ts` | Gesture detection + loop lifecycle. |
| `src/reactiveViz.ts` | Fullscreen reactive visuals. |
| `src/analysis.ts` | BPM/key/kick heuristics. |
| `package.json` | Exact dependency footprint. |

---

## Commands cheat sheet

```bash
npm install
npm run dev      # local dev
npm run build    # typecheck + production bundle
npm run preview  # serve dist locally
```

---

## Git / “push to prod” (for the maintainer)

Remote is typically **`origin`** on **`main`**. After `git add -A` and a conventional commit message, **`git push origin main`** updates GitHub; **production** is then whatever is connected to that branch (Pages, Vercel, etc.)—confirm the deploy hook in your hosting dashboard.

---

*End of handoff. Extend this with screenshots, a short screen recording, and metrics (bundle size, Lighthouse) when publishing.*
