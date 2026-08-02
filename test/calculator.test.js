const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const calculator = require("../app.js");

const pageHtml = fs.readFileSync(new URL("../index.html", `file://${__filename}`), "utf8");

function inputFor(preset, levelIndex, scoreIndex) {
  return preset.subjects.map(() => ({ levelIndex, scoreIndex }));
}

function blankInputFor(preset) {
  return preset.subjects.map(() => ({ levelIndex: 0, scoreIndex: null }));
}

function blankNamesFor(preset) {
  return preset.subjects.map(() => -1);
}

test("loads every Swift preset", () => {
  assert.equal(calculator.presets.length, 14);
  assert.deepEqual(calculator.presets.map((preset) => preset.id), [
    "stockshsidgrade6",
    "stockshsidgrade7",
    "stockshsidgrade8",
    "stockshsidgrade9",
    "stockshsidgrade10",
    "stockshsidgrade11-2m2-1m3",
    "stockshsidgrade11-1m2-1m3-1m45",
    "stockshsidgrade11-1m2-1m3-1m4-1m5",
    "stockshsidgrade11-ib",
    "stockshsidgrade11-ibee",
    "stockshsidgrade12-2m2-1m3",
    "stockshsidgrade12-1m2-1m3-1m45",
    "stockshsidgrade12-1m2-1m3-1m4-1m5",
    "stockshsidgrade12-ibee"
  ]);
});

test("Grade 11 and 12 schedule labels use the original module notation", () => {
  const expectedBySuffix = new Map([
    ["2m2-1m3", "2× M1 + 1× M2"],
    ["1m2-1m3-1m45", "1× M1 + M2 + M3/4"],
    ["1m2-1m3-1m4-1m5", "1× M1 + M2 + M3 + M4"]
  ]);

  for (const grade of [11, 12]) {
    for (const [suffix, expected] of expectedBySuffix) {
      const currentPreset = calculator.getPresetById(`stockshsidgrade${grade}-${suffix}`);
      assert.equal(currentPreset.subtitle, expected);
      assert.doesNotMatch(currentPreset.subtitle, /science module|elective/i);
    }
  }
});

test("method section documents local credits and both UC resources", () => {
  assert.match(pageHtml, /under 55 minutes/);
  assert.match(pageHtml, /55 minutes or longer/);
  assert.match(pageHtml, /unbased/);
  assert.match(pageHtml, /removes plus and minus modifiers/);
  assert.match(pageHtml, /up to 8 honors points/);
  assert.match(pageHtml, /freshman-admission-discipline/);
  assert.match(pageHtml, /gpa-requirement\.html/);
});

test("derives stable absolute GPA scale ceilings from the local catalog", () => {
  assert.deepEqual(calculator.GPA_SCALE_MAXIMA, {
    shsidWeighted: calculator.SHSID_WEIGHTED_SCHOOL_MAXIMUM.gpa,
    unweighted: 4,
    ucCapped: 4 + 8 / 24
  });
  assert.equal(calculator.formatGPA(calculator.SHSID_WEIGHTED_SCHOOL_MAXIMUM.gpa), "4.438");
  assert.equal(calculator.SHSID_WEIGHTED_SCHOOL_MAXIMUM.semesters, 8);
  assert.deepEqual(calculator.SHSID_WEIGHTED_SCHOOL_MAXIMUM.gradePresetIds, [
    "stockshsidgrade9",
    "stockshsidgrade10",
    "stockshsidgrade11-ib",
    "stockshsidgrade12-ibee"
  ]);
  assert.equal(
    calculator.formatGPA(calculator.SHSID_WEIGHTED_PRESET_MAXIMA.stockshsidgrade10.gpa),
    "4.430"
  );
  for (const preset of calculator.presets.filter(({ grade, track }) => grade >= 11 && track === "ap-a-level")) {
    assert.equal(
      calculator.formatGPA(calculator.SHSID_WEIGHTED_PRESET_MAXIMA[preset.id].gpa),
      "4.481",
      `${preset.id} should use the X-free Chinese ceiling`
    );
  }
  assert.equal(
    calculator.formatGPA(calculator.SHSID_WEIGHTED_PRESET_MAXIMA["stockshsidgrade11-ib"].gpa),
    "4.500"
  );
  assert.deepEqual(calculator.UC_CAPPED_SCHOOL_MAXIMUM, {
    gpa: 4 + 8 / 24,
    aGSemesters: 24,
    honorsPoints: 8,
    grade10PresetId: "stockshsidgrade10",
    grade11PresetId: "stockshsidgrade11-1m2-1m3-1m45"
  });
});

