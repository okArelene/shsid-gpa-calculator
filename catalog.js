(function initSHSIDCatalog(global) {
  "use strict";

  const CATALOG_META = {
    id: "shsid-original-rules-2024",
    title: "SHSID GPA rules",
    version: "Original calculator credit table",
    note: "Credits and level offsets are kept from the original SHSID calculator in this project. The unverified values from GPA Calculator 3 are intentionally not used."
  };

  const DEFAULT_SCORES = [
    score("<60", "F", 0),
    score("60–67", "C/C-", 2.6),
    score("68–72", "C+", 3.0),
    score("73–77", "B-", 3.3),
    score("78–82", "B", 3.6),
    score("83–87", "B+", 3.9),
    score("88–92", "A-", 4.2),
    score("93+", "A/A+", 4.5)
  ];

  const IB_SCORES = [
    score("1", "F", 0),
    score("2", "F", 0),
    score("3", "F", 0),
    score("4", "C/C-", 2.6),
    score("5", "B-", 3.3),
    score("6", "B+", 3.9),
    score("7", "A/A+", 4.5)
  ];

  const IB_OTHER_SCORES = [
    score("F", "F", 0),
    score("D", "D", 0),
    score("C", "C", 2.5),
    score("B", "B", 4.0),
    score("A", "A", 4.5)
  ];

  const TOK_EE_MATRIX = [
    [0.0, 0.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 2.5, 4.0],
    [0.0, 0.0, 2.5, 2.5, 4.0],
    [0.0, 2.5, 2.5, 4.0, 4.5],
    [0.0, 4.0, 4.0, 4.5, 4.5]
  ];

  const US_UNWEIGHTED_GRADE_POINTS = {
    A: 4,
    B: 3,
    C: 2,
    D: 1,
    F: 0
  };

  function score(percentageName, letterName, baseGPA) {
    return { percentageName, letterName, baseGPA };
  }

  function label(compact, regular = compact, options = {}) {
    return {
      compact,
      regular,
      ...(typeof options.ucEligible === "boolean" ? { ucEligible: options.ucEligible } : {})
    };
  }

  function level(name, weight, offset, options = {}) {
    return {
      name,
      weight,
      offset,
      ucHonors: Boolean(options.ucHonors),
      rigor: options.rigor ?? "school"
    };
  }

  function subject(nameValue, levels, scores, alternateNames = null, options = {}) {
    const name = typeof nameValue === "string" ? label(nameValue) : nameValue;
    return {
      name,
      alternateNames,
      levels,
      scores,
      ucEligible: options.ucEligible ?? !["ToK", "EE"].includes(name.regular)
    };
  }

  function defaultIbOther(name) {
    return subject(
      name,
      [level("IB", 0.5, 0, { ucHonors: true, rigor: "ib" })],
      IB_OTHER_SCORES,
      null,
      { ucEligible: false }
    );
  }

  function defaultIb(name, alternateNames = null) {
    return subject(name, [level("IB", 1.0, 0, { ucHonors: true, rigor: "ib" })], IB_SCORES, alternateNames);
  }

  function defaultEnglish(weight, hasAP) {
    const levels = [
      level("S", weight, -0.5),
      level("S+", weight, -0.4),
      level("H", weight, -0.2),
      level("H+", weight, -0.1)
    ];
    if (hasAP) levels.push(level("AP", weight, 0, { ucHonors: true, rigor: "ap" }));
    return subject("English", levels, DEFAULT_SCORES);
  }

  function defaultChinese(weight, middleLevelName, isMiddleSchoolChinese, hasAP = false) {
    const offsetOffset = isMiddleSchoolChinese ? 0.1 : 0;
    const levels = [
      level("I–II", weight, -0.5 + offsetOffset),
      level("III–IV", weight, -0.4 + offsetOffset),
      level(middleLevelName, weight, -0.3 + offsetOffset),
      level("IX", weight, -0.2 + offsetOffset)
    ];
    if (hasAP) levels.push(level("AP", weight, -0.3 + offsetOffset, { ucHonors: true, rigor: "ap" }));
    return subject("Chinese", levels, DEFAULT_SCORES);
  }

  function defaultOther(nameValue, weight, options) {
    const levels = [level("S", weight, -0.5)];
    if (options.hasSP) levels.push(level("S+", weight, -0.35));
    if (options.hasH) levels.push(level("H", weight, -0.2));
    if (options.hasAL) {
      levels.push(level("A-L", options.alCustomWeight ?? weight, 0, { rigor: "a-level" }));
    }
    if (options.hasAP) {
      levels.push(level("AP", options.apCustomWeight ?? weight, 0, { ucHonors: true, rigor: "ap" }));
    }
    return subject(nameValue, levels, DEFAULT_SCORES, options.alternateNames ?? null, {
      ucEligible: options.ucEligible
    });
  }

  function maxGroup(subjects) {
    return { kind: "max", subjects };
  }

  function doubleGroup(baseGPAMatrix, subjects) {
    return { kind: "double", baseGPAMatrix, subjects };
  }

  function normalizeGroup(group) {
    return group.kind ? group : { kind: "subject", subjects: [group] };
  }

  function preset(id, name, config) {
    const subjectGroups = config.subjectComputeGroups.map(normalizeGroup);
    const subjects = subjectGroups.flatMap((group) => group.subjects);
    return {
      id,
      name,
      grade: config.grade,
      track: config.track ?? "school",
      subtitle: config.subtitle ?? `${subjects.length} courses`,
      subjectGroups,
      subjects
    };
  }

  function buildPresets() {
    const g10ElectivesChoiceMod1 = [label("Biology"), label("Chemistry"), label("Physics")];
    const g10ElectivesChoiceMod2 = [
      label("Economics"),
      label("Geography"),
      label("ITCS", "Computer Science"),
      label("Music"),
      label("VA", "Visual Arts"),
      label("Drama")
    ];

    const g11Math = defaultOther("Math", 6, { hasSP: false, hasH: true, hasAL: true, hasAP: true });
    const g11English = defaultEnglish(6, true);
    const module2Options = [label("Biology"), label("Chemistry"), label("Physics")];
    const module3Options = [
      label("US Overview"),
      label("Human Geo", "Human Geography"),
      label("Chi History", "Chinese History"),
      label("West Civ", "Western Civilization"),
      label("Psychology"),
      label("ITCS", "Computer Science"),
      label("Art"),
      label("US History"),
      label("World H", "World History"),
      label("Economics"),
      label("Art History")
    ];
    const module4Options = [
      label("Env. Eng.", "Environmental Engineering"),
      label("Philosophy"),
      label("Writing", "Creative Writing"),
      label("Business", "Business Management"),
      label("Computer", "Computer Skills", { ucEligible: false }),
      label("Law", "Introduction to Law"),
      label("Psychology"),
      label("French"),
      label("Spanish"),
      label("Japanese"),
      label("Music", "Music Theory")
    ];
    const module5Options = [
      label("Opera", "Opera Singing"),
      label("Singing", "Acappella"),
      label("Acting", "Applied Acting"),
      label("Arts 1"),
      label("French"),
      label("Spanish"),
      label("Japanese"),
      label("Economics"),
      label("Env. Sci", "Environmental Science")
    ];
    const module45Options = module4Options.concat(module5Options);
    const g11M1 = defaultOther("Science module", 6, {
      alternateNames: module2Options,
      hasSP: true,
      hasH: true,
      hasAL: true,
      hasAP: true
    });
    const g11M2 = defaultOther("Humanities module", 4.5, {
      alternateNames: module3Options,
      hasSP: true,
      hasH: true,
      hasAL: false,
      hasAP: true
    });
    const g11Chinese = defaultChinese(3, "V–VII/VIII", false);
    const g11M34 = defaultOther("Elective module", 3, {
      alternateNames: module45Options,
      hasSP: true,
      hasH: true,
      hasAL: true,
      hasAP: true,
      alCustomWeight: 6,
      apCustomWeight: 4.5
    });
    const g11M3 = defaultOther("Elective module 1", 3, {
      alternateNames: module4Options,
      hasSP: true,
      hasH: true,
      hasAL: false,
      hasAP: false
    });
    const g11M4 = defaultOther("Elective module 2", 3, {
      alternateNames: module5Options,
      hasSP: true,
      hasH: true,
      hasAL: true,
      hasAP: true,
      alCustomWeight: 6,
      apCustomWeight: 4.5
    });

    const ibElectives = [
      label("Biology"),
      label("Chemistry"),
      label("Economics"),
      label("ESS"),
      label("History"),
      label("ITCS", "Computer Science"),
      label("Music"),
      label("Physics"),
      label("Psych", "Psychology"),
      label("VA", "Visual Arts")
    ];

    const apScheduleTwoSciences = [g11Math, g11English, g11M1, g11M1, g11M2, g11Chinese];
    const apScheduleOneScienceCombined = [g11Math, g11English, g11M1, g11M2, g11M34, g11Chinese];
    const apScheduleOneScienceTwoElectives = [
      g11Math,
      g11English,
      g11M1,
      g11M2,
      maxGroup([g11M3, g11M4]),
      g11Chinese
    ];

    return [
      preset("stockshsidgrade6", "Grade 6", {
        grade: 6,
        subjectComputeGroups: [
          defaultEnglish(6.5, false),
          defaultOther("Math", 6.5, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultChinese(5, "S", true),
          defaultOther("Science", 2.5, { hasSP: true, hasH: false, hasAL: false, hasAP: false }),
          defaultOther("History", 2.5, { hasSP: true, hasH: false, hasAL: false, hasAP: false })
        ]
      }),
      preset("stockshsidgrade7", "Grade 7", {
        grade: 7,
        subjectComputeGroups: [
          defaultEnglish(6, false),
          defaultOther("Math", 6, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultOther("History", 5, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultChinese(5, "S", true),
          defaultOther("Science", 3, { hasSP: true, hasH: false, hasAL: false, hasAP: false })
        ]
      }),
      preset("stockshsidgrade8", "Grade 8", {
        grade: 8,
        subjectComputeGroups: [
          defaultEnglish(6, false),
          defaultOther("Math", 6, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultOther("Geography", 5, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultChinese(5, "S/5–7", true),
          defaultOther("Biology", 3, { hasSP: false, hasH: true, hasAL: false, hasAP: false }),
          defaultOther("Physics", 2.5, { hasSP: false, hasH: true, hasAL: false, hasAP: false })
        ]
      }),
      preset("stockshsidgrade9", "Grade 9", {
        grade: 9,
        subjectComputeGroups: [
          defaultEnglish(6.5, false),
          defaultOther("Math", 6, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultOther("History", 4, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultOther("Chemistry", 3, { hasSP: true, hasH: true, hasAL: false, hasAP: false }),
          defaultChinese(3, "V–VII/VIII", false),
          defaultOther("Elective", 3, {
            alternateNames: [label("Biology"), label("Geography"), label("ITCS", "Computer Science")],
            hasSP: false,
            hasH: true,
            hasAL: false,
            hasAP: false
          }),
          defaultOther("Physics", 3, { hasSP: true, hasH: true, hasAL: false, hasAP: false })
        ]
      }),
      preset("stockshsidgrade10", "Grade 10", {
        grade: 10,
        subjectComputeGroups: [
          defaultEnglish(6, true),
          defaultChinese(3, "V–VII/VIII", false, true),
          defaultOther("Math", 5.5, { hasSP: true, hasH: true, hasAL: false, hasAP: true }),
          defaultOther("History", 4, { hasSP: true, hasH: true, hasAL: false, hasAP: true, apCustomWeight: 5 }),
          defaultOther("Science 1", 4, { alternateNames: g10ElectivesChoiceMod1, hasSP: false, hasH: true, hasAL: false, hasAP: false }),
          defaultOther("Science 2", 4, { alternateNames: g10ElectivesChoiceMod1, hasSP: false, hasH: true, hasAL: false, hasAP: false }),
          defaultOther("Elective", 4, { alternateNames: g10ElectivesChoiceMod2, hasSP: false, hasH: true, hasAL: false, hasAP: true, apCustomWeight: 4 })
        ]
      }),
      preset("stockshsidgrade11-2m2-1m3", "Grade 11", {
        grade: 11,
        track: "ap-a-level",
        subtitle: "AP/A-Level · 2× M1 + 1× M2",
        subjectComputeGroups: apScheduleTwoSciences
      }),
      preset("stockshsidgrade11-1m2-1m3-1m45", "Grade 11", {
        grade: 11,
        track: "ap-a-level",
        subtitle: "AP/A-Level · 1× M1 + M2 + M3/4",
        subjectComputeGroups: apScheduleOneScienceCombined
      }),
      preset("stockshsidgrade11-1m2-1m3-1m4-1m5", "Grade 11", {
        grade: 11,
        track: "ap-a-level",
        subtitle: "AP/A-Level · 1× M1 + M2 + M3 + M4",
        subjectComputeGroups: apScheduleOneScienceTwoElectives
      }),
      preset("stockshsidgrade11-ib", "Grade 11", {
        grade: 11,
        track: "ib",
        subtitle: "IB · without EE",
        subjectComputeGroups: [
          defaultIb("Math"),
          defaultIb("English"),
          defaultIb("Chinese"),
          defaultIb("Elective 1", ibElectives),
          defaultIb("Elective 2", ibElectives),
          defaultIb("Elective 3", ibElectives),
          defaultIbOther("ToK")
        ]
      }),
      preset("stockshsidgrade11-ibee", "Grade 11", {
        grade: 11,
        track: "ib",
        subtitle: "IB · with EE",
        subjectComputeGroups: [
          defaultIb("Math"),
          defaultIb("English"),
          defaultIb("Chinese"),
          defaultIb("Elective 1", ibElectives),
          defaultIb("Elective 2", ibElectives),
          defaultIb("Elective 3", ibElectives),
          doubleGroup(TOK_EE_MATRIX, [defaultIbOther("ToK"), defaultIbOther("EE")])
        ]
      }),
      preset("stockshsidgrade12-2m2-1m3", "Grade 12", {
        grade: 12,
        track: "ap-a-level",
        subtitle: "AP/A-Level · 2× M1 + 1× M2",
        subjectComputeGroups: apScheduleTwoSciences
      }),
      preset("stockshsidgrade12-1m2-1m3-1m45", "Grade 12", {
        grade: 12,
        track: "ap-a-level",
        subtitle: "AP/A-Level · 1× M1 + M2 + M3/4",
        subjectComputeGroups: apScheduleOneScienceCombined
      }),
      preset("stockshsidgrade12-1m2-1m3-1m4-1m5", "Grade 12", {
        grade: 12,
        track: "ap-a-level",
        subtitle: "AP/A-Level · 1× M1 + M2 + M3 + M4",
        subjectComputeGroups: apScheduleOneScienceTwoElectives
      }),
      preset("stockshsidgrade12-ibee", "Grade 12", {
        grade: 12,
        track: "ib",
        subtitle: "IB",
        subjectComputeGroups: [
          defaultIb("Math"),
          defaultIb("English"),
          defaultIb("Chinese"),
          defaultIb("Elective 1", ibElectives),
          defaultIb("Elective 2", ibElectives),
          defaultIb("Elective 3", ibElectives),
          doubleGroup(TOK_EE_MATRIX, [defaultIbOther("ToK"), defaultIbOther("EE")])
        ]
      })
    ];
  }

  const presets = buildPresets();

  function ucSubjectStates(currentSubject) {
    const choiceIndexes = currentSubject.alternateNames
      ? currentSubject.alternateNames.map((_, index) => index)
      : [-1];
    const states = new Map();

    choiceIndexes.forEach((choiceIndex) => {
      const eligible = isSubjectUCEligible(currentSubject, choiceIndex);
      currentSubject.levels.forEach((currentLevel) => {
        const honors = eligible && Boolean(currentLevel.ucHonors);
        const key = `${Number(eligible)}:${Number(honors)}`;
        states.set(key, { eligible, honors });
      });
    });

    return [...states.values()];
  }

  function deriveUCYearOutcomes(currentPreset) {
    let outcomes = [{ aGCourses: 0, honorsCourses: 0 }];

    currentPreset.subjects.forEach((currentSubject) => {
      const nextOutcomes = new Map();
      outcomes.forEach((outcome) => {
        ucSubjectStates(currentSubject).forEach((subjectState) => {
          const candidate = {
            aGCourses: outcome.aGCourses + Number(subjectState.eligible),
            honorsCourses: outcome.honorsCourses + Number(subjectState.honors)
          };
          nextOutcomes.set(`${candidate.aGCourses}:${candidate.honorsCourses}`, candidate);
        });
      });
      outcomes = [...nextOutcomes.values()];
    });

    return outcomes;
  }

  function deriveUCCappedSchoolMaximum(currentPresets) {
    const topGradePoints = Math.max(...Object.values(US_UNWEIGHTED_GRADE_POINTS));
    const grade10Presets = currentPresets.filter((currentPreset) => currentPreset.grade === 10);
    const grade11Presets = currentPresets.filter((currentPreset) => currentPreset.grade === 11);
    let maximum = {
      gpa: topGradePoints,
      aGSemesters: 0,
      honorsPoints: 0,
      grade10PresetId: null,
      grade11PresetId: null
    };

    grade10Presets.forEach((grade10Preset) => {
      deriveUCYearOutcomes(grade10Preset).forEach((grade10Outcome) => {
        grade11Presets.forEach((grade11Preset) => {
          deriveUCYearOutcomes(grade11Preset).forEach((grade11Outcome) => {
            const aGSemesters = 2 * (grade10Outcome.aGCourses + grade11Outcome.aGCourses);
            if (aGSemesters === 0) return;

            const grade10HonorsPoints = Math.min(4, grade10Outcome.honorsCourses * 2);
            const honorsPoints = Math.min(8, grade10HonorsPoints + grade11Outcome.honorsCourses * 2);
            const gpa = (topGradePoints * aGSemesters + honorsPoints) / aGSemesters;

            if (gpa > maximum.gpa) {
              maximum = {
                gpa,
                aGSemesters,
                honorsPoints,
                grade10PresetId: grade10Preset.id,
                grade11PresetId: grade11Preset.id
              };
            }
          });
        });
      });
    });

    return Object.freeze(maximum);
  }

  function bestScoreIndex(currentSubject) {
    return currentSubject.scores.reduce((bestIndex, currentScore, scoreIndex) => (
      currentScore.baseGPA > currentSubject.scores[bestIndex].baseGPA ? scoreIndex : bestIndex
    ), 0);
  }

  function maximumInputsForPreset(currentPreset) {
    const inputs = currentPreset.subjects.map((currentSubject) => ({
      levelIndex: 0,
      scoreIndex: bestScoreIndex(currentSubject)
    }));
    let subjectIndex = 0;

    currentPreset.subjectGroups.forEach((group) => {
      if (group.kind === "double") {
        let bestPair = { first: 0, second: 0, value: -Infinity };
        group.baseGPAMatrix.forEach((row, first) => {
          row.forEach((value, second) => {
            if (value > bestPair.value) bestPair = { first, second, value };
          });
        });
        inputs[subjectIndex].scoreIndex = bestPair.first;
        inputs[subjectIndex + 1].scoreIndex = bestPair.second;
      }
      subjectIndex += group.subjects.length;
    });

    return inputs;
  }

  function derivePresetWeightedMaximum(currentPreset) {
    const inputs = maximumInputsForPreset(currentPreset);
    let maximum = null;

    function visitLevelCombination(subjectIndex) {
      if (subjectIndex === currentPreset.subjects.length) {
        const totals = computePresetTotals(currentPreset, inputs);
        if (!maximum || totals.gpa > maximum.gpa) {
          maximum = {
            gpa: totals.gpa,
            weightedPoints: totals.weightedPoints,
            credits: totals.totalWeight
          };
        }
        return;
      }

      currentPreset.subjects[subjectIndex].levels.forEach((_, levelIndex) => {
        inputs[subjectIndex].levelIndex = levelIndex;
        visitLevelCombination(subjectIndex + 1);
      });
    }

    visitLevelCombination(0);
    return Object.freeze(maximum);
  }

  function derivePresetWeightedMaxima(currentPresets) {
    return Object.freeze(Object.fromEntries(currentPresets.map((currentPreset) => [
      currentPreset.id,
      derivePresetWeightedMaximum(currentPreset)
    ])));
  }

  function deriveSHSIDWeightedSchoolMaximum(currentPresets, presetMaxima) {
    const gradePresetIds = [9, 10, 11, 12].map((grade) => {
      const gradePresets = currentPresets.filter((currentPreset) => currentPreset.grade === grade);
      return gradePresets.reduce((bestPreset, currentPreset) => (
        presetMaxima[currentPreset.id].gpa > presetMaxima[bestPreset.id].gpa
          ? currentPreset
          : bestPreset
      )).id;
    });
    const gpa = gradePresetIds.reduce((sum, presetId) => sum + presetMaxima[presetId].gpa, 0)
      / gradePresetIds.length;

    return Object.freeze({
      gpa,
      semesters: gradePresetIds.length * 2,
      gradePresetIds: Object.freeze(gradePresetIds)
    });
  }

  function deriveGPAScaleMaxima(shsidWeightedMaximum, ucCappedMaximum) {
    const unweighted = Math.max(...Object.values(US_UNWEIGHTED_GRADE_POINTS));
    return Object.freeze({
      shsidWeighted: shsidWeightedMaximum.gpa,
      unweighted,
      ucCapped: ucCappedMaximum.gpa
    });
  }

  const SHSID_WEIGHTED_PRESET_MAXIMA = derivePresetWeightedMaxima(presets);
  const SHSID_WEIGHTED_SCHOOL_MAXIMUM = deriveSHSIDWeightedSchoolMaximum(
    presets,
    SHSID_WEIGHTED_PRESET_MAXIMA
  );
  const UC_CAPPED_SCHOOL_MAXIMUM = deriveUCCappedSchoolMaximum(presets);
  const GPA_SCALE_MAXIMA = deriveGPAScaleMaxima(
    SHSID_WEIGHTED_SCHOOL_MAXIMUM,
    UC_CAPPED_SCHOOL_MAXIMUM
  );

  function selectedLevel(subjectInput, selected = {}) {
    const levelIndex = Number.isInteger(selected.levelIndex) ? selected.levelIndex : 0;
    return subjectInput.levels[levelIndex] ?? subjectInput.levels[0];
  }

  function selectedScore(subjectInput, selected = {}) {
    return Number.isInteger(selected.scoreIndex) ? subjectInput.scores[selected.scoreIndex] ?? null : null;
  }

  function computeSubjectGPA(subjectInput, selected = {}) {
    const levelValue = selectedLevel(subjectInput, selected);
    const scorePair = selectedScore(subjectInput, selected);
    const weight = levelValue?.weight ?? 0;

    if (!scorePair) {
      return { value: null, weight, weightedValue: 0, selected: false };
    }

    const value = Math.max(scorePair.baseGPA + (levelValue?.offset ?? 0), 0);
    return { value, weight, weightedValue: value * weight, selected: true };
  }

  function computeGroupGPA(group, inputSlice) {
    if (group.kind === "double") {
      const firstScore = selectedScore(group.subjects[0], inputSlice[0]);
      const secondScore = selectedScore(group.subjects[1], inputSlice[1]);
      const weight = group.subjects[0].levels[0].weight;
      if (!firstScore || !secondScore) {
        return { value: null, weight, weightedValue: 0, selected: false };
      }
      const value = group.baseGPAMatrix[inputSlice[0].scoreIndex][inputSlice[1].scoreIndex];
      return { value, weight, weightedValue: value * weight, selected: true };
    }

    if (group.kind === "max") {
      const candidates = group.subjects
        .map((currentSubject, index) => computeSubjectGPA(currentSubject, inputSlice[index]))
        .filter((result) => result.selected);
      if (candidates.length === 0) {
        const weight = selectedLevel(group.subjects[0], inputSlice[0])?.weight ?? 0;
        return { value: null, weight, weightedValue: 0, selected: false };
      }
      return candidates.reduce((best, current) => current.weightedValue > best.weightedValue ? current : best);
    }

    return computeSubjectGPA(group.subjects[0], inputSlice[0]);
  }

  function computePresetTotals(currentPreset, inputs) {
    let inputIndex = 0;
    let weightedPoints = 0;
    let totalWeight = 0;
    let completedGroups = 0;

    currentPreset.subjectGroups.forEach((group) => {
      const subjectCount = group.subjects.length;
      const inputSlice = inputs.slice(inputIndex, inputIndex + subjectCount);
      const result = computeGroupGPA(group, inputSlice);
      if (result.selected) {
        weightedPoints += result.weightedValue;
        totalWeight += result.weight;
        completedGroups += 1;
      }
      inputIndex += subjectCount;
    });

    return {
      weightedPoints,
      totalWeight,
      completedGroups,
      totalGroups: currentPreset.subjectGroups.length,
      gpa: totalWeight > 0 ? weightedPoints / totalWeight : null
    };
  }

  function computePresetGPA(currentPreset, inputs) {
    return computePresetTotals(currentPreset, inputs).gpa ?? 0;
  }

  function getUnweightedGradePoint(scorePair) {
    const letterBucket = scorePair?.letterName?.trim().charAt(0).toUpperCase();
    return US_UNWEIGHTED_GRADE_POINTS[letterBucket] ?? 0;
  }

  function computeSubjectUnweightedGPA(subjectInput, selected) {
    return getUnweightedGradePoint(selectedScore(subjectInput, selected));
  }

  function computeUnweightedTotals(currentPreset, inputs) {
    let points = 0;
    let courseCount = 0;

    currentPreset.subjects.forEach((currentSubject, subjectIndex) => {
      const scorePair = selectedScore(currentSubject, inputs[subjectIndex]);
      if (!scorePair) return;
      points += getUnweightedGradePoint(scorePair);
      courseCount += 1;
    });

    return {
      points,
      courseCount,
      gpa: courseCount > 0 ? points / courseCount : null
    };
  }

  function computeUnweightedGPA(currentPreset, inputs) {
    return computeUnweightedTotals(currentPreset, inputs).gpa ?? 0;
  }

  function computeCumulativeTotals(entries) {
    let weightedPoints = 0;
    let totalWeight = 0;
    let unweightedPoints = 0;
    let courseCount = 0;
    let selectedCourses = 0;
    let totalCourses = 0;
    const semesterResults = [];

    entries.forEach((entry) => {
      const { preset: currentPreset, inputs } = entry;
      const weighted = computePresetTotals(currentPreset, inputs);
      const unweighted = computeUnweightedTotals(currentPreset, inputs);
      weightedPoints += weighted.weightedPoints;
      totalWeight += weighted.totalWeight;
      unweightedPoints += unweighted.points;
      courseCount += unweighted.courseCount;
      selectedCourses += unweighted.courseCount;
      totalCourses += currentPreset.subjects.length;

      if (unweighted.courseCount > 0) {
        semesterResults.push({
          grade: entry.grade,
          semester: entry.semester,
          label: entry.label,
          weightedGPA: weighted.gpa,
          unweightedGPA: unweighted.gpa,
          selectedCourses: unweighted.courseCount,
          totalCourses: currentPreset.subjects.length
        });
      }
    });

    const weightedSemesters = semesterResults.filter((semester) => semester.weightedGPA !== null);
    const unweightedSemesters = semesterResults.filter((semester) => semester.unweightedGPA !== null);

    return {
      weightedPoints,
      totalWeight,
      weightedGPA: weightedSemesters.length > 0
        ? weightedSemesters.reduce((sum, semester) => sum + semester.weightedGPA, 0) / weightedSemesters.length
        : null,
      unweightedPoints,
      courseCount,
      unweightedGPA: unweightedSemesters.length > 0
        ? unweightedSemesters.reduce((sum, semester) => sum + semester.unweightedGPA, 0) / unweightedSemesters.length
        : null,
      selectedCourses,
      totalCourses,
      semesterCount: semesterResults.length,
      semesterResults
    };
  }

  function isSubjectUCEligible(currentSubject, choiceIndex = -1) {
    if (currentSubject.alternateNames) {
      if (!Number.isInteger(choiceIndex) || choiceIndex < 0) return false;
      const chosenName = currentSubject.alternateNames[choiceIndex];
      if (!chosenName) return false;
      if (typeof chosenName.ucEligible === "boolean") return chosenName.ucEligible;
    }
    return Boolean(currentSubject.ucEligible);
  }

  function computeUCGPA(entries) {
    let basePoints = 0;
    let semesterCount = 0;
    let grade10HonorsSemesters = 0;
    let grade11HonorsSemesters = 0;

    entries.forEach(({ grade, preset: currentPreset, inputs, nameChoices = [] }) => {
      if (grade !== 10 && grade !== 11) return;

      currentPreset.subjects.forEach((currentSubject, subjectIndex) => {
        const scorePair = selectedScore(currentSubject, inputs[subjectIndex]);
        if (!scorePair || !isSubjectUCEligible(currentSubject, nameChoices[subjectIndex])) return;

        const gradePoints = getUnweightedGradePoint(scorePair);
        const levelValue = selectedLevel(currentSubject, inputs[subjectIndex]);
        basePoints += gradePoints;
        semesterCount += 1;

        if (levelValue?.ucHonors && gradePoints >= 2) {
          if (grade === 10) grade10HonorsSemesters += 1;
          if (grade === 11) grade11HonorsSemesters += 1;
        }
      });
    });

    const cappedGrade10 = Math.min(4, grade10HonorsSemesters);
    const cappedHonorsSemesters = Math.min(8, cappedGrade10 + grade11HonorsSemesters);
    const honorsSemesters = grade10HonorsSemesters + grade11HonorsSemesters;

    return {
      basePoints,
      semesterCount,
      honorsSemesters,
      cappedHonorsSemesters,
      unweighted: semesterCount > 0 ? basePoints / semesterCount : null,
      cappedWeighted: semesterCount > 0 ? (basePoints + cappedHonorsSemesters) / semesterCount : null,
      uncappedWeighted: semesterCount > 0 ? (basePoints + honorsSemesters) / semesterCount : null
    };
  }

  function formatGPA(value) {
    return Number.isFinite(value) ? value.toFixed(3) : "—";
  }

  function displayName(nameValue, compact = false) {
    return compact ? nameValue.compact : nameValue.regular;
  }

  function resolvedSubjectName(currentSubject, choiceIndex = -1, compact = false) {
    const chosen = Number.isInteger(choiceIndex) && choiceIndex >= 0
      ? currentSubject.alternateNames?.[choiceIndex]
      : null;
    return displayName(chosen ?? currentSubject.name, compact);
  }

  const api = {
    CATALOG_META,
    GPA_SCALE_MAXIMA,
    SHSID_WEIGHTED_PRESET_MAXIMA,
    SHSID_WEIGHTED_SCHOOL_MAXIMUM,
    UC_CAPPED_SCHOOL_MAXIMUM,
    DEFAULT_SCORES,
    IB_SCORES,
    IB_OTHER_SCORES,
    TOK_EE_MATRIX,
    US_UNWEIGHTED_GRADE_POINTS,
    presets,
    computeSubjectGPA,
    computeGroupGPA,
    computePresetTotals,
    computePresetGPA,
    computeUnweightedTotals,
    computeUnweightedGPA,
    computeSubjectUnweightedGPA,
    computeCumulativeTotals,
    computeUCGPA,
    isSubjectUCEligible,
    getUnweightedGradePoint,
    selectedLevel,
    selectedScore,
    resolvedSubjectName,
    formatGPA
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.SHSIDCatalog = api;
})(typeof window !== "undefined" ? window : globalThis);
