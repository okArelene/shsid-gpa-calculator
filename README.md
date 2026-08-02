# SHSID GPA Calculator

A private, browser-only calculator for SHSID weighted GPA, US-style unweighted GPA, cumulative GPA, and UC GPA estimates.

**Live site:** [okarelene.github.io/shsid-gpa-calculator](https://okarelene.github.io/shsid-gpa-calculator/)

The interface adopts the useful ideas from [GPA Calculator 3](https://github.com/willuhd/GPA-Calculator-3)—flexible schedules, course choices, responsive controls, and saved progress—without importing its unverified credit values or remote catalog updater. Calculation rules live locally and are covered by regression tests.

## What it supports

- One-year calculations for every original Grade 6–12 SHSID preset
- A cumulative workspace with optional Grade 9, 10, 11, and 12 sections and separate Semester 1/2 grades
- SHSID weighted GPA from course points and credits
- US-style unweighted GPA with equal course weighting
- UC unweighted, capped weighted, and uncapped weighted estimates
- Automatic Grade 10–11 A–G inclusion indicators and international AP/IB honors treatment
- Independent duplicate course slots, local autosave, light/dark themes, and mobile layouts
- A consistent visual course order: Chinese, English, Maths, natural sciences, then other electives
- A compact editorial interface with restrained motion and result-only updates during grade entry

Blank grade rows are omitted from every calculation. They are never treated as failing grades.

## Trusted calculation data

[`catalog.js`](./catalog.js) is the single source of truth for courses, credits, level offsets, score bands, special module rules, and UC eligibility defaults. Its metadata ID is `shsid-original-rules-2024`.

The credit table is intentionally locked to the original calculator in this project. The live `GPA-Calculator-3` catalog was audited on 2026-07-31 and disagreed with that table—for example, it reduced several Grade 10 science credits from 4 to 3. Its companion course catalog contains names and levels but no authoritative credit field, so automatic remote replacement would make results non-auditable.

When an official SHSID schedule changes, update `catalog.js` deliberately and update the exact-credit assertions in [`test/calculator.test.js`](./test/calculator.test.js) in the same change.

## Formula notes

- **SHSID weighted:** sum of each entered course's adjusted GPA × credit, divided by entered credits. Special max-module and ToK/EE matrix rules remain intact.
- **SHSID weighted maximum:** the comparison denominator is derived from every level-and-credit combination in the selected complete schedule. The highest complete Grade 9–12 path is 4.438: Grade 9 maxes at 4.323, Grade 10 at 4.430, and the Grade 11/12 IB schedules at 4.500 each.
- **US unweighted:** A = 4, B = 3, C = 2, D = 1, F = 0; all entered courses count equally.
- **Cumulative:** calculates Semester 1 and Semester 2 independently for every added year, then takes the arithmetic mean of the entered semester GPAs. Blank semesters are excluded.
- **UC estimate:** uses the actual entered Grade 10–11 semester grades for catalog-marked A–G courses, ignores plus/minus, caps honors at 8 semesters total and 4 in Grade 10, and awards international honors points only to AP/IB levels. A–G inclusion and honors treatment are automatic; there is no user override. See [UC's official GPA guidance](https://admission.universityofcalifornia.edu/admission-requirements/first-year-requirements/gpa-requirement.html).
- **UC capped maximum:** 4.333 is the highest complete Grade 10–11 combination derivable from the local SHSID catalog: 24 counted A–G semester grades with all 8 honors points. The maximizing Grade 11 schedule is “1× M1 + M2 + M3/4” with Computer Skills excluded automatically as non-A–G.

The site is a planning tool, not an official transcript or admissions prediction.

## Performance strategy

The production engine is deliberately plain static HTML, CSS, and JavaScript. It has no framework runtime, hydration step, package download, web font, analytics script, API dependency, or server-side calculation. The browser downloads the small rule catalog once and every interaction is computed locally. Grade and level changes update the result rail in place instead of rebuilding the course workspace, which keeps form focus stable and interaction latency low.

The current first-party HTML, CSS, JavaScript, and SVG total about 107 KB before compression. Keep the uncompressed core below 150 KB unless a measured user-facing improvement justifies exceeding that budget. A static CDN host with compression and long-lived caching is the intended deployment target; the versioned asset URLs make cache updates explicit.

A service worker and automatic remote catalog updater are intentionally omitted. Both would add stale-data failure modes to a calculator whose numeric rules need to remain transparent and current.

## Run locally

From this folder:

```sh
npm run dev
```

Then open `http://localhost:5173`. There is no build step and no external runtime dependency; opening `index.html` directly also works.

## Test

```sh
npm test
```

The test suite locks representative credit arrays, mixed weighted calculations, blank-row and blank-semester behavior, semester averaging, v2 state migration, automatic A–G classification, UC honors rules, and ToK/EE handling.

## Project structure

- `index.html` — semantic page structure and methodology copy
- `styles.css` — responsive visual system and themes
- `catalog.js` — versioned courses and pure calculation functions
- `app.js` — state, persistence, rendering, and interactions
- `test/calculator.test.js` — calculation regressions