test("SHSID weighted maximum follows the selected single or cumulative schedules", () => {
  const state = calculator.createDefaultState();
  assert.equal(calculator.formatGPA(calculator.shsidWeightedMaximumForState(state)), "4.430");

  state.mode = "cumulative";
  state.cumulativeYears = [9, 10, 11, 12].map((grade) => calculator.createYearState(grade));
  state.cumulativeYears.find((year) => year.grade === 11).presetId = "stockshsidgrade11-ib";
  state.cumulativeYears.find((year) => year.grade === 12).presetId = "stockshsidgrade12-ibee";
  assert.equal(calculator.formatGPA(calculator.shsidWeightedMaximumForState(state)), "4.438");
});

test("UC GPA is unavailable in single-semester results and remains available cumulatively", () => {
  const state = calculator.createDefaultState();
  const singleResults = calculator.renderResults(state);
  assert.match(singleResults, /Not available for semester/);
  assert.doesNotMatch(singleResults, /UC unweighted|UC uncapped|UC honors used/);

  state.mode = "cumulative";
  const cumulativeResults = calculator.renderResults(state);
  assert.doesNotMatch(cumulativeResults, /Not available for semester/);
  assert.match(cumulativeResults, /UC capped/);
  assert.match(cumulativeResults, /UC unweighted/);
});

test("course rows always render Chinese, English, Maths, Sciences, then other electives", () => {
  const grade10 = calculator.getPresetById("stockshsidgrade10");
  const grade10State = calculator.createSinglePresetState(grade10);
  assert.deepEqual(
    calculator.orderedSubjectEntries(grade10, grade10State).map((entry) => entry.subjectIndex),
    [1, 0, 2, 4, 5, 3, 6]
  );

  const grade9 = calculator.getPresetById("stockshsidgrade9");
  const grade9State = calculator.createSinglePresetState(grade9);
  const biologyIndex = grade9.subjects[5].alternateNames.findIndex((name) => name.regular === "Biology");
  grade9State.nameChoices[5] = biologyIndex;
  assert.deepEqual(
    calculator.orderedSubjectEntries(grade9, grade9State).map((entry) => entry.subjectIndex),
    [4, 0, 1, 3, 5, 6, 2]
  );

  const grade11Ib = calculator.getPresetById("stockshsidgrade11-ib");
  const grade11IbState = calculator.createSinglePresetState(grade11Ib);
  grade11IbState.nameChoices[3] = 0;
  assert.equal(calculator.courseCategory(grade11Ib.subjects[3], 0), "sciences");
  const computerScienceIndex = grade11Ib.subjects[3].alternateNames.findIndex(
    (name) => name.regular === "Computer Science"
  );
  assert.equal(calculator.courseCategory(grade11Ib.subjects[3], computerScienceIndex), "other");
});

test("grade 10 all top scores at first level matches level offsets", () => {
  const preset = calculator.getPresetById("stockshsidgrade10");
  const result = calculator.computePresetGPA(preset, inputFor(preset, 0, 7));
  assert.equal(calculator.formatGPA(result), "4.000");
});

test("unweighted GPA uses US A/B/C/D/F grade buckets", () => {
  assert.equal(calculator.US_UNWEIGHTED_GRADE_POINTS.A, 4);
  assert.equal(calculator.getUnweightedGradePoint({ letterName: "A-" }), 4);
  assert.equal(calculator.getUnweightedGradePoint({ letterName: "B+" }), 3);
  assert.equal(calculator.getUnweightedGradePoint({ letterName: "C/C-" }), 2);
  assert.equal(calculator.getUnweightedGradePoint({ letterName: "D" }), 1);
  assert.equal(calculator.getUnweightedGradePoint({ letterName: "F" }), 0);
});

