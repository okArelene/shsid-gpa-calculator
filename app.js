(function initGPACalculator(global) {
  "use strict";

  const catalog = global.SHSIDCatalog || (typeof require !== "undefined" ? require("./catalog.js") : null);
  if (!catalog) throw new Error("SHSID catalog failed to load.");

  const STORAGE_KEY = "shsid-gpa-calculator-v3";
  const LEGACY_STORAGE_KEYS = ["shsid-gpa-calculator-v2", "shsid-gpa-calculator-v1"];
  const CUMULATIVE_GRADES = [9, 10, 11, 12];
  const SEMESTERS = [1, 2];
  const COURSE_CATEGORY_ORDER = Object.freeze({
    chinese: 0,
    english: 1,
    maths: 2,
    sciences: 3,
    other: 4
  });
  const NATURAL_SCIENCE_NAMES = new Set([
    "biology",
    "chemistry",
    "physics",
    "ess",
    "environmental science",
    "environmental engineering"
  ]);
  const DEFAULT_PRESETS_BY_GRADE = {
    9: "stockshsidgrade9",
    10: "stockshsidgrade10",
    11: "stockshsidgrade11-2m2-1m3",
    12: "stockshsidgrade12-2m2-1m3"
  };

  const {
    CATALOG_META,
    GPA_SCALE_MAXIMA,
    SHSID_WEIGHTED_PRESET_MAXIMA,
    SHSID_WEIGHTED_SCHOOL_MAXIMUM,
    UC_CAPPED_SCHOOL_MAXIMUM,
    presets,
    computeSubjectGPA,
    computeCumulativeTotals,
    computeUCGPA,
    formatGPA,
    isSubjectUCEligible,
    resolvedSubjectName,
    selectedLevel
  } = catalog;

  function getPresetById(id) {
    return presets.find((currentPreset) => currentPreset.id === id) ?? presets[0];
  }

  function presetsForGrade(grade) {
    return presets.filter((currentPreset) => currentPreset.grade === grade);
  }

  function defaultPresetForGrade(grade) {
    const requestedId = DEFAULT_PRESETS_BY_GRADE[grade];
    return presetsForGrade(grade).find((currentPreset) => currentPreset.id === requestedId)
      ?? presetsForGrade(grade)[0]
      ?? presets[0];
  }

  function createSinglePresetState(currentPreset) {
    return {
      inputs: currentPreset.subjects.map(() => ({ levelIndex: 0, scoreIndex: null })),
      nameChoices: currentPreset.subjects.map(() => -1)
    };
  }

  function createCumulativePresetState(currentPreset) {
    return {
      inputs: currentPreset.subjects.map(() => ({ levelIndex: 0, scoreIndices: [null, null] })),
      nameChoices: currentPreset.subjects.map(() => -1)
    };
  }

  function validLevelIndex(currentSubject, value) {
    return Number.isInteger(value) && value >= 0 && value < currentSubject.levels.length ? value : 0;
  }

  function validScoreIndex(currentSubject, value) {
    return Number.isInteger(value) && value >= 0 && value < currentSubject.scores.length ? value : null;
  }

  function validNameChoice(currentSubject, value) {
    const choiceCount = currentSubject.alternateNames?.length ?? 0;
    return Number.isInteger(value) && value >= -1 && value < choiceCount ? value : -1;
  }

  function sanitizeSinglePresetState(currentPreset, candidate) {
    if (!candidate || typeof candidate !== "object") return createSinglePresetState(currentPreset);
    return {
      inputs: currentPreset.subjects.map((currentSubject, subjectIndex) => {
        const saved = candidate.inputs?.[subjectIndex] ?? {};
        return {
          levelIndex: validLevelIndex(currentSubject, saved.levelIndex),
          scoreIndex: validScoreIndex(currentSubject, saved.scoreIndex)
        };
      }),
      nameChoices: currentPreset.subjects.map((currentSubject, subjectIndex) => (
        validNameChoice(currentSubject, candidate.nameChoices?.[subjectIndex])
      ))
    };
  }

  function sanitizeCumulativePresetState(currentPreset, candidate) {
    if (!candidate || typeof candidate !== "object") return createCumulativePresetState(currentPreset);
    return {
      inputs: currentPreset.subjects.map((currentSubject, subjectIndex) => {
        const saved = candidate.inputs?.[subjectIndex] ?? {};
        const savedScores = Array.isArray(saved.scoreIndices)
          ? saved.scoreIndices
          : [saved.scoreIndex, null];
        return {
          levelIndex: validLevelIndex(currentSubject, saved.levelIndex),
          scoreIndices: SEMESTERS.map((_, semesterIndex) => (
            validScoreIndex(currentSubject, savedScores[semesterIndex])
          ))
        };
      }),
      nameChoices: currentPreset.subjects.map((currentSubject, subjectIndex) => (
        validNameChoice(currentSubject, candidate.nameChoices?.[subjectIndex])
      ))
    };
  }

  function createYearState(grade) {
    const availablePresets = presetsForGrade(grade);
    const currentPreset = defaultPresetForGrade(grade);
    return {
      grade,
      presetId: currentPreset.id,
      collapsed: false,
      byPreset: Object.fromEntries(availablePresets.map((presetItem) => [
        presetItem.id,
        createCumulativePresetState(presetItem)
      ]))
    };
  }

  function preferredTheme() {
    return global.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function createDefaultState() {
    return {
      version: 3,
      mode: "single",
      scoreFormat: "percentage",
      theme: preferredTheme(),
      singlePresetId: "stockshsidgrade10",
      byPreset: Object.fromEntries(presets.map((currentPreset) => [
        currentPreset.id,
        createSinglePresetState(currentPreset)
      ])),
      cumulativeYears: [createYearState(9)]
    };
  }

  function sanitizeYearState(candidate, seenGrades) {
    const grade = Number(candidate?.grade);
    if (!CUMULATIVE_GRADES.includes(grade) || seenGrades.has(grade)) return null;
    seenGrades.add(grade);

    const fallback = createYearState(grade);
    const validPreset = presetsForGrade(grade).find((currentPreset) => currentPreset.id === candidate.presetId);
    const presetId = validPreset?.id ?? fallback.presetId;
    const byPreset = Object.fromEntries(presetsForGrade(grade).map((currentPreset) => [
      currentPreset.id,
      sanitizeCumulativePresetState(
        currentPreset,
        candidate.byPreset?.[currentPreset.id]
          ?? (candidate.presetId === currentPreset.id ? candidate.presetState : null)
      )
    ]));

    return { grade, presetId, collapsed: Boolean(candidate.collapsed), byPreset };
  }

  function sanitizeState(candidate) {
    const fallback = createDefaultState();
    if (!candidate || typeof candidate !== "object") return fallback;

    const legacySingleId = candidate.version !== 3 ? candidate.presetId : null;
    const requestedSingleId = legacySingleId ?? candidate.singlePresetId;
    const singlePresetId = presets.some((currentPreset) => currentPreset.id === requestedSingleId)
      ? requestedSingleId
      : fallback.singlePresetId;
    const candidateByPreset = candidate.byPreset ?? {};
    const byPreset = Object.fromEntries(presets.map((currentPreset) => [
      currentPreset.id,
      sanitizeSinglePresetState(currentPreset, candidateByPreset[currentPreset.id])
    ]));

    const seenGrades = new Set();
    const cumulativeYears = Array.isArray(candidate.cumulativeYears)
      ? candidate.cumulativeYears
        .map((year) => sanitizeYearState(year, seenGrades))
        .filter(Boolean)
        .sort((a, b) => a.grade - b.grade)
      : fallback.cumulativeYears;

    return {
      version: 3,
      mode: candidate.mode === "cumulative" ? "cumulative" : "single",
      scoreFormat: candidate.scoreFormat === "letter" ? "letter" : "percentage",
      theme: candidate.theme === "dark" ? "dark" : candidate.theme === "light" ? "light" : fallback.theme,
      singlePresetId,
      byPreset,
      cumulativeYears
    };
  }

  function loadState() {
    try {
      const current = global.localStorage?.getItem(STORAGE_KEY);
      if (current) return sanitizeState(JSON.parse(current));
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacy = global.localStorage?.getItem(key);
        if (legacy) return sanitizeState(JSON.parse(legacy));
      }
    } catch {
      // Invalid or unavailable local storage should never block the calculator.
    }
    return createDefaultState();
  }

  function saveState(state) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private browsing may disable local storage.
    }
  }

  function getSinglePresetState(state) {
    const currentPreset = getPresetById(state.singlePresetId);
    state.byPreset[currentPreset.id] ??= createSinglePresetState(currentPreset);
    return state.byPreset[currentPreset.id];
  }

  function getYearPresetState(year) {
    const currentPreset = getPresetById(year.presetId);
    year.byPreset[currentPreset.id] ??= createCumulativePresetState(currentPreset);
    return year.byPreset[currentPreset.id];
  }

  function semesterInputs(presetState, semesterIndex) {
    return presetState.inputs.map((input) => ({
      levelIndex: input.levelIndex,
      scoreIndex: input.scoreIndices[semesterIndex]
    }));
  }

  function calculationEntries(state) {
    if (state.mode === "single") {
      const currentPreset = getPresetById(state.singlePresetId);
      const presetState = getSinglePresetState(state);
      return [{
        grade: currentPreset.grade,
        semester: 1,
        label: "Current semester",
        preset: currentPreset,
        inputs: presetState.inputs,
        nameChoices: presetState.nameChoices
      }];
    }

    return state.cumulativeYears.flatMap((year) => {
      const currentPreset = getPresetById(year.presetId);
      const presetState = getYearPresetState(year);
      return SEMESTERS.map((semester, semesterIndex) => ({
        grade: year.grade,
        semester,
        label: `Grade ${year.grade} · Semester ${semester}`,
        preset: currentPreset,
        inputs: semesterInputs(presetState, semesterIndex),
        nameChoices: presetState.nameChoices
      }));
    });
  }

  function shsidWeightedMaximumForState(state) {
    if (state.mode === "single") {
      return SHSID_WEIGHTED_PRESET_MAXIMA[state.singlePresetId]?.gpa
        ?? SHSID_WEIGHTED_SCHOOL_MAXIMUM.gpa;
    }

    const selectedMaxima = state.cumulativeYears
      .map((year) => SHSID_WEIGHTED_PRESET_MAXIMA[year.presetId]?.gpa)
      .filter(Number.isFinite);
    return selectedMaxima.length > 0
      ? selectedMaxima.reduce((sum, maximum) => sum + maximum, 0) / selectedMaxima.length
      : SHSID_WEIGHTED_SCHOOL_MAXIMUM.gpa;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function courseCategory(currentSubject, choiceIndex = -1) {
    const resolvedName = resolvedSubjectName(currentSubject, choiceIndex).trim().toLowerCase();
    const baseName = currentSubject.name.regular.trim().toLowerCase();

    if (resolvedName === "chinese") return "chinese";
    if (resolvedName === "english") return "english";
    if (resolvedName === "math" || resolvedName === "maths" || resolvedName === "mathematics") {
      return "maths";
    }
    if (baseName === "science" || baseName.startsWith("science ") || NATURAL_SCIENCE_NAMES.has(resolvedName)) {
      return "sciences";
    }
    return "other";
  }

  function orderedSubjectEntries(currentPreset, presetState) {
    return currentPreset.subjects
      .map((currentSubject, subjectIndex) => ({
        currentSubject,
        subjectIndex,
        category: courseCategory(currentSubject, presetState.nameChoices[subjectIndex])
      }))
      .sort((first, second) => (
        COURSE_CATEGORY_ORDER[first.category] - COURSE_CATEGORY_ORDER[second.category]
          || first.subjectIndex - second.subjectIndex
      ));
  }

  function icon(name) {
    const icons = {
      moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 15.2A8.6 8.6 0 0 1 8.8 3.6 8.8 8.8 0 1 0 20.4 15.2Z"/></svg>',
      sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
      reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M5.5 16a8 8 0 1 0 .6-9.1L4 10"/></svg>',
      trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>',
      plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
    };
    return icons[name] ?? "";
  }

  function presetOptionGroups(selectedId) {
    const grades = [...new Set(presets.map((currentPreset) => currentPreset.grade))];
    return grades.map((grade) => {
      const gradePresets = presetsForGrade(grade);
      return `
        <optgroup label="Grade ${grade}">
          ${gradePresets.map((currentPreset) => `
            <option value="${escapeHtml(currentPreset.id)}" ${currentPreset.id === selectedId ? "selected" : ""}>
              ${escapeHtml(gradePresets.length === 1 ? currentPreset.name : `${currentPreset.name} · ${currentPreset.subtitle}`)}
            </option>
          `).join("")}
        </optgroup>
      `;
    }).join("");
  }

  function yearPresetOptions(grade, selectedId) {
    return presetsForGrade(grade).map((currentPreset) => `
      <option value="${escapeHtml(currentPreset.id)}" ${currentPreset.id === selectedId ? "selected" : ""}>
        ${escapeHtml(currentPreset.subtitle)}
      </option>
    `).join("");
  }

  function renderFormatControl(state, idSuffix) {
    return `
      <fieldset class="format-control">
        <legend>Grade display</legend>
        <label>
          <input type="radio" name="score-format-${escapeHtml(idSuffix)}" value="percentage" data-action="score-format" ${state.scoreFormat === "percentage" ? "checked" : ""}>
          <span>Score</span>
        </label>
        <label>
          <input type="radio" name="score-format-${escapeHtml(idSuffix)}" value="letter" data-action="score-format" ${state.scoreFormat === "letter" ? "checked" : ""}>
          <span>Letter</span>
        </label>
      </fieldset>
    `;
  }

  function contextAttributes(scope, yearGrade) {
    return `data-scope="${scope}"${scope === "year" ? ` data-year-grade="${yearGrade}"` : ""}`;
  }

  function duplicateCourseNames(currentPreset, presetState) {
    const seen = new Set();
    const duplicates = new Set();
    currentPreset.subjects.forEach((currentSubject, subjectIndex) => {
      if (!currentSubject.alternateNames || presetState.nameChoices[subjectIndex] < 0) return;
      const name = resolvedSubjectName(currentSubject, presetState.nameChoices[subjectIndex]);
      if (seen.has(name)) duplicates.add(name);
      seen.add(name);
    });
    return [...duplicates];
  }

  function chosenNamesExcept(currentPreset, presetState, excludedIndex) {
    return new Set(currentPreset.subjects.flatMap((currentSubject, subjectIndex) => {
      if (subjectIndex === excludedIndex || !currentSubject.alternateNames) return [];
      const choiceIndex = presetState.nameChoices[subjectIndex];
      return choiceIndex >= 0 ? [resolvedSubjectName(currentSubject, choiceIndex)] : [];
    }));
  }

  function renderCourseName(currentPreset, presetState, currentSubject, subjectIndex, attrs, controlId) {
    if (!currentSubject.alternateNames) {
      return `<h3>${escapeHtml(resolvedSubjectName(currentSubject))}</h3>`;
    }

    const unavailableNames = chosenNamesExcept(currentPreset, presetState, subjectIndex);
    const selectedChoice = presetState.nameChoices[subjectIndex];
    return `
      <label class="course-name-field" for="${controlId}-name">
        <span class="sr-only">Course name</span>
        <select id="${controlId}-name" data-action="course-name" data-subject-index="${subjectIndex}" ${attrs}>
          <option value="-1" ${selectedChoice === -1 ? "selected" : ""}>Choose course</option>
          ${currentSubject.alternateNames.map((choice, choiceIndex) => {
            const disabled = unavailableNames.has(choice.regular) && selectedChoice !== choiceIndex;
            return `<option value="${choiceIndex}" ${selectedChoice === choiceIndex ? "selected" : ""} ${disabled ? "disabled" : ""}>${escapeHtml(choice.regular)}</option>`;
          }).join("")}
        </select>
      </label>
    `;
  }

  function renderUcMarker(currentSubject, presetState, subjectIndex, yearGrade) {
    if (yearGrade !== 10 && yearGrade !== 11) return "";
    const choiceIndex = presetState.nameChoices[subjectIndex];
    if (!isSubjectUCEligible(currentSubject, choiceIndex)) return "";
    const levelValue = selectedLevel(currentSubject, presetState.inputs[subjectIndex]);
    return `
      <span class="uc-marker" title="Automatically included in the UC A–G estimate">
        * A–G${levelValue.ucHonors ? " · UC +1" : ""}
      </span>
    `;
  }

  function renderLevelControl(currentSubject, selectedInput, presetState, subjectIndex, attrs, controlId) {
    const courseName = resolvedSubjectName(currentSubject, presetState.nameChoices[subjectIndex]);
    return `
      <fieldset class="level-control">
        <legend class="sr-only">Level for ${escapeHtml(courseName)}</legend>
        <div class="level-segments">
          ${currentSubject.levels.map((currentLevel, levelIndex) => `
            <label>
              <input type="radio" name="${controlId}-level" value="${levelIndex}" data-action="level" data-subject-index="${subjectIndex}" ${attrs} ${selectedInput.levelIndex === levelIndex ? "checked" : ""}>
              <span>${escapeHtml(currentLevel.name)}</span>
            </label>
          `).join("")}
        </div>
        <select class="level-select" aria-label="Level for ${escapeHtml(courseName)}" data-action="level" data-subject-index="${subjectIndex}" ${attrs}>
          ${currentSubject.levels.map((currentLevel, levelIndex) => `<option value="${levelIndex}" ${selectedInput.levelIndex === levelIndex ? "selected" : ""}>${escapeHtml(currentLevel.name)}</option>`).join("")}
        </select>
      </fieldset>
    `;
  }

  function renderGradeSelect(currentSubject, scoreIndex, state, attrs, controlId, subjectIndex, action, semesterIndex = null) {
    const semesterAttribute = semesterIndex === null ? "" : ` data-semester-index="${semesterIndex}"`;
    const gradeLabel = semesterIndex === null ? "Grade" : `Semester ${semesterIndex + 1} grade`;
    return `
      <label class="grade-control" for="${controlId}">
        <span class="sr-only">${gradeLabel}</span>
        <select id="${controlId}" data-action="${action}" data-subject-index="${subjectIndex}"${semesterAttribute} ${attrs}>
          <option value="" ${scoreIndex === null ? "selected" : ""}>—</option>
          ${currentSubject.scores.map((scoreItem, currentScoreIndex) => {
            const scoreName = state.scoreFormat === "letter" ? scoreItem.letterName : scoreItem.percentageName;
            return `<option value="${currentScoreIndex}" ${scoreIndex === currentScoreIndex ? "selected" : ""}>${escapeHtml(scoreName)}</option>`;
          }).join("")}
        </select>
      </label>
    `;
  }

  function renderCourseList(currentPreset, presetState, state, scope, yearGrade, cumulative = false) {
    const attrs = contextAttributes(scope, yearGrade);
    const duplicates = duplicateCourseNames(currentPreset, presetState);
    const warning = duplicates.length > 0 ? `
      <div class="inline-alert" role="alert">
        <strong>Duplicate course:</strong>
        <span>${escapeHtml(`${duplicates.join(", ")} appears more than once.`)}</span>
      </div>
    ` : "";

    return `
      ${warning}
      <div class="course-ledger ${cumulative ? "is-cumulative" : "is-single"}">
        <div class="course-table-head" aria-hidden="true">
          <span>Course</span>
          <span>Level</span>
          ${cumulative ? "<span>Semester 1</span><span>Semester 2</span>" : "<span>Grade</span>"}
        </div>
        <div class="course-list">
          ${orderedSubjectEntries(currentPreset, presetState).map(({ currentSubject, subjectIndex }) => {
            const selected = presetState.inputs[subjectIndex];
            const selectedScores = cumulative ? selected.scoreIndices : [selected.scoreIndex];
            const isComplete = selectedScores.some((scoreIndex) => Number.isInteger(scoreIndex));
            const controlId = `${scope}-${yearGrade ?? "single"}-${currentPreset.id}-${subjectIndex}`;
            const levelValue = selectedLevel(currentSubject, selected);

            return `
              <article class="course-row ${isComplete ? "is-complete" : ""}">
                <div class="course-identity">
                  ${renderCourseName(currentPreset, presetState, currentSubject, subjectIndex, attrs, controlId)}
                  <div class="course-meta">
                    <span>${escapeHtml(levelValue.weight)} credits</span>
                    ${renderUcMarker(currentSubject, presetState, subjectIndex, yearGrade)}
                  </div>
                </div>

                ${renderLevelControl(currentSubject, selected, presetState, subjectIndex, attrs, controlId)}

                ${cumulative
                  ? SEMESTERS.map((semester, semesterIndex) => renderGradeSelect(
                    currentSubject,
                    selected.scoreIndices[semesterIndex],
                    state,
                    attrs,
                    `${controlId}-semester-${semester}`,
                    subjectIndex,
                    "semester-score",
                    semesterIndex
                  )).join("")
                  : renderGradeSelect(
                    currentSubject,
                    selected.scoreIndex,
                    state,
                    attrs,
                    `${controlId}-score`,
                    subjectIndex,
                    "score"
                  )}
              </article>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderSingleWorkspace(state) {
    const currentPreset = getPresetById(state.singlePresetId);
    const presetState = getSinglePresetState(state);
    return `
      <section class="workspace" aria-labelledby="single-heading">
        <div class="workspace-header">
          <div>
            <p class="section-label">Single semester</p>
            <h2 id="single-heading">${escapeHtml(currentPreset.name)}</h2>
          </div>
          <button class="text-button" type="button" data-action="reset-single">
            ${icon("reset")}<span>Reset</span>
          </button>
        </div>

        <div class="setup-bar">
          <label class="select-field wide-field">
            <span>Schedule</span>
            <select data-action="single-preset">${presetOptionGroups(currentPreset.id)}</select>
          </label>
          ${renderFormatControl(state, "single")}
        </div>

        ${renderCourseList(currentPreset, presetState, state, "single", currentPreset.grade)}
      </section>
    `;
  }

  function renderYearCard(year, state) {
    const currentPreset = getPresetById(year.presetId);
    const presetState = getYearPresetState(year);
    const selectedCount = presetState.inputs.reduce((sum, input) => (
      sum + input.scoreIndices.filter((scoreIndex) => Number.isInteger(scoreIndex)).length
    ), 0);
    const totalCount = currentPreset.subjects.length * SEMESTERS.length;

    return `
      <section class="year-section ${year.collapsed ? "is-collapsed" : ""}" aria-labelledby="year-${year.grade}-heading">
        <div class="year-header">
          <button class="year-toggle" type="button" data-action="toggle-year" data-year-grade="${year.grade}" aria-expanded="${!year.collapsed}">
            <span class="year-index">${year.grade}</span>
            <span class="year-title-block">
              <span id="year-${year.grade}-heading" class="year-title">Grade ${year.grade}</span>
              <span class="year-summary">${selectedCount}/${totalCount} semester grades</span>
            </span>
            <span class="chevron">${icon("chevron")}</span>
          </button>
          <div class="year-actions">
            <button class="icon-button" type="button" data-action="reset-year" data-year-grade="${year.grade}" aria-label="Reset Grade ${year.grade}" title="Reset Grade ${year.grade}">${icon("reset")}</button>
            <button class="icon-button danger-button" type="button" data-action="remove-year" data-year-grade="${year.grade}" aria-label="Remove Grade ${year.grade}" title="Remove Grade ${year.grade}">${icon("trash")}</button>
          </div>
        </div>

        ${year.collapsed ? "" : `
          <div class="year-body">
            ${presetsForGrade(year.grade).length > 1 ? `
              <label class="select-field year-schedule-field">
                <span>Schedule</span>
                <select data-action="year-preset" data-year-grade="${year.grade}">
                  ${yearPresetOptions(year.grade, currentPreset.id)}
                </select>
              </label>
            ` : ""}
            ${renderCourseList(currentPreset, presetState, state, "year", year.grade, true)}
          </div>
        `}
      </section>
    `;
  }

  function renderCumulativeWorkspace(state) {
    const usedGrades = new Set(state.cumulativeYears.map((year) => year.grade));
    const availableGrades = CUMULATIVE_GRADES.filter((grade) => !usedGrades.has(grade));
    return `
      <section class="cumulative-workspace" aria-labelledby="cumulative-heading">
        <div class="workspace-header cumulative-header">
          <div>
            <p class="section-label">Up to eight semesters</p>
            <h2 id="cumulative-heading">Cumulative GPA</h2>
            <p>Semester 1 and Semester 2 are calculated separately, then averaged.</p>
          </div>
          <div class="cumulative-actions">
            <label class="add-year-control">
              ${icon("plus")}
              <span class="sr-only">Add a school year</span>
              <select data-action="add-year" ${availableGrades.length === 0 ? "disabled" : ""}>
                <option value="">${availableGrades.length === 0 ? "All years added" : "Add year"}</option>
                ${availableGrades.map((grade) => `<option value="${grade}">Grade ${grade}</option>`).join("")}
              </select>
            </label>
            ${renderFormatControl(state, "cumulative")}
            <button class="text-button" type="button" data-action="reset-cumulative">${icon("reset")}<span>Reset all</span></button>
          </div>
        </div>

        ${state.cumulativeYears.length === 0 ? `
          <div class="empty-state">
            <p>No school years added.</p>
            <span>Use “Add year” to begin.</span>
          </div>
        ` : `<div class="year-list">${state.cumulativeYears.map((year) => renderYearCard(year, state)).join("")}</div>`}
      </section>
    `;
  }

  function renderResults(state) {
    const entries = calculationEntries(state);
    const totals = computeCumulativeTotals(entries);
    const uc = computeUCGPA(entries);
    const shsidWeightedMaximum = shsidWeightedMaximumForState(state);
    const totalSemesterCount = state.mode === "single" ? 1 : entries.length;
    const contextLabel = state.mode === "single"
      ? `${getPresetById(state.singlePresetId).name} · one semester`
      : `${totals.semesterCount}/${totalSemesterCount} semesters entered`;
    const progressPercent = totals.totalCourses > 0
      ? Math.round((totals.selectedCourses / totals.totalCourses) * 100)
      : 0;
    const hasGrades = totals.selectedCourses > 0;

    return `
      <div class="result-inner">
        <div class="result-heading">
          <p>${escapeHtml(contextLabel)}</p>
          <span title="${escapeHtml(CATALOG_META.version)}">Local credit table</span>
        </div>

        <div class="primary-result">
          <span class="result-value">${formatGPA(totals.weightedGPA)}</span>
          <span class="result-name">SHSID weighted</span>
          <small>${hasGrades
            ? state.mode === "single"
              ? "Weighted by SHSID course credits"
              : "Mean of entered semester GPAs"
            : "Enter a grade to begin"}</small>
        </div>

        <section class="scale-block" aria-label="Current GPA compared with the full-schedule maximum">
          <div class="scale-heading">
            <span>Current / maximum</span>
            <small>Full-schedule ceiling</small>
          </div>
          <dl class="scale-metrics">
            <div>
              <dt>SHSID weighted</dt>
              <dd><strong>${formatGPA(totals.weightedGPA)}</strong><span>/ ${formatGPA(shsidWeightedMaximum)}</span></dd>
            </div>
            <div>
              <dt>Unweighted</dt>
              <dd><strong>${formatGPA(totals.unweightedGPA)}</strong><span>/ ${formatGPA(GPA_SCALE_MAXIMA.unweighted)}</span></dd>
            </div>
            <div>
              <dt>UC capped</dt>
              <dd><strong>${formatGPA(uc.cappedWeighted)}</strong><span>/ ${formatGPA(GPA_SCALE_MAXIMA.ucCapped)}</span></dd>
            </div>
          </dl>
          <p>SHSID max follows the selected complete schedule. UC max uses ${UC_CAPPED_SCHOOL_MAXIMUM.aGSemesters} counted semesters and all ${UC_CAPPED_SCHOOL_MAXIMUM.honorsPoints} honors points.</p>
        </section>

        <div class="completion-block">
          <div><span>Grades entered</span><strong>${totals.selectedCourses}/${totals.totalCourses}</strong></div>
          <div class="progress-track" role="progressbar" aria-label="Grades entered" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}"><span style="width: ${progressPercent}%"></span></div>
        </div>

        <details class="math-details">
          <summary><span>Breakdown</span><span class="details-toggle-icon" aria-hidden="true"></span></summary>
          <div class="math-body">
            ${totals.semesterResults.length > 0 ? `
              <div class="semester-results">
                ${totals.semesterResults.map((semester) => `
                  <div><span>${escapeHtml(semester.label ?? "Semester")}</span><strong>${formatGPA(semester.weightedGPA)}</strong></div>
                `).join("")}
              </div>
            ` : ""}
            <dl>
              <div><dt>Semesters counted</dt><dd>${totals.semesterCount}</dd></div>
              <div><dt>UC unweighted</dt><dd>${formatGPA(uc.unweighted)}</dd></div>
              <div><dt>UC uncapped</dt><dd>${formatGPA(uc.uncappedWeighted)}</dd></div>
              <div><dt>UC honors used / earned</dt><dd>${uc.cappedHonorsSemesters}/${uc.honorsSemesters}</dd></div>
            </dl>
            <p>${state.mode === "single"
              ? "The SHSID GPA uses the local course-credit table; unweighted courses count equally."
              : "Cumulative SHSID and unweighted GPAs are the arithmetic mean of the entered semester GPAs. Blank semesters are excluded."}</p>
          </div>
        </details>

        <p class="result-footnote">Private estimate only. SHSID transcripts sent to colleges do not report GPA or class rank.</p>
      </div>
    `;
  }

  function motionAllowed() {
    return !global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  function animateElement(element, keyframes, options) {
    if (!motionAllowed() || typeof element?.animate !== "function") return;
    element.animate(keyframes, options);
  }

  function renderResultsPanel(documentRef, state, animateChange = false) {
    const resultsPanel = documentRef.getElementById("results-panel");
    const previousValue = resultsPanel.querySelector(".result-value")?.textContent;
    const breakdownWasOpen = Boolean(resultsPanel.querySelector(".math-details")?.open);
    resultsPanel.innerHTML = renderResults(state);

    const details = resultsPanel.querySelector(".math-details");
    if (breakdownWasOpen && details) details.open = true;

    const resultValue = resultsPanel.querySelector(".result-value");
    if (animateChange && previousValue !== resultValue?.textContent) {
      animateElement(resultValue, [
        { opacity: 0.35, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], {
        duration: 180,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      });
    }

    const totals = computeCumulativeTotals(calculationEntries(state));
    documentRef.getElementById("live-status").textContent = totals.weightedGPA === null
      ? "No grades selected."
      : `Weighted GPA ${formatGPA(totals.weightedGPA)}. Unweighted GPA ${formatGPA(totals.unweightedGPA)}.`;
  }

  function applyTheme(documentRef, state) {
    documentRef.documentElement.dataset.theme = state.theme;
    documentRef.documentElement.style.colorScheme = state.theme;
    documentRef.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      state.theme === "dark" ? "#131310" : "#f4f4f1"
    );
    const themeButton = documentRef.getElementById("theme-toggle");
    if (!themeButton) return;
    const nextTheme = state.theme === "dark" ? "light" : "dark";
    themeButton.innerHTML = icon(state.theme === "dark" ? "sun" : "moon");
    themeButton.setAttribute("aria-label", `Use ${nextTheme} theme`);
    themeButton.title = `Use ${nextTheme} theme`;
  }

  function renderApp(documentRef, state, options = {}) {
    applyTheme(documentRef, state);
    documentRef.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === state.mode;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle("is-active", active);
    });

    const workspace = documentRef.getElementById("calculator-workspace");
    workspace.setAttribute("aria-labelledby", `mode-${state.mode}-tab`);
    workspace.innerHTML = state.mode === "single" ? renderSingleWorkspace(state) : renderCumulativeWorkspace(state);
    renderResultsPanel(documentRef, state, Boolean(options.animateResults));

    if (options.animateWorkspace) {
      animateElement(workspace, [
        { opacity: 0.45, transform: "translateY(7px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      });
    }
  }

  function stateContextForTarget(state, target) {
    if (target.dataset.scope === "single") {
      const currentPreset = getPresetById(state.singlePresetId);
      return { currentPreset, presetState: getSinglePresetState(state), kind: "single" };
    }
    const grade = Number(target.dataset.yearGrade);
    const year = state.cumulativeYears.find((item) => item.grade === grade);
    if (!year) return null;
    return { currentPreset: getPresetById(year.presetId), presetState: getYearPresetState(year), kind: "year" };
  }

  function updateCourseRow(state, target) {
    const context = stateContextForTarget(state, target);
    const subjectIndex = Number(target.dataset.subjectIndex);
    if (!context || !Number.isInteger(subjectIndex)) return;

    if (target.dataset.action === "level") {
      target.closest(".course-row")?.querySelectorAll('[data-action="level"]').forEach((control) => {
        if (control === target) return;
        if (control.type === "radio") control.checked = control.value === target.value;
        else control.value = target.value;
      });
    }

    const selectedInput = context.presetState.inputs[subjectIndex];
    const isComplete = context.kind === "single"
      ? Number.isInteger(selectedInput?.scoreIndex)
      : selectedInput?.scoreIndices.some((scoreIndex) => Number.isInteger(scoreIndex));
    const courseRow = target.closest(".course-row");
    courseRow?.classList.toggle("is-complete", Boolean(isComplete));

    if (target.dataset.action === "level") {
      const currentSubject = context.currentPreset.subjects[subjectIndex];
      const levelValue = selectedLevel(currentSubject, selectedInput);
      const courseMeta = courseRow?.querySelector(".course-meta");
      if (courseMeta) {
        const yearGrade = context.kind === "single" ? context.currentPreset.grade : Number(target.dataset.yearGrade);
        courseMeta.innerHTML = `
          <span>${escapeHtml(levelValue.weight)} credits</span>
          ${renderUcMarker(currentSubject, context.presetState, subjectIndex, yearGrade)}
        `;
      }
    }

    if (context.kind === "year") {
      const selectedCount = context.presetState.inputs.reduce((sum, input) => (
        sum + input.scoreIndices.filter((scoreIndex) => Number.isInteger(scoreIndex)).length
      ), 0);
      const summary = target.closest(".year-section")?.querySelector(".year-summary");
      if (summary) summary.textContent = `${selectedCount}/${context.currentPreset.subjects.length * SEMESTERS.length} semester grades`;
    }
  }

  function bindUI(documentRef) {
    let state = loadState();
    const persistAndRender = (options = {}) => {
      saveState(state);
      if (options.resultsOnly) {
        updateCourseRow(state, options.target);
        renderResultsPanel(documentRef, state, true);
        return;
      }
      renderApp(documentRef, state, {
        animateResults: true,
        animateWorkspace: Boolean(options.animateWorkspace)
      });
    };

    documentRef.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.mode = button.dataset.mode;
        persistAndRender({ animateWorkspace: true });
      });
    });

    documentRef.querySelector("[role='tablist']")?.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...documentRef.querySelectorAll("[data-mode]")];
      const currentIndex = tabs.indexOf(event.target);
      if (currentIndex < 0) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });

    documentRef.getElementById("theme-toggle").addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      saveState(state);
      applyTheme(documentRef, state);
    });

    documentRef.body.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-action]");
      if (!target || !target.matches("button")) return;
      const action = target.dataset.action;

      if (action === "reset-single") {
        const currentPreset = getPresetById(state.singlePresetId);
        if (global.confirm?.(`Reset every Grade ${currentPreset.grade} input?`) === false) return;
        state.byPreset[currentPreset.id] = createSinglePresetState(currentPreset);
      } else if (action === "reset-cumulative") {
        if (global.confirm?.("Reset every added year and semester grade?") === false) return;
        state.cumulativeYears = state.cumulativeYears.map((year) => createYearState(year.grade));
      } else if (action === "reset-year") {
        const grade = Number(target.dataset.yearGrade);
        const year = state.cumulativeYears.find((item) => item.grade === grade);
        if (!year || global.confirm?.(`Reset both Grade ${grade} semesters?`) === false) return;
        const currentPreset = getPresetById(year.presetId);
        year.byPreset[currentPreset.id] = createCumulativePresetState(currentPreset);
      } else if (action === "remove-year") {
        const grade = Number(target.dataset.yearGrade);
        if (global.confirm?.(`Remove Grade ${grade} and both semesters?`) === false) return;
        state.cumulativeYears = state.cumulativeYears.filter((item) => item.grade !== grade);
      } else if (action === "toggle-year") {
        const grade = Number(target.dataset.yearGrade);
        const year = state.cumulativeYears.find((item) => item.grade === grade);
        if (!year) return;
        year.collapsed = !year.collapsed;
      } else {
        return;
      }
      persistAndRender({ animateWorkspace: action === "toggle-year" || action === "remove-year" });
    });

    documentRef.body.addEventListener("change", (event) => {
      const target = event.target;
      const action = target?.dataset?.action;
      if (!action) return;
      let renderOptions = {};

      if (action === "score-format") {
        state.scoreFormat = target.value === "letter" ? "letter" : "percentage";
        renderOptions.animateWorkspace = true;
      } else if (action === "single-preset") {
        state.singlePresetId = getPresetById(target.value).id;
        renderOptions.animateWorkspace = true;
      } else if (action === "year-preset") {
        const grade = Number(target.dataset.yearGrade);
        const year = state.cumulativeYears.find((item) => item.grade === grade);
        const validPreset = presetsForGrade(grade).find((currentPreset) => currentPreset.id === target.value);
        if (!year || !validPreset) return;
        year.presetId = validPreset.id;
        year.byPreset[validPreset.id] ??= createCumulativePresetState(validPreset);
        renderOptions.animateWorkspace = true;
      } else if (action === "add-year") {
        const grade = Number(target.value);
        if (!CUMULATIVE_GRADES.includes(grade) || state.cumulativeYears.some((year) => year.grade === grade)) return;
        state.cumulativeYears.push(createYearState(grade));
        state.cumulativeYears.sort((a, b) => a.grade - b.grade);
        renderOptions.animateWorkspace = true;
      } else if (["course-name", "level", "score", "semester-score"].includes(action)) {
        const context = stateContextForTarget(state, target);
        const subjectIndex = Number(target.dataset.subjectIndex);
        if (!context || !Number.isInteger(subjectIndex) || !context.currentPreset.subjects[subjectIndex]) return;

        if (action === "course-name") {
          context.presetState.nameChoices[subjectIndex] = Number(target.value);
          renderOptions.animateWorkspace = true;
        } else if (action === "level") {
          context.presetState.inputs[subjectIndex].levelIndex = Number(target.value);
          renderOptions = { resultsOnly: true, target };
        } else if (action === "score" && context.kind === "single") {
          context.presetState.inputs[subjectIndex].scoreIndex = target.value === "" ? null : Number(target.value);
          renderOptions = { resultsOnly: true, target };
        } else if (action === "semester-score" && context.kind === "year") {
          const semesterIndex = Number(target.dataset.semesterIndex);
          if (!SEMESTERS[semesterIndex]) return;
          context.presetState.inputs[subjectIndex].scoreIndices[semesterIndex] = target.value === "" ? null : Number(target.value);
          renderOptions = { resultsOnly: true, target };
        }
      } else {
        return;
      }
      persistAndRender(renderOptions);
    });

    renderApp(documentRef, state);
  }

  const api = {
    ...catalog,
    STORAGE_KEY,
    CUMULATIVE_GRADES,
    SEMESTERS,
    getPresetById,
    presetsForGrade,
    createPresetState: createSinglePresetState,
    createSinglePresetState,
    createCumulativePresetState,
    createYearState,
    createDefaultState,
    sanitizePresetState: sanitizeSinglePresetState,
    sanitizeSinglePresetState,
    sanitizeCumulativePresetState,
    sanitizeState,
    semesterInputs,
    calculationEntries,
    shsidWeightedMaximumForState,
    courseCategory,
    orderedSubjectEntries
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.GPACalculator = api;

  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", () => bindUI(global.document));
    } else {
      bindUI(global.document);
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
