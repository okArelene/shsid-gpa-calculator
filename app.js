(function initGPACalculator(global) {
  "use strict";

  const catalog = global.SHSIDCatalog || (typeof require !== "undefined" ? require("./catalog.js") : null);
  if (!catalog) throw new Error("SHSID catalog failed to load.");

  const STORAGE_KEY = "shsid-gpa-calculator-v5";
  const LEGACY_STORAGE_KEYS = [
    "shsid-gpa-calculator-v4",
    "shsid-gpa-calculator-v3",
    "shsid-gpa-calculator-v2",
    "shsid-gpa-calculator-v1"
  ];
  const STATE_VERSION = 5;
  const LEGACY_IB_SCORE_INDEX_MAP = [2, 3, 4, 4, 5, 5, 6, 6];
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
    IB_SCORES,
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
      inputs: currentPreset.subjects.map(() => ({
        levelIndices: [0, 0],
        separateLevels: false,
        scoreIndices: [null, null]
      })),
      nameChoices: currentPreset.subjects.map(() => -1)
    };
  }

  function validLevelIndex(currentPreset, currentSubject, value) {
    if (Number.isInteger(value) && value >= 0 && value < currentSubject.levels.length) return value;
    const lastLevelIndex = currentSubject.levels.length - 1;
    const isRemovedChineseX = [11, 12].includes(currentPreset.grade)
      && currentSubject.name.regular === "Chinese"
      && value === currentSubject.levels.length
      && currentSubject.levels[lastLevelIndex]?.name === "IX";
    return isRemovedChineseX ? lastLevelIndex : 0;
  }

  function validScoreIndex(currentSubject, value) {
    return Number.isInteger(value) && value >= 0 && value < currentSubject.scores.length ? value : null;
  }

  function sanitizedScoreIndex(currentSubject, value, sourceVersion = STATE_VERSION) {
    const migratedValue = sourceVersion < STATE_VERSION
      && currentSubject.scores === IB_SCORES
      && Number.isInteger(value)
      ? LEGACY_IB_SCORE_INDEX_MAP[value]
      : value;
    return validScoreIndex(currentSubject, migratedValue);
  }

  function validNameChoice(currentSubject, value) {
    const choiceCount = currentSubject.alternateNames?.length ?? 0;
    return Number.isInteger(value) && value >= -1 && value < choiceCount ? value : -1;
  }

  function sanitizeSinglePresetState(currentPreset, candidate, sourceVersion = STATE_VERSION) {
    if (!candidate || typeof candidate !== "object") return createSinglePresetState(currentPreset);
    return {
      inputs: currentPreset.subjects.map((currentSubject, subjectIndex) => {
        const saved = candidate.inputs?.[subjectIndex] ?? {};
        return {
          levelIndex: validLevelIndex(currentPreset, currentSubject, saved.levelIndex),
          scoreIndex: sanitizedScoreIndex(currentSubject, saved.scoreIndex, sourceVersion)
        };
      }),
      nameChoices: currentPreset.subjects.map((currentSubject, subjectIndex) => (
        validNameChoice(currentSubject, candidate.nameChoices?.[subjectIndex])
      ))
    };
  }

  function sanitizeCumulativePresetState(currentPreset, candidate, sourceVersion = STATE_VERSION) {
    if (!candidate || typeof candidate !== "object") return createCumulativePresetState(currentPreset);
    return {
      inputs: currentPreset.subjects.map((currentSubject, subjectIndex) => {
        const saved = candidate.inputs?.[subjectIndex] ?? {};
        const savedScores = Array.isArray(saved.scoreIndices)
          ? saved.scoreIndices
          : [saved.scoreIndex, null];
        const savedLevels = Array.isArray(saved.levelIndices)
          ? saved.levelIndices
          : [saved.levelIndex, saved.levelIndex];
        const primaryLevelIndex = validLevelIndex(currentPreset, currentSubject, savedLevels[0]);
        const levelIndices = SEMESTERS.map((_, semesterIndex) => (
          validLevelIndex(
            currentPreset,
            currentSubject,
            savedLevels[semesterIndex] ?? primaryLevelIndex
          )
        ));
        return {
          levelIndices,
          separateLevels: currentSubject.levels.length > 1
            && (Boolean(saved.separateLevels) || levelIndices[0] !== levelIndices[1]),
          scoreIndices: SEMESTERS.map((_, semesterIndex) => (
            sanitizedScoreIndex(currentSubject, savedScores[semesterIndex], sourceVersion)
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

  function addCumulativeYear(state, requestedGrade) {
    const grade = Number(requestedGrade);
    if (!CUMULATIVE_GRADES.includes(grade) || state.cumulativeYears.some((year) => year.grade === grade)) return false;
    state.cumulativeYears.forEach((year) => {
      year.collapsed = true;
    });
    state.cumulativeYears.push(createYearState(grade));
    state.cumulativeYears.sort((first, second) => first.grade - second.grade);
    return true;
  }

  function createDefaultState() {
    return {
      version: STATE_VERSION,
      mode: "single",
      scoreFormat: "percentage",
      theme: "light",
      singlePresetId: "stockshsidgrade10",
      byPreset: Object.fromEntries(presets.map((currentPreset) => [
        currentPreset.id,
        createSinglePresetState(currentPreset)
      ])),
      cumulativeYears: [createYearState(9)]
    };
  }

  function sanitizeYearState(candidate, seenGrades, sourceVersion = STATE_VERSION) {
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
          ?? (candidate.presetId === currentPreset.id ? candidate.presetState : null),
        sourceVersion
      )
    ]));

    return { grade, presetId, collapsed: Boolean(candidate.collapsed), byPreset };
  }

  function sanitizeState(candidate) {
    const fallback = createDefaultState();
    if (!candidate || typeof candidate !== "object") return fallback;
    const sourceVersion = Number.isInteger(candidate.version) ? candidate.version : 1;

    const requestedSingleId = candidate.singlePresetId ?? candidate.presetId;
    const singlePresetId = presets.some((currentPreset) => currentPreset.id === requestedSingleId)
      ? requestedSingleId
      : fallback.singlePresetId;
    const candidateByPreset = candidate.byPreset ?? {};
    const byPreset = Object.fromEntries(presets.map((currentPreset) => [
      currentPreset.id,
      sanitizeSinglePresetState(currentPreset, candidateByPreset[currentPreset.id], sourceVersion)
    ]));

    const seenGrades = new Set();
    const cumulativeYears = Array.isArray(candidate.cumulativeYears)
      ? candidate.cumulativeYears
        .map((year) => sanitizeYearState(year, seenGrades, sourceVersion))
        .filter(Boolean)
        .sort((a, b) => a.grade - b.grade)
      : fallback.cumulativeYears;

    return {
      version: STATE_VERSION,
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
      levelIndex: input.levelIndices?.[semesterIndex] ?? input.levelIndex ?? 0,
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
      plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
      check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>'
    };
    return icons[name] ?? "";
  }

  function presetOptionGroups(selectedId) {
    const grades = [...new Set(presets.map((currentPreset) => currentPreset.grade))];
    return grades.map((grade) => {
      const gradePresets = presetsForGrade(grade);
      if (gradePresets.length === 1) {
        const currentPreset = gradePresets[0];
        return `
          <option value="${escapeHtml(currentPreset.id)}" ${currentPreset.id === selectedId ? "selected" : ""}>
            ${escapeHtml(currentPreset.name)}
          </option>
        `;
      }
      return `
        <optgroup label="Grade ${grade}">
          ${gradePresets.map((currentPreset) => `
            <option value="${escapeHtml(currentPreset.id)}" ${currentPreset.id === selectedId ? "selected" : ""}>
              ${escapeHtml(`${currentPreset.name} · ${currentPreset.subtitle}`)}
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

  function cumulativeLevelIndex(selectedInput, semesterIndex) {
    return selectedInput.levelIndices?.[semesterIndex] ?? selectedInput.levelIndex ?? 0;
  }

  function selectedCumulativeLevels(currentSubject, selectedInput) {
    return SEMESTERS.map((_, semesterIndex) => selectedLevel(currentSubject, {
      levelIndex: cumulativeLevelIndex(selectedInput, semesterIndex)
    }));
  }

  function renderUcMarker(currentSubject, presetState, subjectIndex, yearGrade, cumulative = false) {
    if (yearGrade !== 10 && yearGrade !== 11) return "";
    const choiceIndex = presetState.nameChoices[subjectIndex];
    if (!isSubjectUCEligible(currentSubject, choiceIndex)) return "";
    const selectedInput = presetState.inputs[subjectIndex];
    const levelValues = cumulative
      ? selectedCumulativeLevels(currentSubject, selectedInput)
      : [selectedLevel(currentSubject, selectedInput)];
    const honorsSemesters = levelValues.flatMap((levelValue, semesterIndex) => (
      levelValue?.ucHonors ? [semesterIndex + 1] : []
    ));
    const semesterSuffix = cumulative && honorsSemesters.length === 1
      ? ` S${honorsSemesters[0]}`
      : "";
    const honorsTitle = honorsSemesters.length === 0
      ? ""
      : cumulative && honorsSemesters.length === 1
        ? ` UC honors applies in Semester ${honorsSemesters[0]}.`
        : cumulative
          ? " UC honors applies in both semesters."
          : " UC honors applies automatically.";
    return `
      <span class="uc-marker" title="Automatically included in the UC A–G estimate.${honorsTitle}">
        * A–G${honorsSemesters.length > 0 ? ` · UC +1${semesterSuffix}` : ""}
      </span>
    `;
  }

  function renderCourseMeta(currentSubject, presetState, subjectIndex, yearGrade, cumulative = false) {
    const selectedInput = presetState.inputs[subjectIndex];
    const levelValues = cumulative
      ? selectedCumulativeLevels(currentSubject, selectedInput)
      : [selectedLevel(currentSubject, selectedInput)];
    const weights = levelValues.map((levelValue) => levelValue?.weight ?? 0);
    const creditLabel = cumulative && weights[0] !== weights[1]
      ? `S1 ${weights[0]} cr · S2 ${weights[1]} cr`
      : `${weights[0]} credits`;
    return `
      <span>${escapeHtml(creditLabel)}</span>
      ${renderUcMarker(currentSubject, presetState, subjectIndex, yearGrade, cumulative)}
    `;
  }

  function renderLevelModeButton(currentSubject, selectedInput, subjectIndex, attrs, courseName) {
    if (currentSubject.levels.length <= 1) return "";
    const isSeparate = Boolean(selectedInput.separateLevels);
    const action = isSeparate ? "merge-levels" : "split-levels";
    const label = isSeparate
      ? "Use same level"
      : '<span aria-hidden="true">→</span> Different Level in S2?';
    const ariaLabel = isSeparate
      ? `Use the Semester 1 level for both semesters of ${courseName}`
      : `Use a different Semester 2 level for ${courseName}`;
    return `<button class="level-mode-button" type="button" data-action="${action}" data-subject-index="${subjectIndex}" aria-label="${escapeHtml(ariaLabel)}" ${attrs}>${label}</button>`;
  }

  function renderSharedLevelChoices(
    currentSubject,
    selectedLevelIndex,
    subjectIndex,
    attrs,
    controlId,
    action,
    courseName
  ) {
    const levelLabel = action === "shared-level"
      ? `Level for ${courseName} in both semesters`
      : `Level for ${courseName}`;
    return `
      <div class="level-segments">
        ${currentSubject.levels.map((currentLevel, levelIndex) => `
          <label>
            <input type="radio" name="${controlId}-level" value="${levelIndex}" data-action="${action}" data-subject-index="${subjectIndex}" ${attrs} ${selectedLevelIndex === levelIndex ? "checked" : ""}>
            <span>${escapeHtml(currentLevel.name)}</span>
          </label>
        `).join("")}
      </div>
      <select class="level-select" aria-label="${escapeHtml(levelLabel)}" data-action="${action}" data-subject-index="${subjectIndex}" ${attrs}>
        ${currentSubject.levels.map((currentLevel, levelIndex) => `<option value="${levelIndex}" ${selectedLevelIndex === levelIndex ? "selected" : ""}>${escapeHtml(currentLevel.name)}</option>`).join("")}
      </select>
    `;
  }

  function renderSemesterLevelSelect(
    currentSubject,
    selectedLevelIndex,
    subjectIndex,
    semesterIndex,
    attrs,
    controlId,
    courseName
  ) {
    const semester = semesterIndex + 1;
    return `
      <label class="semester-level-field" for="${controlId}-semester-${semester}-level">
        <span>S${semester}</span>
        <select id="${controlId}-semester-${semester}-level" aria-label="Semester ${semester} level for ${escapeHtml(courseName)}" data-action="semester-level" data-subject-index="${subjectIndex}" data-semester-index="${semesterIndex}" ${attrs}>
          ${currentSubject.levels.map((currentLevel, levelIndex) => `<option value="${levelIndex}" ${selectedLevelIndex === levelIndex ? "selected" : ""}>${escapeHtml(currentLevel.name)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function renderLevelControl(
    currentSubject,
    selectedInput,
    presetState,
    subjectIndex,
    attrs,
    controlId,
    cumulative = false
  ) {
    const courseName = resolvedSubjectName(currentSubject, presetState.nameChoices[subjectIndex]);
    if (cumulative && selectedInput.separateLevels) {
      return `
        <fieldset class="level-control is-semester-specific">
          <legend class="sr-only">Levels for ${escapeHtml(courseName)}</legend>
          <span class="mobile-control-label" aria-hidden="true">Level</span>
          <div class="semester-level-grid">
            ${SEMESTERS.map((_, semesterIndex) => renderSemesterLevelSelect(
              currentSubject,
              cumulativeLevelIndex(selectedInput, semesterIndex),
              subjectIndex,
              semesterIndex,
              attrs,
              controlId,
              courseName
            )).join("")}
          </div>
        </fieldset>
      `;
    }

    const selectedLevelIndex = cumulative
      ? cumulativeLevelIndex(selectedInput, 0)
      : selectedInput.levelIndex;
    return `
      <fieldset class="level-control">
        <legend class="sr-only">Level for ${escapeHtml(courseName)}${cumulative ? " in both semesters" : ""}</legend>
        <div class="shared-level-control">
          <span class="mobile-control-label" aria-hidden="true">Level</span>
          <div class="shared-level-choice">
            ${renderSharedLevelChoices(
              currentSubject,
              selectedLevelIndex,
              subjectIndex,
              attrs,
              controlId,
              cumulative ? "shared-level" : "level",
              courseName
            )}
          </div>
        </div>
      </fieldset>
    `;
  }

  function renderGradeSelect(currentSubject, scoreIndex, state, attrs, controlId, subjectIndex, action, semesterIndex = null) {
    const semesterAttribute = semesterIndex === null ? "" : ` data-semester-index="${semesterIndex}"`;
    const gradeLabel = semesterIndex === null ? "Grade" : `Semester ${semesterIndex + 1} grade`;
    const mobileGradeLabel = semesterIndex === null ? "Grade" : `S${semesterIndex + 1} grade`;
    return `
      <label class="grade-control" for="${controlId}">
        <span class="mobile-control-label" aria-hidden="true">${mobileGradeLabel}</span>
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

            return `
              <article class="course-row ${isComplete ? "is-complete" : ""}">
                <div class="course-identity">
                  ${renderCourseName(currentPreset, presetState, currentSubject, subjectIndex, attrs, controlId)}
                  <div class="course-meta">
                    ${renderCourseMeta(currentSubject, presetState, subjectIndex, yearGrade, cumulative)}
                    ${cumulative ? renderLevelModeButton(
                      currentSubject,
                      selected,
                      subjectIndex,
                      attrs,
                      resolvedSubjectName(currentSubject, presetState.nameChoices[subjectIndex])
                    ) : ""}
                  </div>
                </div>

                ${renderLevelControl(currentSubject, selected, presetState, subjectIndex, attrs, controlId, cumulative)}

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

  function renderYearBody(year, state, collapsedForMotion = false) {
    const currentPreset = getPresetById(year.presetId);
    const presetState = getYearPresetState(year);

    return `
      <div class="year-body-motion${collapsedForMotion ? " is-collapsed" : ""}"${collapsedForMotion ? ' aria-hidden="true" inert' : ""}>
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
      </div>
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
      <section class="year-section ${year.collapsed ? "is-collapsed" : ""}" data-year-grade="${year.grade}" aria-labelledby="year-${year.grade}-heading">
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

        ${year.collapsed ? "" : renderYearBody(year, state)}
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
            <p>Semesters are calculated separately, then averaged. Changed levels midyear? Use “→ Different Level in S2?” on that course.</p>
          </div>
          <div class="cumulative-actions">
            ${availableGrades.length > 0 ? `
              <div class="grade-level-picker" role="group" aria-label="Add grade level">
                <span class="grade-level-picker-label" aria-hidden="true">${icon("plus")}<span>Add grade</span></span>
                <span class="grade-level-options">
                  ${availableGrades.map((grade) => `
                    <button class="grade-level-option" type="button" data-action="add-year" data-year-grade="${grade}" aria-label="Add Grade ${grade}">${grade}</button>
                  `).join("")}
                </span>
              </div>
            ` : `
              <div class="grade-level-picker is-complete" aria-label="All grade levels added">
                ${icon("check")}<span>All grades added</span>
              </div>
            `}
            ${renderFormatControl(state, "cumulative")}
            <button class="text-button" type="button" data-action="reset-cumulative">${icon("reset")}<span>Reset all</span></button>
          </div>
        </div>

        ${state.cumulativeYears.length === 0 ? `
          <div class="empty-state">
            <p>No school years added.</p>
            <span>Choose a grade level above to begin.</span>
          </div>
        ` : `<div class="year-list">${state.cumulativeYears.map((year) => renderYearCard(year, state)).join("")}</div>`}
      </section>
    `;
  }

  function renderResults(state) {
    const entries = calculationEntries(state);
    const totals = computeCumulativeTotals(entries);
    const uc = state.mode === "cumulative" ? computeUCGPA(entries) : null;
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

        <div class="primary-result${hasGrades ? "" : " is-empty"}">
          ${hasGrades ? `<span class="result-value">${formatGPA(totals.weightedGPA)}</span>` : ""}
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
            ${state.mode === "single" ? `
              <div>
                <dt>UC capped</dt>
                <dd class="metric-unavailable">Not available for semester</dd>
              </div>
            ` : `
              <div>
                <dt>UC capped</dt>
                <dd><strong>${formatGPA(uc.cappedWeighted)}</strong><span>/ ${formatGPA(GPA_SCALE_MAXIMA.ucCapped)}</span></dd>
              </div>
            `}
          </dl>
          <p>${state.mode === "single"
            ? "SHSID max follows the selected complete schedule."
            : `SHSID max follows the selected complete schedule. UC max uses ${UC_CAPPED_SCHOOL_MAXIMUM.aGSemesters} counted semesters and all ${UC_CAPPED_SCHOOL_MAXIMUM.honorsPoints} honors points.`}</p>
        </section>

        <div class="completion-block">
          <div><span>Grades entered</span><strong>${totals.selectedCourses}/${totals.totalCourses}</strong></div>
          <div class="progress-track" role="progressbar" aria-label="Grades entered" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}"><span style="width: ${progressPercent}%"></span></div>
        </div>

        <details class="math-details">
          <summary><span>Breakdown</span><span class="details-toggle-icon" aria-hidden="true"></span></summary>
          <div class="math-body">
            ${totals.semesterResults.length > 0 ? `
              <table class="semester-results">
                <caption class="sr-only">Semester weighted and unweighted GPA breakdown</caption>
                <thead>
                  <tr>
                    <th scope="col">Semester</th>
                    <th scope="col"><span aria-label="Weighted GPA, then unweighted GPA">W / UW</span></th>
                  </tr>
                </thead>
                <tbody>
                  ${totals.semesterResults.map((semester) => `
                    <tr>
                      <th scope="row">${escapeHtml(semester.label ?? "Semester")}</th>
                      <td><strong>${formatGPA(semester.weightedGPA)} <span aria-hidden="true">/</span> ${formatGPA(semester.unweightedGPA)}</strong></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            ` : ""}
            <dl>
              <div><dt>Semesters counted</dt><dd>${totals.semesterCount}</dd></div>
              ${state.mode === "cumulative" ? `
                <div><dt>UC unweighted</dt><dd>${formatGPA(uc.unweighted)}</dd></div>
                <div><dt>UC uncapped</dt><dd>${formatGPA(uc.uncappedWeighted)}</dd></div>
                <div><dt>UC honors used / earned</dt><dd>${uc.cappedHonorsSemesters}/${uc.honorsSemesters}</dd></div>
              ` : ""}
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

    if (Number.isInteger(options.revealYearGrade)) {
      const yearSection = workspace.querySelector(`.year-section[data-year-grade="${options.revealYearGrade}"]`);
      const yearToggle = yearSection?.querySelector(".year-toggle");
      animateElement(yearSection, [
        { opacity: 0.35, transform: "translateY(-8px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      });
      documentRef.getElementById("live-status").textContent = `Grade ${options.revealYearGrade} added.`;

      const revealYear = () => {
        yearSection?.scrollIntoView({
          behavior: motionAllowed() ? "smooth" : "auto",
          block: "nearest"
        });
        yearToggle?.focus({ preventScroll: true });
      };
      if (typeof global.requestAnimationFrame === "function") global.requestAnimationFrame(revealYear);
      else revealYear();
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

    if (["level", "shared-level"].includes(target.dataset.action)) {
      target.closest(".course-row")?.querySelectorAll(`[data-action="${target.dataset.action}"]`).forEach((control) => {
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

    if (["level", "shared-level", "semester-level"].includes(target.dataset.action)) {
      const currentSubject = context.currentPreset.subjects[subjectIndex];
      const courseMeta = courseRow?.querySelector(".course-meta");
      if (courseMeta) {
        const yearGrade = context.kind === "single" ? context.currentPreset.grade : Number(target.dataset.yearGrade);
        const attrs = contextAttributes(context.kind === "year" ? "year" : "single", yearGrade);
        const courseName = resolvedSubjectName(
          currentSubject,
          context.presetState.nameChoices[subjectIndex]
        );
        courseMeta.innerHTML = renderCourseMeta(
          currentSubject,
          context.presetState,
          subjectIndex,
          yearGrade,
          context.kind === "year"
        ) + (context.kind === "year"
          ? renderLevelModeButton(currentSubject, selectedInput, subjectIndex, attrs, courseName)
          : "");
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

  const yearBodyMotions = new WeakMap();

  function beginYearBodyMotion(yearSection) {
    yearBodyMotions.get(yearSection)?.cleanup?.();
    const motion = { cleanup: null };
    yearBodyMotions.set(yearSection, motion);
    return motion;
  }

  function settleYearBodyMotion(yearSection, bodyMotion, year, motion) {
    let timeoutId;
    const cleanup = () => {
      bodyMotion.removeEventListener("transitionend", finish);
      if (timeoutId !== undefined && typeof global.clearTimeout === "function") {
        global.clearTimeout(timeoutId);
      }
    };
    const finish = (event) => {
      if (event && (event.target !== bodyMotion || event.propertyName !== "grid-template-rows")) return;
      cleanup();
      if (yearBodyMotions.get(yearSection) !== motion) return;
      yearBodyMotions.delete(yearSection);
      if (year.collapsed) bodyMotion.remove();
    };

    motion.cleanup = cleanup;
    bodyMotion.addEventListener("transitionend", finish);
    if (typeof global.setTimeout === "function") timeoutId = global.setTimeout(finish, 320);
  }

  function updateYearCollapse(documentRef, state, year, toggle) {
    const yearSection = toggle.closest(".year-section");
    if (!yearSection) {
      renderApp(documentRef, state);
      return;
    }

    yearSection.classList.toggle("is-collapsed", year.collapsed);
    toggle.setAttribute("aria-expanded", String(!year.collapsed));

    const shouldAnimate = motionAllowed();
    const motion = beginYearBodyMotion(yearSection);
    let bodyMotion = yearSection.querySelector(".year-body-motion");

    if (year.collapsed) {
      if (bodyMotion && shouldAnimate) {
        bodyMotion.setAttribute("aria-hidden", "true");
        bodyMotion.setAttribute("inert", "");
        bodyMotion.classList.add("is-collapsed");
        settleYearBodyMotion(yearSection, bodyMotion, year, motion);
      } else {
        bodyMotion?.remove();
        yearBodyMotions.delete(yearSection);
      }
    } else {
      const insertedBody = !bodyMotion;
      if (insertedBody) {
        yearSection.insertAdjacentHTML("beforeend", renderYearBody(year, state, shouldAnimate));
        bodyMotion = yearSection.querySelector(".year-body-motion");
      }

      if (bodyMotion) {
        bodyMotion.removeAttribute("aria-hidden");
        bodyMotion.removeAttribute("inert");
        if (shouldAnimate) {
          if (insertedBody) bodyMotion.getBoundingClientRect();
          bodyMotion.classList.remove("is-collapsed");
          settleYearBodyMotion(yearSection, bodyMotion, year, motion);
        } else {
          bodyMotion.classList.remove("is-collapsed");
          yearBodyMotions.delete(yearSection);
        }
      }
    }

    documentRef.getElementById("live-status").textContent = `Grade ${year.grade} ${year.collapsed ? "collapsed" : "expanded"}.`;
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
        animateWorkspace: Boolean(options.animateWorkspace),
        revealYearGrade: options.revealYearGrade
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
        saveState(state);
        updateYearCollapse(documentRef, state, year, target);
        return;
      } else if (action === "add-year") {
        const grade = Number(target.dataset.yearGrade);
        if (!addCumulativeYear(state, grade)) return;
        persistAndRender({ revealYearGrade: grade });
        return;
      } else if (["split-levels", "merge-levels"].includes(action)) {
        const context = stateContextForTarget(state, target);
        const subjectIndex = Number(target.dataset.subjectIndex);
        if (!context || context.kind !== "year" || !Number.isInteger(subjectIndex)) return;
        const selectedInput = context.presetState.inputs[subjectIndex];
        if (!selectedInput) return;
        if (action === "split-levels") {
          selectedInput.separateLevels = true;
          selectedInput.levelIndices[1] = selectedInput.levelIndices[0];
        } else {
          selectedInput.levelIndices[1] = selectedInput.levelIndices[0];
          selectedInput.separateLevels = false;
        }
        const grade = Number(target.dataset.yearGrade);
        persistAndRender();
        const focusSelector = action === "split-levels"
          ? `[data-action="semester-level"][data-year-grade="${grade}"][data-subject-index="${subjectIndex}"][data-semester-index="1"]`
          : `[data-action="split-levels"][data-year-grade="${grade}"][data-subject-index="${subjectIndex}"]`;
        documentRef.querySelector(focusSelector)?.focus();
        return;
      } else {
        return;
      }
      persistAndRender({ animateWorkspace: action === "remove-year" });
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
      } else if (["course-name", "level", "shared-level", "semester-level", "score", "semester-score"].includes(action)) {
        const context = stateContextForTarget(state, target);
        const subjectIndex = Number(target.dataset.subjectIndex);
        if (!context || !Number.isInteger(subjectIndex) || !context.currentPreset.subjects[subjectIndex]) return;

        if (action === "course-name") {
          context.presetState.nameChoices[subjectIndex] = Number(target.value);
          renderOptions.animateWorkspace = true;
        } else if (action === "level") {
          context.presetState.inputs[subjectIndex].levelIndex = Number(target.value);
          renderOptions = { resultsOnly: true, target };
        } else if (action === "shared-level" && context.kind === "year") {
          const levelIndex = Number(target.value);
          context.presetState.inputs[subjectIndex].levelIndices = [levelIndex, levelIndex];
          renderOptions = { resultsOnly: true, target };
        } else if (action === "semester-level" && context.kind === "year") {
          const semesterIndex = Number(target.dataset.semesterIndex);
          if (!SEMESTERS[semesterIndex]) return;
          context.presetState.inputs[subjectIndex].levelIndices[semesterIndex] = Number(target.value);
          context.presetState.inputs[subjectIndex].separateLevels = true;
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
    addCumulativeYear,
    createDefaultState,
    sanitizePresetState: sanitizeSinglePresetState,
    sanitizeSinglePresetState,
    sanitizeCumulativePresetState,
    sanitizeState,
    semesterInputs,
    calculationEntries,
    shsidWeightedMaximumForState,
    renderCumulativeWorkspace,
    renderResults,
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