test("unweighted GPA counts visible courses equally", () => {
  const preset = calculator.getPresetById("stockshsidgrade10");
  const inputs = inputFor(preset, 0, 0);
  inputs[0] = { levelIndex: 0, scoreIndex: 7 };
  inputs[1] = { levelIndex: 0, scoreIndex: 5 };
  inputs[2] = { levelIndex: 0, scoreIndex: 2 };
  assert.equal(calculator.formatGPA(calculator.computeUnweightedGPA(preset, inputs)), "1.286");
});

test("IB ToK and EE use the combined matrix as one half-credit group", () => {
  const preset = calculator.getPresetById("stockshsidgrade11-ibee");
  const inputs = inputFor(preset, 0, 7);
  inputs[6] = { levelIndex: 0, scoreIndex: 3 };
  inputs[7] = { levelIndex: 0, scoreIndex: 4 };
  assert.equal(calculator.formatGPA(calculator.computePresetGPA(preset, inputs)), "4.500");
});

test("max subject group contributes only the stronger weighted module", () => {
  const preset = calculator.getPresetById("stockshsidgrade11-1m2-1m3-1m4-1m5");
  const inputs = inputFor(preset, 0, 0);
  inputs[4] = { levelIndex: 2, scoreIndex: 6 };
  inputs[5] = { levelIndex: 4, scoreIndex: 6 };
  assert.equal(calculator.formatGPA(calculator.computePresetGPA(preset, inputs)), "0.630");
});

test("locks the original Grade 9 and Grade 10 credit table", () => {
  const grade9 = calculator.getPresetById("stockshsidgrade9");
  const grade10 = calculator.getPresetById("stockshsidgrade10");
  assert.deepEqual(grade9.subjects.map((subject) => subject.levels[0].weight), [6.5, 6, 4, 3, 3, 3, 3]);
  assert.deepEqual(grade10.subjects.map((subject) => subject.levels[0].weight), [6, 3, 5.5, 4, 4, 4, 4]);
});

test("locks the original Grade 11 module credit table", () => {
  const twoScience = calculator.getPresetById("stockshsidgrade11-2m2-1m3");
  const oneScience = calculator.getPresetById("stockshsidgrade11-1m2-1m3-1m45");
  assert.deepEqual(twoScience.subjects.map((subject) => subject.levels[0].weight), [6, 6, 6, 6, 4.5, 3]);
  assert.deepEqual(oneScience.subjects.map((subject) => subject.levels[0].weight), [6, 6, 6, 4.5, 3, 3]);
});

test("Grades 10 through 12 never offer Chinese X", () => {
  for (const preset of calculator.presets.filter(({ grade }) => grade >= 10)) {
    const chinese = preset.subjects.find(({ name }) => name.regular === "Chinese");
    assert.ok(chinese, `${preset.id} should include Chinese`);
    assert.equal(
      chinese.levels.some(({ name }) => name === "X"),
      false,
      `${preset.id} should not include Chinese X`
    );
  }

  const grade10 = calculator.getPresetById("stockshsidgrade10");
  const chineseLevels = grade10.subjects[1].levels;
  assert.equal(chineseLevels[3].name, "IX");
  assert.equal(chineseLevels[4].name, "AP");
  assert.equal(chineseLevels[4].ucHonors, true);
});

test("saved Grade 11 and 12 Chinese X selections migrate to IX", () => {
  for (const presetId of ["stockshsidgrade11-2m2-1m3", "stockshsidgrade12-2m2-1m3"]) {
    const preset = calculator.getPresetById(presetId);
    const chineseIndex = preset.subjects.findIndex(({ name }) => name.regular === "Chinese");
    const oldSingleState = calculator.createSinglePresetState(preset);
    const oldCumulativeState = calculator.createCumulativePresetState(preset);
    oldSingleState.inputs[chineseIndex].levelIndex = 4;
    oldCumulativeState.inputs[chineseIndex].levelIndex = 4;

    assert.equal(calculator.sanitizeSinglePresetState(preset, oldSingleState).inputs[chineseIndex].levelIndex, 3);
    assert.equal(calculator.sanitizeCumulativePresetState(preset, oldCumulativeState).inputs[chineseIndex].levelIndex, 3);
    assert.equal(preset.subjects[chineseIndex].levels[3].name, "IX");
  }
});

