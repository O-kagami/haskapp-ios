import Foundation

// Presentation-only calculations. Missing values are never replaced by inferred
// grades or by a default attendance threshold.
struct AssessmentWeight: Identifiable, Equatable {
  let id: String
  let title: String
  let percentage: Int?
  var isValid: Bool { percentage.map { (0...100).contains($0) } ?? true }
}

struct AssessmentSummary {
  let weights: [AssessmentWeight]
  let memo: String?
  let criteria: String?

  init(lecture: Lecture) {
    weights = [
      AssessmentWeight(id: "report", title: "レポート", percentage: lecture.grading_report),
      AssessmentWeight(id: "test", title: "試験", percentage: lecture.grading_test),
      AssessmentWeight(id: "quiz", title: "小テスト", percentage: lecture.grading_quiz)
    ]
    memo = nonempty(lecture.grading_memo)
    criteria = nonempty(lecture.grading_criteria)
  }
  var knownTotal: Double { weights.compactMap(\.percentage).reduce(0) { $0 + Double($1) } }
  var hasWeights: Bool { weights.contains { $0.percentage != nil } }
  var hasMissingWeights: Bool { weights.contains { $0.percentage == nil } }
  var isValid: Bool { weights.allSatisfy(\.isValid) && knownTotal <= 100 }
  // This is explicitly labelled unallocated, never presented as a real
  // "other" assessment method or a prediction of the user's final grade.
  var unallocated: Double? { hasWeights && isValid ? max(0, 100 - knownTotal) : nil }
}

struct AttendanceSummary {
  let absences: Int?
  let total: Int?
  let required: Int?

  init(lecture: Lecture) {
    absences = lecture.absences.flatMap { $0 >= 0 ? $0 : nil }
    total = lecture.grading_attendance_total
    required = lecture.grading_attendance_required
  }
  var hasInvalidCriteria: Bool {
    if let total = total, total < 0 { return true }
    if let required = required, required < 0 { return true }
    if let total = total, let required = required, required > total { return true }
    return false
  }
  var maximumAbsences: Int? {
    guard !hasInvalidCriteria, let total = total, let required = required else { return nil }
    return total - required
  }
  var remainingAbsences: Int? {
    guard let absences = absences, let maximum = maximumAbsences else { return nil }
    return max(0, maximum - absences)
  }
  var exceedsLimit: Bool {
    guard let absences = absences, let maximum = maximumAbsences else { return false }
    return absences > maximum
  }
  var canIncrement: Bool {
    let recorded = absences ?? 0
    guard recorded < 999 else { return false }
    guard let total = total, total >= 0 else { return true }
    return recorded < total
  }
}

func tasksRelated(to lecture: Lecture, in tasks: [PlannerTask]) -> [PlannerTask] {
  let lectureIDs = Set([nonempty(lecture.id), nonempty(lecture.lecture_list_id)].compactMap { $0 })
  let syllabusID = nonempty(lecture.syllabus_id)
  return tasks.filter { task in
    if let id = nonempty(task.related_lecture_id ?? task.lecture_id), lectureIDs.contains(id) { return true }
    if let syllabusID = syllabusID, let taskSyllabusID = nonempty(task.syllabus_id) {
      return taskSyllabusID == syllabusID
    }
    return false
  }.sorted(by: taskDueOrder)
}

func gradePercentage(_ value: Double?) -> String {
  guard let value = value, value.isFinite, (0...100).contains(value) else { return "未取得" }
  return value.formatted(.number.precision(.fractionLength(0...2))) + "%"
}

func validGradeDistribution(_ values: [Double?]) -> [Double?] {
  let normalized = Array(values.prefix(gradeLabels.count)).map { value -> Double? in
    guard let value = value, value.isFinite, (0...100).contains(value) else { return nil }
    return value
  }
  return normalized + Array(repeating: nil, count: max(0, gradeLabels.count - normalized.count))
}

