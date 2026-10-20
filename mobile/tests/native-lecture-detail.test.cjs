// Portable wiring checks only; rendering and Swift compilation require Xcode.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ui = read('modules/haskapp-native/ios/LectureDetails.swift');
const model = read('modules/haskapp-native/ios/LectureDetailModels.swift');
const history = read('modules/haskapp-native/ios/GradeHistory.swift');

test('native lecture detail has separate overview, personal criteria and historical cohort surfaces', () => {
  assert.match(ui, /case lecture = "講義情報"/);
  assert.match(ui, /case grades = "成績情報"/);
  assert.match(ui, /自分の評価基準/);
  assert.match(ui, /GradeHistorySection\(store: store, lecture: lecture\)/);
  assert.doesNotMatch(read('modules/haskapp-native/ios/PlannerRoot.swift'), /共有テンプレートの候補を適用/);
  for (const key of ['assessment.report','assessment.edit','suggestion.review','suggestion.apply']) {
    if (key !== 'assessment.report') assert.ok(ui.includes(key), key);
  }
});

test('template UI begins with no selected fields and sends keys only after an explicit review confirmation', () => {
  assert.match(ui, /selectedKeys = Set<String>\(\)/);
  assert.match(ui, /\.confirmationDialog\(/);
  assert.match(ui, /store\.action\("applySuggestion", ApplyTemplateProposal/);
  assert.match(ui, /fields: selectedFields\.map\(\\\.key\)/);
  assert.match(model, /case "grading_report": return lecture\.grading_report == nil/);
  assert.match(model, /case "grading_criteria": return nonempty\(lecture\.grading_criteria\) == nil && nonempty\(lecture\.grading_memo\) == nil/);
  assert.doesNotMatch(ui, /fetchTemplateLectureSuggestion|publishLectureTemplate|upsert\(/);
});

test('native historical charts retain missing values and honest source/cache labels', () => {
  assert.match(history, /validGradeDistribution\(distribution\)/);
  assert.match(history, /gradeHistoryStatus\[lecture.id\]/);
  assert.match(history, /grades\.cohort/);
  assert.match(history, /grades\.cached/);
  assert.match(history, /grades\.error/);
  assert.match(history, /年度・集計元未確認/);
  assert.match(history, /0%とは異なります/);
  assert.doesNotMatch(history, /2024年度|2025年度|2026年度|情報エレクトロニクス学科 電気制御/);
  assert.doesNotMatch(ui + history, /SectorMark|ContentUnavailableView|\.chartXSelection/);
});

test('official PDF details use real catalog identity solely for historical lookup', () => {
  const official = read('modules/haskapp-native/ios/OfficialTemplates.swift');
  assert.match(official, /GradeHistorySection\(store: store, lecture: historyReference\(for: item\), officialReference: true\)/);
  assert.match(official, /lecture\.id = item\.id/);
  assert.match(official, /lecture\.lecture_name = item\.title/);
  assert.match(official, /lecture\.instructor = item\.instructor/);
  assert.match(official, /科目名だけでは共有講義に紐付けません/);
});

test('Foundation-only lecture model checks are wired into the native runner', () => {
  assert.match(read('native-tests/run-model-checks.sh'), /LectureDetailModels\.swift/);
  const checks = read('native-tests/PlannerModelChecks.swift');
  assert.match(checks, /Unrecorded absences never become zero/);
  assert.match(checks, /A proposal must never enable overwriting a current zero/);
  assert.match(checks, /Malformed numeric inputs are not silently saved as unknown/);
});


test('full lecture editor writes both assessment aliases only through explicit text edits', () => {
  const fullEditor = read('modules/haskapp-native/ios/PlannerRoot.swift');
  assert.match(fullEditor, /TextField\("評価メモ", text: Binding\(get: \{ lecture\.assessmentNote \}, set: \{ lecture\.assessmentNote = \$0 \}\)/);
  assert.doesNotMatch(fullEditor, /TextField\("評価メモ", text: textBinding\(\$lecture\.grading_memo\)/);
  assert.match(model, /var assessmentNote: String[\s\S]*?grading_memo = newValue[\s\S]*?grading_criteria = newValue/);
  assert.match(model, /if memo != initialMemo \{\s*value\.assessmentNote = memo/);
  assert.match(read('native-tests/PlannerModelChecks.swift'), /Full-editor clearing must clear both assessment aliases and preserve the lecture memo/);
});


test('full lecture editor preserves and validates raw numeric drafts before saving', () => {
  const fullEditor = read('modules/haskapp-native/ios/PlannerRoot.swift').split('struct LectureEditor: View {')[1].split('struct LectureSearch: View {')[0];
  assert.match(fullEditor, /@State private var assessment: AssessmentDraft/);
  for (const field of ['total', 'required', 'report', 'test', 'quiz']) assert.ok(fullEditor.includes('text: $assessment.' + field), field);
  assert.doesNotMatch(fullEditor, /optionalInt\(/);
  assert.match(fullEditor, /guard assessment\.validationMessage == nil else \{ return \}/);
  assert.match(fullEditor, /assessment\.applying\(to: lecture\)/);
  assert.match(fullEditor, /assessment\.validationMessage != nil \|\| store\.snapshot\.busy/);
  assert.match(model, /func applying\(to current: Lecture\) -> Lecture \{[\s\S]*?guard validationMessage == nil else \{ return current \}/);
});


test('selected-field recovery routes before generic lecture drafts and never resends a full lecture', () => {
  const settings = read('modules/haskapp-native/ios/Settings.swift');
  const safeBranch = settings.indexOf('if draft.type == "saveLectureFields"');
  const genericBranch = settings.indexOf('else if draft.type.contains("Lecture")');
  assert.ok(safeBranch >= 0 && genericBranch > safeBranch);
  assert.match(settings, /decode\(SelectedLectureFieldsDraft\.self, from: data\)/);
  assert.match(settings, /sheet\(item: \$selectedFieldsDraft\)/);
  const recovery = ui.split('struct SelectedLectureFieldsRecovery: View {')[1];
  assert.ok(recovery);
  assert.match(recovery, /ForEach\(draft\.fields\)/);
  assert.match(recovery, /store\.snapshot\.lectures\.contains\(where: \{ \$0\.id == draft\.id \}\)/);
  assert.match(recovery, /let requestID = UUID\(\)\.uuidString/);
  assert.match(recovery, /store\.action\("suggestion", \["id": draft\.id, "requestId": requestID\]\)/);
  assert.match(recovery, /let lookup = store\.snapshot\.templateSuggestions\[draft\.id\]/);
  assert.match(recovery, /lookup\.requestId == requestID, lookup\.status != "loading"/);
  assert.doesNotMatch(recovery, /sawReloadStart|sawWorkStart|refreshedIdentity|priorFetchedAt|priorProposalID/);
  assert.match(recovery, /TemplateSuggestionReview\(store: store, lectureID: draft\.id\)/);
  assert.match(recovery, /suggestion\.recovery\.missingLecture/);
  assert.doesNotMatch(recovery, /LectureEditor|saveLecture|applySuggestion|discardDraft|draft\.recovery/);
  const recoveryModel = model.split('struct SelectedLectureFieldsDraft: Decodable, Identifiable {')[1].split('struct SelectedLectureFieldDraftValue')[0];
  assert.match(recoveryModel, /let patch: \[String: TemplateFieldValue\]/);
  assert.doesNotMatch(recoveryModel, /let recovery|var recovery|: Lecture/);
});


test('selected-field queue cancellation uses the original draft ID only after explicit confirmation', () => {
  const settings = read('modules/haskapp-native/ios/Settings.swift');
  assert.match(settings, /selectedFieldsDraftID = draft\.id/);
  assert.match(settings, /SelectedLectureFieldsRecovery\(store: store, draft: item, draftID: selectedFieldsDraftID\)/);
  const recovery = ui.split('struct SelectedLectureFieldsRecovery: View {')[1];
  assert.match(recovery, /この未同期の提案を取り消す/);
  assert.match(recovery, /\.disabled\(draftID\.isEmpty \|\| store\.snapshot\.busy \|\| waitingForReload\)/);
  const confirmation = recovery.split('.confirmationDialog("この未同期の提案を取り消しますか？"')[1].split('.onChange')[0];
  assert.match(confirmation, /store\.action\("cancelLectureFields", \["draftId": draftID\]\)/);
  assert.match(confirmation, /後から行った編集・操作と、このバックアップは残ります/);
  assert.match(confirmation, /サーバーへ書き込まず/);
  assert.doesNotMatch(confirmation, /discardDraft|saveLecture|draft\.patch/);
});


test('optional request tokens survive both native resource status decoders', () => {
  for (const [type, next] of [['DetailResourceStatus', 'enum TemplateFieldValue'], ['TemplateSuggestionState', 'struct ApplyTemplateProposal']]) {
    const status = model.split('struct ' + type + ':')[1].split(next)[0];
    assert.match(status, /var requestId: String\?/);
    assert.match(status, /case status, source, fetchedAt, requestId/);
    assert.match(status, /requestId = try values\.decodeIfPresent\(String\.self, forKey: \.requestId\)/);
  }
});