test("one semester weighted GPA is weighted points divided by course credits", () => {
  const preset = calculator.getPresetById("stockshsidgrade10");
  const inputs = blankInputFor(preset);
  inputs[0] = { levelIndex: 4, scoreIndex: 7 }; // English AP: 4.5 × 6
  inputs[1] = { levelIndex: 3, scoreIndex: 6 }; // Chinese IX: 4.0 × 3
  inputs[2] = { levelIndex: 3, scoreIndex: 6 }; // Math AP: 4.2 × 5.5
  inputs[3] = { levelIndex: 3, scoreIndex: 5 }; // History AP: 3.9 × 5
  inputs[4] = { levelIndex: 1, scoreIndex: 7 }; // Science H: 4.3 × 4
  inputs[5] = { levelIndex: 0, scoreIndex: 5 }; // Science S: 3.4 × 4
  inputs[6] = { levelIndex: 2, scoreIndex: 6 }; // Elective AP: 4.2 × 4

  const totals = calculator.computePresetTotals(preset, inputs);
  assert.equal(totals.weightedPoints, 129.2);
  assert.equal(totals.totalWeight, 31.5);
  assert.equal(calculator.formatGPA(totals.gpa), "4.102");
});

test("blank rows are omitted instead of being treated as failing grades", () => {
  const preset = calculator.getPresetById("stockshsidgrade10");
  const inputs = blankInputFor(preset);
  inputs[0] = { levelIndex: 0, scoreIndex: 7 };
  const totals = calculator.computePresetTotals(preset, inputs);
  assert.equal(totals.completedGroups, 1);
  assert.equal(totals.totalWeight, 6);
  assert.equal(totals.weightedPoints, 24);
  assert.equal(calculator.formatGPA(totals.gpa), "4.000");
});

test("cumulative GPA is the arithmetic mean of entered semester GPAs", () => {
  const grade9 = calculator.getPresetById("stockshsidgrade9");
  const grade10 = calculator.getPresetById("stockshsidgrade10");
  const grade9Semester1 = blankInputFor(grade9);
  const grade10Semester2 = blankInputFor(grade10);
  grade9Semester1[0] = { levelIndex: 0, scoreIndex: 7 }; // Semester GPA 4.000
  grade10Semester2[1] = { levelIndex: 0, scoreIndex: 5 }; // Semester GPA 3.400

  const totals = calculator.computeCumulativeTotals([
    { grade: 9, semester: 1, label: "G9 S1", preset: grade9, inputs: grade9Semester1 },
    { grade: 10, semester: 2, label: "G10 S2", preset: grade10, inputs: grade10Semester2 }
  ]);

  assert.equal(totals.weightedPoints, 36.2);
  assert.equal(totals.totalWeight, 9.5);
  assert.equal(totals.semesterCount, 2);
  assert.equal(calculator.formatGPA(totals.weightedGPA), "3.700");
  assert.deepEqual(totals.semesterResults.map((semester) => semester.label), ["G9 S1", "G10 S2"]);
});

test("blank semesters are excluded from the cumulative divisor", () => {
  const grade9 = calculator.getPresetById("stockshsidgrade9");
  const filled = blankInputFor(grade9);
  filled[0] = { levelIndex: 0, scoreIndex: 7 };
  const totals = calculator.computeCumulativeTotals([
    { grade: 9, semester: 1, preset: grade9, inputs: filled },
    { grade: 9, semester: 2, preset: grade9, inputs: blankInputFor(grade9) }
  ]);
  assert.equal(totals.semesterCount, 1);
  assert.equal(calculator.formatGPA(totals.weightedGPA), "4.000");
});

test("cumulative state stores independent grades for both semesters", () => {
  const preset = calculator.getPresetById("stockshsidgrade10");
  const state = calculator.createCumulativePresetState(preset);
  state.inputs[4].levelIndex = 1;
  state.inputs[4].scoreIndices[0] = 7;
  assert.deepEqual(state.inputs[4], { levelIndex: 1, scoreIndices: [7, null] });
  assert.deepEqual(state.inputs[5], { levelIndex: 0, scoreIndices: [null, null] });
});