// Derive a combined rate only if every contributing bucket is actually known.
func gradeBucketRate(_ distribution: [Double?], indices: Range<Int>) -> Double? {
  let values = validGradeDistribution(distribution)
  let buckets = indices.compactMap { values.indices.contains($0) ? values[$0] : nil }
  guard buckets.count == indices.count else { return nil }
  let sum = buckets.reduce(0, +)
  return sum <= 100 ? sum : nil
}

struct DetailResourceStatus: Codable, Equatable {
  var status: String = "idle"
  var source: String = "live"
  var fetchedAt: String?
  var requestId: String?
  var stale: Bool = false
  var error: String?

  private enum CodingKeys: String, CodingKey { case status, source, fetchedAt, requestId, stale, error }
  init() {}
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    status = try values.decodeIfPresent(String.self, forKey: .status) ?? "idle"
    source = try values.decodeIfPresent(String.self, forKey: .source) ?? "live"
    fetchedAt = try values.decodeIfPresent(String.self, forKey: .fetchedAt)
    requestId = try values.decodeIfPresent(String.self, forKey: .requestId)
    stale = try values.decodeIfPresent(Bool.self, forKey: .stale) ?? false
    error = try values.decodeIfPresent(String.self, forKey: .error)
  }
}

enum TemplateFieldValue: Codable, Hashable {
  case text(String)
  case number(Double)

  init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer()
    if let number = try? value.decode(Double.self) { self = .number(number) }
    else { self = .text(try value.decode(String.self)) }
  }
  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .text(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    }
  }
  var displayValue: String {
    switch self {
    case .text(let value): return value
    case .number(let value): return value.formatted(.number.precision(.fractionLength(0...2)))
    }
  }
}

struct TemplateProposalField: Codable, Identifiable, Hashable {
  var key: String
  var label: String
  var value: TemplateFieldValue
  var currentValue: TemplateFieldValue?
  var eligible: Bool
  var sourceTemplateId: String
  var sourceCreatedAt: String?
  var conflictCount: Int
  var id: String { key }
  var displayValue: String {
    let suffix: String
    switch key {
    case "grading_report", "grading_test", "grading_quiz": suffix = "%"
    case "grading_attendance_total", "grading_attendance_required": suffix = "回"
    default: suffix = ""
    }
    return value.displayValue + suffix
  }
  func canApply(to lecture: Lecture) -> Bool {
    guard eligible else { return false }
    switch key {
    case "classroom": return nonempty(lecture.classroom) == nil
    case "lecture_details": return nonempty(lecture.lecture_details) == nil
    case "grading_criteria": return nonempty(lecture.grading_criteria) == nil && nonempty(lecture.grading_memo) == nil
    case "grading_attendance_total": return lecture.grading_attendance_total == nil
    case "grading_attendance_required": return lecture.grading_attendance_required == nil
    case "grading_report": return lecture.grading_report == nil
    case "grading_test": return lecture.grading_test == nil
    case "grading_quiz": return lecture.grading_quiz == nil
    default: return false
    }
  }
}

struct TemplateProposal: Codable, Identifiable, Hashable {
  var id: String
  var ownerId: String
  var lectureId: String
  var groupId: String
  var affiliationId: String
  var createdAt: String
  var fields: [TemplateProposalField]
  var sourceLabel: String
  var warning: String
}

struct TemplateSuggestionState: Codable {
  var status: String = "idle"
  var source: String = "live"
  var fetchedAt: String?
  var requestId: String?
  var stale: Bool = false
  var error: String?
  var proposal: TemplateProposal?

  private enum CodingKeys: String, CodingKey { case status, source, fetchedAt, requestId, stale, error, proposal }
  init() {}
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    status = try values.decodeIfPresent(String.self, forKey: .status) ?? "idle"
    source = try values.decodeIfPresent(String.self, forKey: .source) ?? "live"
    fetchedAt = try values.decodeIfPresent(String.self, forKey: .fetchedAt)
    requestId = try values.decodeIfPresent(String.self, forKey: .requestId)
    stale = try values.decodeIfPresent(Bool.self, forKey: .stale) ?? false
    error = try values.decodeIfPresent(String.self, forKey: .error)
    proposal = try values.decodeIfPresent(TemplateProposal.self, forKey: .proposal)
  }
}

