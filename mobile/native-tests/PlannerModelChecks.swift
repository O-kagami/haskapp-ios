// Standalone, Foundation-only native bridge regression checks.
// Run: native-tests/run-model-checks.sh (requires a Swift toolchain; no simulator).
import Foundation

@main
struct PlannerModelChecks {
  struct Failure: Error, CustomStringConvertible { let description: String }
  static var count = 0
  static func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw Failure(description: message) }
    count += 1
  }
  static func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
  }
  static func main() throws {
    let empty = try decode(Snapshot.self, "{}")
    try check(empty.tasks.isEmpty && empty.lectures.isEmpty && empty.account == "端末内のゲスト", "Missing snapshot fields must use safe defaults")
    let task = try decode(PlannerTask.self, #"{"id":"task-1","task_name":"No date","deadline":null,"status":null,"progress_percent":null,"colorTheme":null}"#)
    try check(task.deadline.isEmpty && task.dueDate == nil, "A null deadline must remain absent")
    try check(!task.isOverdue, "An undated task must not appear overdue")
    try check(task.status == "todo" && task.progress_percent == 0, "Null UI fields must use default values")
    try check(task.colorTheme == "violet", "A null theme must not reject the entire snapshot")
    let completed = try decode(PlannerTask.self, #"{"id":"ical-feed-2027-01-03","status":"done"}"#)
    try check(completed.isImported && completed.isCompleted, "Old imported tasks must retain completed state")
    let partial = try decode(PlannerTask.self, #"{"id":"partial","progress_percent":27,"status":"todo"}"#)
    try check(partial.progress_percent == 27 && partial.status == "inProgress", "Real partial progress must be retained and displayed consistently")
    let high = try decode(PlannerTask.self, #"{"id":"high","progress_percent":101}"#)
    let low = try decode(PlannerTask.self, #"{"id":"low","progress_percent":-3}"#)
    try check(high.progress_percent == 100 && low.progress_percent == 0, "Display progress must remain within 0...100")
    let timed = try decode(PlannerTask.self, #"{"id":"timed","deadline":"2027-01-03","scheduled_start_at":"2027-01-02T09:00:00+09:00","scheduled_end_at":"2027-01-02T10:00:00+09:00","start_at":"2026-12-20T08:30:00+09:00","end_at":"2027-01-03T23:59:00+09:00","mobile_insert_id":"stable-id","syllabus_id":"123456","progress_percent":27}"#)
    let roundTrip = try JSONDecoder().decode(PlannerTask.self, from: JSONEncoder().encode(timed))
    try check(roundTrip == timed, "Editing and recovered drafts must retain full timestamp metadata and stable insert IDs")
    try check(taskDueOrder(timed, task) && !taskDueOrder(task, timed), "No-deadline tasks belong after dated tasks")
    let lecture = try decode(Lecture.self, #"{"id":"lecture-1","lecture_name":"Native","instructor":null,"colorTheme":null,"day_of_the_week":null,"period":null,"grading_report":0,"grading_attendance_required":0,"gpa":"0.00"}"#)
    try check(lecture.instructor.isEmpty && lecture.colorTheme == "auto", "Null lecture UI fields must not reject a snapshot")
    try check(lecture.grading_report == 0 && lecture.grading_attendance_required == 0 && lecture.gpa == "0.00", "Zero grading values are real data")
    try check(lecture.gradeDistribution == nil && lecture.historicalEnrollment == nil, "Missing grades must never be synthesized")
    do {
      _ = try decode(PlannerTask.self, #"{"task_name":"Missing identity"}"#)
      throw Failure(description: "A missing task identity must reject decoding rather than create a random replacement")
    } catch is DecodingError { count += 1 }
    try check(dateOnly("2027-02-29") == nil && dateOnly("2028-02-29") == "2028-02-29", "Date validation must handle leap years")
    try check(dateOnly("not-a-date") == nil && dateOnly("") == nil, "Invalid dates must remain absent")
    try check(dateOnly("2027-01-03T23:59:00Z") == "2027-01-03", "Date-only display must match the Web calendar's stored date")
    try check(termForDate(dateValue("2027-01-03")) == "2026年度 2学期（冬ターム）", "January belongs to the previous academic year's winter")
    try check(termForDate(dateValue("2027-03-31")) == "2026年度 2学期（冬ターム）", "March remains in the previous academic year")
    try check(termForDate(dateValue("2027-04-01")) == "2027年度 1学期（春ターム）", "April advances the academic year")
    try check(termForDate(dateValue("2027-06-01")) == "2027年度 1学期（夏ターム）", "June begins the summer term")
    try check(termForDate(dateValue("2027-10-01")) == "2027年度 2学期（秋ターム）", "October begins the autumn term")
    try check(termForDate(dateValue("2027-12-01")) == "2027年度 2学期（冬ターム）", "December begins the winter term")
    let utcBoundary = ISO8601DateFormatter().date(from: "2027-03-31T15:00:00Z")!
    try check(dateString(utcBoundary) == "2027-04-01" && academicYear(for: utcBoundary) == 2027, "Day and academic-year boundaries must use Japan time")
    var historical = lecture; historical.term = "2021年度 1学期（春ターム）"
    let options = availableTerms(lectures: [historical], selected: "2035年度 2学期（冬ターム）")
    try check(options.contains(historical.term!) && options.contains("2035年度 2学期（冬ターム）"), "Historic and selected terms must remain selectable")
    var scheduled = lecture; scheduled.term = "2027年度 1学期（春ターム）"; scheduled.day_of_the_week = 4; scheduled.period = 1
    let april = dateValue("2027-04-01") // Thursday in Japan
    try check(scheduledLectures(on: april, in: [scheduled]).count == 1, "Lecture calendar must match weekday and academic term")
    scheduled.cancelled_date = "2027-04-01T00:00:00+09:00"
    try check(scheduledLectures(on: april, in: [scheduled]).isEmpty, "Cancelled lectures must not appear as active")
    scheduled.cancelled_date = nil; scheduled.term = "2026年度 1学期（春ターム）"
    try check(scheduledLectures(on: april, in: [scheduled]).isEmpty, "Last year's lecture must not appear this year")
    scheduled.term = "2027年度 1学期（春ターム）"; scheduled.syllabus_id = "123456&safe"
    let url = syllabusURL(for: scheduled)!
    let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
    try check(query.first { $0.name == "lct_year" }?.value == "2027", "Syllabus links must use the lecture's year")
    try check(query.first { $0.name == "lct_cd" }?.value == "123456&safe" && query.count == 2, "Syllabus IDs must be encoded as data")
    let event = try decode(PlannerEvent.self, #"{"id":"ical-event","title":"Feed","date":null,"colorTheme":null}"#)
    try check(event.isImported && event.date.isEmpty, "Unknown feed dates must not be fabricated as today")
    let profile = try decode(Profile.self, #"{"department":null,"shareTemplates":null}"#)
    try check(profile.department.isEmpty && !profile.shareTemplates, "Missing profile values must not prevent native display")
    try check(empty.gradeHistory.isEmpty, "A legacy snapshot must not fabricate loaded grade history")
    let loadedEmpty = try decode(Snapshot.self, #"{"gradeHistory":{"lecture-1":[]}}"#)
    try check(loadedEmpty.gradeHistory["lecture-1"] != nil && loadedEmpty.gradeHistory["lecture-1"]!.isEmpty, "Loaded empty history must remain distinguishable from an unrequested lecture")
    let grade = try decode(GradeHistoryRow.self, #"{"id":"cohort-1","academicTerm":"2025 Spring","instructor":"Actual instructor","lectureTitle":"Actual title","faculty":"Actual faculty","enrollment":0,"gpa":0,"distribution":[0,null,100,0,0,0,0,0,0,0,0],"preferred":true}"#)
    try check(grade.enrollment == 0 && grade.gpa == 0 && grade.distribution[0] == 0, "Real zero grade metadata and buckets must survive decoding")
    try check(grade.distribution[1] == nil && grade.distribution.count == 11, "Unknown grade buckets must remain nil among all eleven labels")
    try check(gradeLabels == ["A+", "A", "A−", "B+", "B", "B−", "C+", "C", "D", "D−", "F"], "Historical grade bucket order must match Web")
    let gradeRoundTrip = try JSONDecoder().decode(GradeHistoryRow.self, from: JSONEncoder().encode(grade))
    try check(gradeRoundTrip == grade, "Grade history round trips must retain unknown buckets and metadata")
    let missingGrade = try decode(GradeHistoryRow.self, #"{"id":"cohort-2","distribution":[0,null]}"#)
    try check(missingGrade.gpa == nil && missingGrade.enrollment == nil && missingGrade.instructor == nil && missingGrade.faculty == nil, "Missing cohort metadata must never be synthesized")
    try check(missingGrade.distribution.count == 11 && missingGrade.distribution[0] == 0 && missingGrade.distribution.dropFirst().allSatisfy { $0 == nil }, "Older short distributions must be padded only with unknown values")
    try check(!missingGrade.preferred && missingGrade.pickerTitle == "年度未登録", "Missing cohort labels must be presented as unknown")
    try check(selectedGradeHistoryRow(in: [missingGrade, grade], selectedID: "")?.id == grade.id, "The backend's preferred cohort must be selected initially")
    try check(selectedGradeHistoryRow(in: [missingGrade, grade], selectedID: missingGrade.id)?.id == missingGrade.id, "Explicit cohort selection must override the preferred cohort")
    try check(selectedGradeHistoryRow(in: [], selectedID: "") == nil, "Empty grade history must not create a placeholder cohort")
    try check(!lecture.schedule_is_shared && !Lecture().schedule_is_shared, "Guest and legacy lecture records must default to editable local schedules")
    let sharedLecture = try decode(Lecture.self, #"{"id":"shared-lecture","schedule_is_shared":true}"#)
    let sharedRoundTrip = try JSONDecoder().decode(Lecture.self, from: JSONEncoder().encode(sharedLecture))
    try check(sharedRoundTrip.schedule_is_shared, "Shared schedule ownership must survive editing and draft round trips")
    let nullShared = try decode(Lecture.self, #"{"id":"legacy-lecture","schedule_is_shared":null}"#)
    try check(!nullShared.schedule_is_shared, "Older nullable shared flags must not prevent decoding")
    let undatedSchedule = try decode(PublicSchedule.self, #"{"day_of_week":1,"start_time":"08:45:00","end_time":"10:15:00"}"#)
    try check(canonicalTerm(for: undatedSchedule) == legacyDefaultTerm && canonicalTerm(for: nil) == legacyDefaultTerm, "Undated shared schedules must retain the historical Web term")
    let januarySchedule = try decode(PublicSchedule.self, #"{"period_start_daytime":"2027-01-15T00:00:00Z"}"#)
    try check(canonicalTerm(for: januarySchedule) == "2026年度 2学期（冬ターム）", "Shared January schedules belong to the prior academic year")
    let boundarySchedule = try decode(PublicSchedule.self, #"{"period_start_daytime":"2027-03-31T23:59:00Z"}"#)
    try check(canonicalTerm(for: boundarySchedule) == "2026年度 2学期（冬ターム）", "Canonical term uses the stored date prefix, never a device timezone shift")
    let springSchedule = try decode(PublicSchedule.self, #"{"period_start_daytime":"2027-04-01T00:00:00Z"}"#)
    try check(canonicalTerm(for: springSchedule) == "2027年度 1学期（春ターム）", "Shared registration must use its actual canonical term")
    let invalidSchedule = try decode(PublicSchedule.self, #"{"period_start_daytime":"2027-02-29T00:00:00Z"}"#)
    try check(canonicalTerm(for: invalidSchedule) == legacyDefaultTerm, "Invalid shared date anchors must not fabricate a current term")

    let oldProfile = try decode(Profile.self, #"{"department":"工学部","major":"情報理工学コース"}"#)
    try check(oldProfile.studentYear == 0 && oldProfile.classGroup.isEmpty, "Legacy profiles must not invent a study year/class")
    let yearProfile = try decode(Profile.self, #"{"studentYear":2,"classGroup":"B"}"#)
    try check(yearProfile.studentYear == 2 && yearProfile.classGroup == "B", "Study year and class remain independent of academic term")
    try check(empty.officialSelection.isEmpty && empty.officialLectures.isEmpty, "Legacy snapshots do not invent selected official subjects")
    try check(!empty.chat.ready && empty.chat.messages.isEmpty, "Legacy snapshots never fabricate an active chat/history")
    let officialCatalogData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let officialCatalog = try JSONDecoder().decode(OfficialCatalog.self, from: officialCatalogData)
    try check(officialCatalog.courses.count == 154 && officialCatalog.courses.filter { $0.intensive }.count == 9, "Official catalog fully decodes into native models")
    var officialSnapshot = Snapshot(); officialSnapshot.officialCatalog = officialCatalog
    var mondayOfficial = Lecture(); mondayOfficial.lecture_name = "Source-backed Monday"; mondayOfficial.day_of_the_week = 1; mondayOfficial.term = "2026年度 2学期（秋ターム）"
    officialSnapshot.officialLectures = [mondayOfficial]
    try check(scheduledOfficialLectures(on: ISO8601DateFormatter().date(from: "2026-10-15T03:00:00Z")!, snapshot: officialSnapshot).count == 1, "University Thursday override uses Monday official schedule")
    // Lecture detail calculations preserve the distinction between unknown and 0.
    var assessmentLecture = Lecture()
    let unknownAssessment = AssessmentSummary(lecture: assessmentLecture)
    try check(!unknownAssessment.hasWeights && unknownAssessment.unallocated == nil, "Absent assessment criteria must not invent a 100% Other category")
    assessmentLecture.grading_report = 0
    assessmentLecture.grading_test = 70
    let partialAssessment = AssessmentSummary(lecture: assessmentLecture)
    try check(partialAssessment.hasWeights && partialAssessment.hasMissingWeights && partialAssessment.weights[0].percentage == 0, "Explicit zero and missing assessment weights must be distinguishable")
    try check(partialAssessment.knownTotal == 70 && partialAssessment.unallocated == 30, "Remainder is unallocated, not a named assessment method")
    assessmentLecture.grading_quiz = 31
    try check(!AssessmentSummary(lecture: assessmentLecture).isValid, "Assessment ratios above 100% must be flagged")
    assessmentLecture.grading_quiz = -1
    try check(!AssessmentSummary(lecture: assessmentLecture).isValid, "Negative assessment ratios must not be rendered as chart data")
    assessmentLecture.grading_quiz = nil
    try check(AttendanceSummary(lecture: assessmentLecture).maximumAbsences == nil, "Unknown attendance criteria must not invent a five-absence allowance")
    assessmentLecture.grading_attendance_total = 15; assessmentLecture.grading_attendance_required = 10; assessmentLecture.absences = nil
    let unrecordedAttendance = AttendanceSummary(lecture: assessmentLecture)
    try check(unrecordedAttendance.absences == nil && unrecordedAttendance.remainingAbsences == nil && !unrecordedAttendance.exceedsLimit, "Unrecorded absences never become zero or a predicted remaining allowance")
    assessmentLecture.absences = 6
    let attendance = AttendanceSummary(lecture: assessmentLecture)
    try check(attendance.maximumAbsences == 5 && attendance.remainingAbsences == 0 && attendance.exceedsLimit, "Attendance warning must derive from saved criteria")
    assessmentLecture.grading_attendance_total = 0; assessmentLecture.grading_attendance_required = 0; assessmentLecture.absences = 0
    try check(AttendanceSummary(lecture: assessmentLecture).maximumAbsences == 0 && !AttendanceSummary(lecture: assessmentLecture).canIncrement, "Explicit zero attendance criteria must be respected")
    assessmentLecture.grading_attendance_required = 1
    try check(AttendanceSummary(lecture: assessmentLecture).hasInvalidCriteria && AttendanceSummary(lecture: assessmentLecture).maximumAbsences == nil, "Contradictory attendance criteria must not create a computed threshold")

    let malformedDistribution = validGradeDistribution([0, nil, -1, 101, .infinity])
    try check(malformedDistribution.count == 11 && malformedDistribution[0] == 0 && malformedDistribution.dropFirst().allSatisfy { $0 == nil }, "Invalid grade percentages must remain unknown and all eleven buckets retained")
    try check(gradePercentage(nil) == "未取得" && gradePercentage(0) == "0%", "Missing historical percentages must not be rendered as zero")
    try check(gradeBucketRate([20, nil, 30], indices: 0..<3) == nil, "An aggregate A-band rate requires all contributing buckets")
    try check(gradeBucketRate([0, 0, 0], indices: 0..<3) == 0, "A real zero A-band rate remains zero")
    try check(gradeBucketRate([60, 60, 0], indices: 0..<3) == nil, "Inconsistent aggregates above 100% are not synthesized")

    let field = try decode(TemplateProposalField.self, #"{"key":"grading_report","label":"レポート","value":80,"currentValue":0,"eligible":true,"sourceTemplateId":"template","sourceCreatedAt":null,"conflictCount":1}"#)
    try check(field.value == .number(80) && field.currentValue == .number(0) && field.displayValue == "80%", "Template proposal numbers and existing zero must decode faithfully")
    assessmentLecture.grading_report = 0
    try check(!field.canApply(to: assessmentLecture), "A proposal must never enable overwriting a current zero")
    assessmentLecture.grading_report = nil
    try check(field.canApply(to: assessmentLecture), "A genuinely blank eligible field can be selected")
    var unknownField = field; unknownField.key = "memo"
    try check(!unknownField.canApply(to: assessmentLecture), "Unsupported fields including personal memo must not be selectable")
    var criteriaField = field; criteriaField.key = "grading_criteria"; criteriaField.value = .text("Shared criteria")
    assessmentLecture.grading_memo = "My explicit notes"
    try check(!criteriaField.canApply(to: assessmentLecture), "Existing personal assessment memo blocks shared criteria suggestions")
    assessmentLecture.grading_memo = ""; assessmentLecture.grading_criteria = "  "
    try check(criteriaField.canApply(to: assessmentLecture), "Whitespace-only criteria are treated as blank")
    var blockedField = field; blockedField.eligible = false
    try check(!blockedField.canApply(to: assessmentLecture), "Server-ineligible proposal fields stay blocked")
    let metadataGrade = try decode(GradeHistoryRow.self, #"{"id":"metadata-grade","subjectName":"Actual subject","courseProgram":"Actual program","dataType":"Actual cohort type","classCode":"Actual code","matchKind":"instructor","source":"grade_distributions","sourceLabel":"Actual source"}"#)
    try check(metadataGrade.subjectName == "Actual subject" && metadataGrade.courseProgram == "Actual program" && metadataGrade.dataType == "Actual cohort type" && metadataGrade.classCode == "Actual code", "Native grade metadata must carry exact source subject, program, cohort and code")
    try check(metadataGrade.matchKind == "instructor" && metadataGrade.sourceLabel == "Actual source", "Grade match confidence and source labels survive the bridge")
    try check(empty.gradeHistoryStatus.isEmpty && empty.templateSuggestions.isEmpty, "Older snapshots do not invent resource states or template previews")
    let resourceSnapshot = try decode(Snapshot.self, #"{"gradeHistoryStatus":{"lecture":{"status":"error","source":"cache","fetchedAt":"2026-10-05T00:00:00Z","stale":true,"error":"Offline"}},"templateSuggestions":{"lecture":{"status":"empty","source":"live","stale":false}}}"#)
    try check(resourceSnapshot.gradeHistoryStatus["lecture"]?.stale == true && resourceSnapshot.gradeHistoryStatus["lecture"]?.source == "cache", "Snapshot bridge preserves offline historical provenance")
    try check(resourceSnapshot.templateSuggestions["lecture"]?.status == "empty" && resourceSnapshot.templateSuggestions["lecture"]?.proposal == nil, "A known empty proposal remains distinguishable from no lookup")
    let oldResource = try decode(DetailResourceStatus.self, "{}")
    try check(oldResource.status == "idle" && oldResource.fetchedAt == nil && !oldResource.stale, "Missing status metadata must decode without invented timestamps")
    let cachedState = try decode(TemplateSuggestionState.self, #"{"status":"error","source":"cache","stale":true,"error":"Offline"}"#)
    try check(cachedState.stale && cachedState.source == "cache" && cachedState.proposal == nil, "Offline errors remain distinct from a loaded empty proposal")
    try check(detailTimestamp("bad date") == nil && detailTimestamp("2026-10-05T00:00:00.123Z") != nil && detailTimestamp("2026-10-05T00:00:00Z") != nil, "Source dates only display when parseable; both ISO timestamp forms are supported")

    var draft = AssessmentDraft(lecture: Lecture())
    draft.report = "0"; draft.test = "70"
    try check(draft.validationMessage == nil, "Zero and partial criteria are valid inputs")
    var newerLecture = Lecture(); newerLecture.memo = "Newer unrelated note"; newerLecture.absences = 4
    let appliedDraft = draft.applying(to: newerLecture)
    try check(appliedDraft.grading_report == 0 && appliedDraft.grading_test == 70 && appliedDraft.grading_quiz == nil, "Assessment edits preserve explicit zero and absent inputs")
    try check(appliedDraft.memo == newerLecture.memo && appliedDraft.absences == 4, "Assessment editor merges into the latest lecture without reverting unrelated edits")
    draft.quiz = "31"
    try check(draft.validationMessage != nil, "A ratio sum above 100% blocks saving")
    draft.quiz = "abc"
    try check(draft.validationMessage != nil, "Malformed numeric inputs are not silently saved as unknown")
    var savedNumericLecture = Lecture(); savedNumericLecture.grading_report = 0; savedNumericLecture.grading_test = 70; savedNumericLecture.grading_attendance_total = 15
    var rawNumericDraft = AssessmentDraft(lecture: savedNumericLecture)
    rawNumericDraft.report = "not a number"
    try check(rawNumericDraft.report == "not a number" && rawNumericDraft.validationMessage != nil, "Full-editor raw malformed numeric text stays visible for correction")
    try check(rawNumericDraft.applying(to: savedNumericLecture) == savedNumericLecture, "Malformed numeric text cannot silently clear a previously saved zero or count")
    rawNumericDraft.report = "50"
    try check(rawNumericDraft.validationMessage != nil && rawNumericDraft.applying(to: savedNumericLecture) == savedNumericLecture, "Full-editor ratios totaling above 100 percent leave the original lecture unchanged")
    rawNumericDraft.report = "0"; rawNumericDraft.total = "1.5"
    try check(rawNumericDraft.validationMessage != nil && rawNumericDraft.applying(to: savedNumericLecture).grading_attendance_total == 15, "Noninteger attendance input cannot clear an existing attendance count")
    rawNumericDraft.total = ""
    try check(rawNumericDraft.validationMessage == nil && rawNumericDraft.applying(to: savedNumericLecture).grading_attendance_total == nil && rawNumericDraft.applying(to: savedNumericLecture).grading_report == 0, "Only an intentional blank clears the count while preserving explicit zero weights")
    draft.quiz = ""; draft.total = "10"; draft.required = "11"
    try check(draft.validationMessage != nil, "Contradictory attendance input blocks saving")

    var aliases = Lecture(); aliases.grading_memo = "Personal assessment note"; aliases.grading_criteria = "Older criteria"; aliases.memo = "Unrelated lecture note"
    try check(aliases.assessmentNote == "Personal assessment note" && aliases.grading_criteria == "Older criteria", "Reading the effective note must preserve both original aliases")
    var legacyAliases = aliases; legacyAliases.grading_memo = nil
    try check(legacyAliases.assessmentNote == "Older criteria", "The full lecture editor must show criteria when only the legacy alias is populated")
    legacyAliases.grading_report = 0
    try check(legacyAliases.grading_memo == nil && legacyAliases.grading_criteria == "Older criteria", "Unrelated full-editor ratio changes do not synchronize or overwrite note aliases")
    legacyAliases.assessmentNote = ""
    try check(legacyAliases.assessmentNote.isEmpty && legacyAliases.grading_memo == "" && legacyAliases.grading_criteria == "" && legacyAliases.memo == "Unrelated lecture note", "Full-editor clearing must clear both assessment aliases and preserve the lecture memo")
    legacyAliases.assessmentNote = "Replacement criteria"
    try check(legacyAliases.grading_memo == "Replacement criteria" && legacyAliases.grading_criteria == "Replacement criteria", "Full-editor explicit note edits update both persisted aliases")
    var aliasDraft = AssessmentDraft(lecture: aliases)
    try check(aliasDraft.memo == "Personal assessment note", "The single assessment note field uses the Web alias precedence")
    var newerAliases = aliases; newerAliases.grading_memo = "Newer personal note"
    aliasDraft.report = "10"
    try check(aliasDraft.applying(to: newerAliases).grading_memo == "Newer personal note", "Ratio-only assessment changes cannot overwrite a newer note")
    aliasDraft.memo = "Changed assessment criteria"
    let changedAliases = aliasDraft.applying(to: aliases)
    try check(changedAliases.grading_memo == "Changed assessment criteria" && changedAliases.grading_criteria == "Changed assessment criteria" && changedAliases.memo == "Unrelated lecture note", "An explicit text edit updates both stored aliases without changing the lecture memo")
    aliasDraft.memo = ""
    try check(aliasDraft.applying(to: aliases).grading_memo == "" && aliasDraft.applying(to: aliases).grading_criteria == "", "Explicitly clearing the assessment note clears both aliases")

    var relatedLecture = Lecture(); relatedLecture.id = "schedule"; relatedLecture.lecture_list_id = "group"; relatedLecture.syllabus_id = "syllabus"
    var personalTask = PlannerTask(); personalTask.id = "personal"; personalTask.lecture_id = nil; personalTask.syllabus_id = nil
    var groupTask = PlannerTask(); groupTask.id = "group-task"; groupTask.lecture_id = "group"
    var slotTask = PlannerTask(); slotTask.id = "slot-task"; slotTask.lecture_id = "schedule"
    var syllabusTask = PlannerTask(); syllabusTask.id = "syllabus-task"; syllabusTask.syllabus_id = "syllabus"
    let relatedIDs = Set(tasksRelated(to: relatedLecture, in: [personalTask, groupTask, slotTask, syllabusTask]).map(\.id))
    try check(relatedIDs == Set(["group-task", "slot-task", "syllabus-task"]), "Related tasks support schedule, canonical lecture, and syllabus identities without matching unrelated nils")
    try check(TaskBoardStatus.allCases.map(\.rawValue) == ["todo", "inProgress", "done"], "Native task board uses exact Web status keys")
    try check(TaskBoardStatus.allCases.map(\.initialProgress) == [0, 50, 100], "Board-created tasks use the existing progress/status mapping")
    var importedBoardTask = PlannerTask(); importedBoardTask.id = "ical-board-check"
    try check(TaskBoardStatus.available(for: importedBoardTask) == [.todo, .inProgress, .done], "Imported assignments support local in-progress without modifying the feed")
    try check(TaskBoardStatus.available(for: PlannerTask()) == TaskBoardStatus.allCases, "Personal tasks can move to all three existing statuses")
    let februaryDays = calendarMonthDays(containing: dateValue("2024-02-15"))
    try check(februaryDays.count == 35 && dateString(februaryDays.first!) == "2024-01-28" && dateString(februaryDays.last!) == "2024-03-02", "Leap February month grid spans full Sunday-to-Saturday weeks")
    try check(februaryDays.contains { dateString($0) == "2024-02-29" }, "Leap-day must be selectable")
    let januaryDays = calendarMonthDays(containing: dateValue("2027-01-01"))
    try check(januaryDays.count == 42 && dateString(januaryDays.first!) == "2026-12-27" && dateString(januaryDays.last!) == "2027-02-06", "Month grid crosses year boundary without dropping days")
    try check(Set(januaryDays.map(dateString)).count == januaryDays.count, "Month grid has no duplicate day identities")
    var calendarTask = PlannerTask(); calendarTask.deadline = "2026-10-05"; calendarTask.scheduled_date = "2026-10-05"
    var noDateTask = PlannerTask(); noDateTask.deadline = ""; noDateTask.scheduled_date = "2026-02-30"
    var calendarEvent = PlannerEvent(); calendarEvent.id = "ical-calendar-check"; calendarEvent.date = "2026-10-05T12:00:00Z"
    let daySummary = calendarDaySummary("2026-10-05", tasks: [calendarTask, noDateTask], events: [calendarEvent])
    try check(daySummary.events == 1 && daySummary.deadlines == 1 && daySummary.work == 1 && daySummary.total == 3, "Day summary includes imported events and distinguishes deadline from work records")
    try check(daySummary.label == "予定1件、課題期限1件、作業予定1件", "VoiceOver day summary explains markers without relying on color")
    let emptyDay = calendarDaySummary("2026-10-06", tasks: [calendarTask, noDateTask], events: [calendarEvent])
    try check(emptyDay.total == 0 && emptyDay.label.contains("なし"), "Undated and malformed entries never create month markers")
    let summaries = calendarDaySummaries(tasks: [calendarTask, noDateTask], events: [calendarEvent])
    try check(summaries.count == 1 && summaries["2026-10-05"]?.label == daySummary.label, "Month aggregation matches day agenda counts and ignores malformed dates in one pass")
    var todaySnapshot = Snapshot()
    var firstSlot = Lecture(); firstSlot.lecture_name = "Same course"; firstSlot.classroom = "A13"; firstSlot.day_of_the_week = 1; firstSlot.period = 1; firstSlot.term = "2026年度 2学期（秋ターム）"
    var nextSlot = firstSlot; nextSlot.id = "second-slot"; nextSlot.period = 2; nextSlot.classroom = "M151"
    todaySnapshot.lectures = [nextSlot, firstSlot]
    let mondaySlots = todayPeriods(on: dateValue("2026-10-05"), snapshot: todaySnapshot)
    try check(mondaySlots.map(\.period) == [1,2,3,4,5], "Today always exposes all five periods in fixed order")
    try check(mondaySlots[0].lectures.first?.classroom == "A13" && mondaySlots[1].lectures.first?.classroom == "M151", "Continuous course slots retain per-slot classrooms")
    try check(mondaySlots[2...4].allSatisfy { $0.lectures.isEmpty }, "Unscheduled periods stay empty")
    let sundaySlots = todayPeriods(on: dateValue("2026-10-04"), snapshot: todaySnapshot)
    try check(sundaySlots.count == 5 && sundaySlots.allSatisfy { $0.lectures.isEmpty }, "Weekend must not fabricate weekday courses")
    try check(todayPeriods(on: dateValue("2026-10-06"), snapshot: todaySnapshot).allSatisfy { $0.lectures.isEmpty }, "Date changes reselect actual weekday courses")
    let atNine = plannerCalendar.date(bySettingHour: 9, minute: 0, second: 0, of: dateValue("2026-10-05"))!
    try check(todayPeriods(on: atNine, snapshot: todaySnapshot).first?.current == true, "Current-period indicator follows Tokyo clock")
    let week = calendarWeekDays(containing: dateValue("2026-10-18"))
    try check(week.map(dateString) == ["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"], "Weekly calendar starts on Monday and spans all seven days")
    var shared = firstSlot; shared.memo = "PRIVATE MEMO"; shared.absences = 8; shared.belongings = "PRIVATE ITEMS"; shared.grading_test = 80
    let qr = try encodeTimetable([shared], term: shared.term!)
    try check(!qr.contains("PRIVATE") && !qr.contains("absences") && !qr.contains("grading"), "QR explicitly excludes private fields")
    let imported = try decodeTimetable(qr)
    try check(imported.count == 1 && imported[0].lecture_name == shared.lecture_name && imported[0].id != shared.id && imported[0].lecture_list_id == nil, "QR import creates independent personal lectures without room or account IDs")
    try check(imported[0].absences == nil, "QR cannot transfer attendance or fabricate zero")
    do { _ = try encodeTimetable([shared, shared], term: shared.term!); throw Failure(description: "Duplicate QR slots must fail") } catch is TimetableShareError { count += 1 }
    do { _ = try decodeTimetable(qr.replacingOccurrences(of: "HaskappTimetable", with: "OtherType")); throw Failure(description: "Wrong QR kind must fail") } catch is TimetableShareError { count += 1 }
    do { _ = try decodeTimetable(String(repeating: "x", count: 2201)); throw Failure(description: "Oversized QR must fail") } catch is TimetableShareError { count += 1 }
    var twiceA = shared; twiceA.id = "official-stable:秋:1:1"; twiceA.lecture_list_id = nil
    var twiceB = twiceA; twiceB.id = "official-stable:秋:3:2"; twiceB.day_of_the_week = 3; twiceB.period = 2; twiceB.classroom = "Second room"
    var namesake = twiceA; namesake.id = "official-other:秋:4:3"; namesake.day_of_the_week = 4; namesake.period = 3
    try check(shareableLectureGroups([twiceA, twiceB, namesake]).map { $0.lectures.count } == [2,1], "QR selection groups by stable ID, never by a matching course name")
    let multiSlotQR = try encodeTimetable([twiceA, twiceB, namesake], term: shared.term!)
    let multiSlotImport = try decodeTimetable(multiSlotQR)
    try check(multiSlotImport.count == 3 && multiSlotImport.map { "\($0.day_of_the_week):\($0.period)" } == ["1:1","3:2","4:3"], "Grouping preserves every weekday and period through QR roundtrip")
    try check(shareableLectureGroups(multiSlotImport).map { $0.lectures.count } == [2,1] && multiSlotImport[1].classroom == "Second room", "Imported repeated slots keep private grouping and individual classrooms")
    try check(!multiSlotQR.contains("official-stable") && !multiSlotQR.contains("official-other") && !multiSlotQR.contains("sharing_group_id"), "QR exposes only ephemeral grouping labels, never stored IDs")
    var largeRows: [Lecture] = []
    for day in 1...5 { for period in 1...5 { var row = shared; row.id = "official-\(day)-\(period):秋:\(day):\(period)"; row.day_of_the_week = day; row.period = period; row.lecture_name = String(repeating: "長い科目", count: 20); row.instructor = String(repeating: "教員", count: 20); largeRows.append(row) } }
    let qrPages = try encodeTimetablePages(largeRows, term: shared.term!)
    let allPages = try qrPages.flatMap(decodeTimetable)
    try check(qrPages.count > 1 && qrPages.allSatisfy { $0.utf8.count <= 2200 } && allPages.count == 25, "Long timetables split into decodable QR pages without dropping any of 25 slots")
    try check(Set(allPages.map { "\($0.day_of_the_week):\($0.period)" }).count == 25, "QR pagination preserves distinct slot identities")
    let groupedPages = try encodeTimetablePages([twiceA, twiceB] + Array(largeRows.filter { !["1:1","3:2"].contains("\($0.day_of_the_week):\($0.period)") }.prefix(10)), term: shared.term!)
    let groupedSlotCounts = try groupedPages.map { try decodeTimetable($0).filter { $0.lecture_name == twiceA.lecture_name }.count }.filter { $0 > 0 }
    try check(groupedSlotCounts == [2], "A course with several weekly slots stays together on one QR page")
    let linked = try decode(PlannerEvent.self, #"{"id":"ev","relatedLectureID":"club-1","date":"2026-10-20"}"#)
    try check(linked.relatedLectureID == "club-1", "Event relation survives native bridge decoding")
    let activity = ClubActivity(); try check(activity.lecture.period == 0 && activity.lecture.day_of_the_week == -1, "Club activities have no invented timetable slot")
    var moved = firstSlot; moved.id = "new-course"; moved.lecture_name = "New course"
    try check(lectureConflictMessage(moved, existing: [firstSlot]) != nil, "New native lecture is blocked from occupied slot")
    try check(lectureConflictMessage(firstSlot, existing: [firstSlot, moved]) == nil, "Existing overlaps remain editable without deleting old data")
    moved.period = 3; try check(lectureConflictMessage(moved, existing: [firstSlot]) == nil, "Moving to an unoccupied period is allowed")
    let unknownTaskLink = try decode(PlannerTask.self, #"{"id":"task","related_lecture_id":"private-lecture","lecture_id":null}"#)
    try check(unknownTaskLink.related_lecture_id == "private-lecture", "Private task association survives native decoding without a server group")
    try check(initialPlannerTab([]) == "today", "Normal launch keeps the default tab")
    try check(initialPlannerTab(["--haskapp-review-screen", "week"]) == "calendar", "Review routing can open weekly calendar without data actions")
    try check(requestedReviewScreen(["--haskapp-review-screen", "logout"]) == nil, "Unknown or mutating review routes are rejected")
    try check(requestedReviewScreen(["--haskapp-review-screen"]) == nil, "Missing review argument is ignored")
    var overlaySnapshot = todaySnapshot
    var replacement = firstSlot; replacement.id = "official-replacement:秋:1:3"; replacement.period = 3
    overlaySnapshot.timetableView.terms[firstSlot.term!] = [replacement]
    overlaySnapshot.timetableView.hidden[firstSlot.term!] = [firstSlot.id, nextSlot.id]
    try check(effectiveTimetableLectures(overlaySnapshot).map(\.id) == [replacement.id] && overlaySnapshot.lectures.count == 2, "Replacement display never deletes source lecture records")
    var addedLater = firstSlot; addedLater.id = "new-after-replacement"; addedLater.period = 4
    overlaySnapshot.lectures.append(addedLater)
    try check(Set(effectiveTimetableLectures(overlaySnapshot).map(\.id)) == Set([replacement.id, addedLater.id]), "New courses remain visible after a display replacement")
    try check(todayPeriods(on: dateValue("2026-10-05"), snapshot: overlaySnapshot)[2].lectures.first?.id == replacement.id, "Today reads the same timetable replacement as the grid")
    print("Passed \(count) native model checks")
  }
}