test("each cumulative year expands into two calculation entries", () => {
  const state = calculator.createDefaultState();
  state.mode = "cumulative";
  const entries = calculator.calculationEntries(state);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.semester), [1, 2]);
  assert.deepEqual(entries.map((entry) => entry.label), ["Grade 9 · Semester 1", "Grade 9 · Semester 2"]);
});

test("adding a cumulative grade collapses older years and opens the new one", () => {
  const state = calculator.createDefaultState();
  assert.equal(calculator.addCumulativeYear(state, 11), true);
  assert.deepEqual(state.cumulativeYears.map((year) => year.grade), [9, 11]);
  assert.equal(state.cumulativeYears.find((year) => year.grade === 9).collapsed, true);
  assert.equal(state.cumulativeYears.find((year) => year.grade === 11).collapsed, false);
  assert.equal(calculator.addCumulativeYear(state, 11), false);
});

test("v2 cumulative grades migrate to Semester 1 without fabricating Semester 2", () => {
  const grade9 = calculator.getPresetById("stockshsidgrade9");
  const legacyInputs = blankInputFor(grade9);
  legacyInputs[0] = { levelIndex: 0, scoreIndex: 7 };
  const migrated = calculator.sanitizeState({
    version: 2,
    mode: "cumulative",
    singlePresetId: "stockshsidgrade10",
    cumulativeYears: [{
      grade: 9,
      presetId: grade9.id,
      byPreset: { [grade9.id]: { inputs: legacyInputs, nameChoices: blankNamesFor(grade9) } }
    }]
  });
  const migratedInput = migrated.cumulativeYears[0].byPreset[grade9.id].inputs[0];
  assert.deepEqual(migratedInput.scoreIndices, [7, null]);
});

test("UC GPA uses separate Grade 10 and 11 A-G semesters with the 4/8 honors caps", () => {
  const grade9 = calculator.getPresetById("stockshsidgrade9");
  const grade10 = calculator.getPresetById("stockshsidgrade10");
  const grade11 = calculator.getPresetById("stockshsidgrade11-2m2-1m3");
  const grade12 = calculator.getPresetById("stockshsidgrade12-2m2-1m3");
  const grade10Inputs = blankInputFor(grade10);
  const grade11Inputs = blankInputFor(grade11);
  const grade11Names = blankNamesFor(grade11);
  const outsideWindow = blankInputFor(grade9);
  const outsideWindow12 = blankInputFor(grade12);

  outsideWindow[0] = { levelIndex: 0, scoreIndex: 7 };
  outsideWindow12[0] = { levelIndex: 3, scoreIndex: 7 };
  grade10Inputs[0] = { levelIndex: 4, scoreIndex: 7 }; // English AP
  grade10Inputs[2] = { levelIndex: 3, scoreIndex: 7 }; // Math AP
  grade10Inputs[3] = { levelIndex: 3, scoreIndex: 7 }; // History AP
  grade11Inputs[0] = { levelIndex: 3, scoreIndex: 7 }; // Math AP
  grade11Inputs[1] = { levelIndex: 4, scoreIndex: 7 }; // English AP
  grade11Inputs[2] = { levelIndex: 4, scoreIndex: 7 }; // Science AP
  grade11Names[2] = 0; // Biology

  const entries = [
    { grade: 9, semester: 1, preset: grade9, inputs: outsideWindow, nameChoices: blankNamesFor(grade9) },
    { grade: 10, semester: 1, preset: grade10, inputs: grade10Inputs, nameChoices: blankNamesFor(grade10) },
    { grade: 10, semester: 2, preset: grade10, inputs: grade10Inputs, nameChoices: blankNamesFor(grade10) },
    { grade: 11, semester: 1, preset: grade11, inputs: grade11Inputs, nameChoices: grade11Names },
    { grade: 11, semester: 2, preset: grade11, inputs: grade11Inputs, nameChoices: grade11Names },
    { grade: 12, semester: 1, preset: grade12, inputs: outsideWindow12, nameChoices: blankNamesFor(grade12) }
  ];

  const uc = calculator.computeUCGPA(entries);
  assert.equal(uc.semesterCount, 12);
  assert.equal(uc.honorsSemesters, 12);
  assert.equal(uc.cappedHonorsSemesters, 8);
  assert.equal(calculator.formatGPA(uc.unweighted), "4.000");
  assert.equal(calculator.formatGPA(uc.cappedWeighted), "4.667");
  assert.equal(calculator.formatGPA(uc.uncappedWeighted), "5.000");
});