struct ApplyTemplateProposal: Encodable {
  let id: String
  let proposalId: String
  let fields: [String]
}

func detailTimestamp(_ value: String?) -> Date? {
  guard let value = value else { return nil }
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = formatter.date(from: value) { return date }
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: value)
}

// These names are two UI aliases for the same persisted Web column.
// Reading the effective value does not mutate either alias; an explicit edit
// updates both, including an empty string, so clearing cannot restore old text.
extension Lecture {
  var assessmentNote: String {
    get { nonempty(grading_memo) ?? grading_criteria ?? "" }
    set {
      grading_memo = newValue
      grading_criteria = newValue
    }
  }
}

struct AssessmentDraft {
  var total: String
  var required: String
  var report: String
  var test: String
  var quiz: String
  var memo: String
  private let initialMemo: String

  init(lecture: Lecture) {
    total = lecture.grading_attendance_total.map(String.init) ?? ""
    required = lecture.grading_attendance_required.map(String.init) ?? ""
    report = lecture.grading_report.map(String.init) ?? ""
    test = lecture.grading_test.map(String.init) ?? ""
    quiz = lecture.grading_quiz.map(String.init) ?? ""
    memo = lecture.assessmentNote
    initialMemo = memo
  }
  private func number(_ value: String) -> Int? { Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) }
  var validationMessage: String? {
    let fields = [("講義回数", total, 999), ("必要出席回数", required, 999), ("レポート", report, 100), ("試験", test, 100), ("小テスト", quiz, 100)]
    for (label, raw, maximum) in fields where nonempty(raw) != nil {
      guard let value = number(raw), (0...maximum).contains(value) else {
        return "\(label)は0〜\(maximum)の整数で入力してください。空欄は未登録です。"
      }
    }
    if let total = number(total), let required = number(required), required > total {
      return "必要出席回数が講義回数を超えています。"
    }
    let sum = [number(report), number(test), number(quiz)].compactMap { $0 }.reduce(0, +)
    if sum > 100 { return "レポート・試験・小テストの合計が100%を超えています。" }
    return nil
  }
  func applying(to current: Lecture) -> Lecture {
    // Invalid nonblank input must never become a nil update, even if a future
    // caller forgets to guard its Save action.
    guard validationMessage == nil else { return current }
    var value = current
    value.grading_attendance_total = number(total)
    value.grading_attendance_required = number(required)
    value.grading_report = number(report)
    value.grading_test = number(test)
    value.grading_quiz = number(quiz)
    // The Web API stores these aliases in one column. Update both only when
    // the user edits the shared text field; ratio-only edits keep newer notes.
    if memo != initialMemo {
      value.assessmentNote = memo
    }
    return value
  }
}

// Recovery of a rejected field proposal is deliberately not a Lecture. The
// optional full-object recovery backup in its JSON is ignored by this decoder.
struct SelectedLectureFieldsDraft: Decodable, Identifiable {
  let id: String
  let patch: [String: TemplateFieldValue]

  var fields: [SelectedLectureFieldDraftValue] {
    patch.keys.sorted().compactMap { key in
      patch[key].map { SelectedLectureFieldDraftValue(key: key, value: $0) }
    }
  }
}

struct SelectedLectureFieldDraftValue: Identifiable {
  let key: String
  let value: TemplateFieldValue
  var id: String { key }
  var label: String {
    switch key {
    case "classroom": return "教室"
    case "lecture_details": return "講義詳細"
    case "grading_criteria": return "評価基準"
    case "grading_memo": return "評価メモ"
    case "grading_attendance_required": return "必要出席回数"
    case "grading_attendance_total": return "講義回数"
    case "grading_report": return "レポート"
    case "grading_test": return "試験"
    case "grading_quiz": return "小テスト"
    default: return key
    }
  }
  var displayValue: String {
    switch key {
    case "grading_report", "grading_test", "grading_quiz": return value.displayValue + "%"
    case "grading_attendance_required", "grading_attendance_total": return value.displayValue + "回"
    default: return value.displayValue
    }
  }
}