test("school H and A-Level courses do not earn UC honors points", () => {
  const grade10 = calculator.getPresetById("stockshsidgrade10");
  const grade11 = calculator.getPresetById("stockshsidgrade11-2m2-1m3");
  const grade10Inputs = blankInputFor(grade10);
  const grade11Inputs = blankInputFor(grade11);
  grade10Inputs[0] = { levelIndex: 2, scoreIndex: 7 }; // English H
  grade11Inputs[0] = { levelIndex: 2, scoreIndex: 7 }; // Math A-Level

  const uc = calculator.computeUCGPA([
    { grade: 10, semester: 1, preset: grade10, inputs: grade10Inputs, nameChoices: blankNamesFor(grade10) },
    { grade: 11, semester: 1, preset: grade11, inputs: grade11Inputs, nameChoices: blankNamesFor(grade11) }
  ]);
  assert.equal(uc.honorsSemesters, 0);
  assert.equal(calculator.formatGPA(uc.cappedWeighted), "4.000");
});

test("AP Chinese and IB courses earn automatic UC honors points", () => {
  const grade10 = calculator.getPresetById("stockshsidgrade10");
  const grade11Ib = calculator.getPresetById("stockshsidgrade11-ib");
  const grade10Inputs = blankInputFor(grade10);
  const ibInputs = blankInputFor(grade11Ib);
  const chineseApIndex = grade10.subjects[1].levels.findIndex((level) => level.name === "AP");
  grade10Inputs[1] = { levelIndex: chineseApIndex, scoreIndex: 7 };
  ibInputs[0] = { levelIndex: 0, scoreIndex: 7 };

  const uc = calculator.computeUCGPA([
    { grade: 10, semester: 1, preset: grade10, inputs: grade10Inputs, nameChoices: blankNamesFor(grade10) },
    { grade: 11, semester: 1, preset: grade11Ib, inputs: ibInputs, nameChoices: blankNamesFor(grade11Ib) }
  ]);
  assert.equal(chineseApIndex >= 0, true);
  assert.equal(uc.honorsSemesters, 2);
  assert.equal(calculator.formatGPA(uc.cappedWeighted), "5.000");
});

test("A-G inclusion is automatic and unresolved course choices are excluded", () => {
  const grade10 = calculator.getPresetById("stockshsidgrade10");
  const inputs = blankInputFor(grade10);
  const names = blankNamesFor(grade10);
  inputs[4] = { levelIndex: 1, scoreIndex: 7 };

  let uc = calculator.computeUCGPA([{ grade: 10, semester: 1, preset: grade10, inputs, nameChoices: names }]);
  assert.equal(uc.semesterCount, 0);

  names[4] = 0; // Biology
  uc = calculator.computeUCGPA([{ grade: 10, semester: 1, preset: grade10, inputs, nameChoices: names }]);
  assert.equal(uc.semesterCount, 1);
  assert.equal(calculator.formatGPA(uc.cappedWeighted), "4.000");
});

test("catalog-marked non-A-G choices are excluded without a user override", () => {
  const grade11 = calculator.getPresetById("stockshsidgrade11-1m2-1m3-1m45");
  const elective = grade11.subjects[4];
  const computerSkillsIndex = elective.alternateNames.findIndex((name) => name.regular === "Computer Skills");
  assert.equal(computerSkillsIndex >= 0, true);
  assert.equal(calculator.isSubjectUCEligible(elective, computerSkillsIndex), false);
});

test("ToK and EE contribute only after both matrix grades are selected", () => {
  const preset = calculator.getPresetById("stockshsidgrade11-ibee");
  const inputs = blankInputFor(preset);
  inputs[6] = { levelIndex: 0, scoreIndex: 4 };
  let totals = calculator.computePresetTotals(preset, inputs);
  assert.equal(totals.totalWeight, 0);
  inputs[7] = { levelIndex: 0, scoreIndex: 3 };
  totals = calculator.computePresetTotals(preset, inputs);
  assert.equal(totals.totalWeight, 0.5);
  assert.equal(calculator.formatGPA(totals.gpa), "4.500");
});
