import Foundation

struct Lecture: Codable, Identifiable, Hashable {
  var id = UUID().uuidString
  var lecture_list_id: String? = nil
  var sharing_group_id: String? = nil
  var schedule_is_shared = false
  var personal_entry = false
  var term: String? = termForDate(Date())
  var lecture_name = ""
  var classroom: String? = ""
  var day_of_the_week = 1
  var period = 1
  var colorTheme = "auto"
  var instructor = ""
  var lecture_details: String? = ""
  var memo: String? = ""
  var belongings: String? = ""
  var absences: Int? = 0
  var grading_attendance_required: Int? = nil
  var grading_attendance_total: Int? = nil
  var grading_report: Int? = nil
  var grading_test: Int? = nil
  var grading_quiz: Int? = nil
  var grading_criteria: String? = ""
  var grading_memo: String? = ""
  var test_datetime: String? = nil
  var cancelled_date: String? = nil
  var syllabus_id: String? = nil
  var gpa: String? = nil
  var aRate: String? = nil
  var passRate: String? = nil
  var historicalInstructor: String? = nil
  var historicalEnrollment: String? = nil
  var gradeDistribution: [Double]? = nil
  var template_creator_id:String? = nil
  var template_rating:Int? = nil

  init() {}

  private enum CodingKeys: String, CodingKey {
    case sharing_group_id, id, lecture_list_id, schedule_is_shared, personal_entry, term, lecture_name, classroom, day_of_the_week, period, colorTheme, instructor, lecture_details, memo, belongings, absences, grading_attendance_required, grading_attendance_total, grading_report, grading_test, grading_quiz, grading_criteria, grading_memo, test_datetime, cancelled_date, syllabus_id, gpa, aRate, passRate, historicalInstructor, historicalEnrollment, gradeDistribution, template_creator_id, template_rating
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    sharing_group_id = try values.decodeIfPresent(String.self, forKey: .sharing_group_id)
    lecture_list_id = try values.decodeIfPresent(String.self, forKey: .lecture_list_id)
    schedule_is_shared = try values.decodeIfPresent(Bool.self, forKey: .schedule_is_shared) ?? false
    personal_entry = try values.decodeIfPresent(Bool.self, forKey: .personal_entry) ?? false
    term = try values.decodeIfPresent(String.self, forKey: .term)
    lecture_name = try values.decodeIfPresent(String.self, forKey: .lecture_name) ?? ""
    classroom = try values.decodeIfPresent(String.self, forKey: .classroom)
    day_of_the_week = try values.decodeIfPresent(Int.self, forKey: .day_of_the_week) ?? 1
    period = try values.decodeIfPresent(Int.self, forKey: .period) ?? 1
    colorTheme = try values.decodeIfPresent(String.self, forKey: .colorTheme) ?? "auto"
    instructor = try values.decodeIfPresent(String.self, forKey: .instructor) ?? ""
    lecture_details = try values.decodeIfPresent(String.self, forKey: .lecture_details)
    memo = try values.decodeIfPresent(String.self, forKey: .memo)
    belongings = try values.decodeIfPresent(String.self, forKey: .belongings)
    absences = try values.decodeIfPresent(Int.self, forKey: .absences)
    grading_attendance_required = try values.decodeIfPresent(Int.self, forKey: .grading_attendance_required)
    grading_attendance_total = try values.decodeIfPresent(Int.self, forKey: .grading_attendance_total)
    grading_report = try values.decodeIfPresent(Int.self, forKey: .grading_report)
    grading_test = try values.decodeIfPresent(Int.self, forKey: .grading_test)
    grading_quiz = try values.decodeIfPresent(Int.self, forKey: .grading_quiz)
    grading_criteria = try values.decodeIfPresent(String.self, forKey: .grading_criteria)
    grading_memo = try values.decodeIfPresent(String.self, forKey: .grading_memo)
    test_datetime = try values.decodeIfPresent(String.self, forKey: .test_datetime)
    cancelled_date = try values.decodeIfPresent(String.self, forKey: .cancelled_date)
    syllabus_id = try values.decodeIfPresent(String.self, forKey: .syllabus_id)
    gpa = try values.decodeIfPresent(String.self, forKey: .gpa)
    aRate = try values.decodeIfPresent(String.self, forKey: .aRate)
    passRate = try values.decodeIfPresent(String.self, forKey: .passRate)
    historicalInstructor = try values.decodeIfPresent(String.self, forKey: .historicalInstructor)
    historicalEnrollment = try values.decodeIfPresent(String.self, forKey: .historicalEnrollment)
    gradeDistribution = try values.decodeIfPresent([Double].self, forKey: .gradeDistribution)
    template_creator_id = try values.decodeIfPresent(String.self, forKey: .template_creator_id)
    template_rating = try values.decodeIfPresent(Int.self, forKey: .template_rating)
  }

}
struct PlannerTask: Codable, Identifiable, Hashable {
  var related_lecture_id: String? = nil
  var id = UUID().uuidString
  var task_name = ""
  // Empty string represents a task without a deadline, matching the Web API.
  var deadline = dateString(Date())
  var scheduled_start_at: String? = nil
  var scheduled_end_at: String? = nil
  var start_at: String? = nil
  var end_at: String? = nil
  var mobile_insert_id: String? = nil
  var syllabus_id: String? = nil
  var task_details: String? = ""
  var estimated_duration: String? = nil
  var progress_percent = 0
  var status = "todo"
  var colorTheme = "violet"
  var lecture_id: String? = nil
  var assigned_date: String? = nil
  var scheduled_date: String? = nil

  init() {}

  private enum CodingKeys: String, CodingKey {
    case related_lecture_id
    case id, task_name, deadline, scheduled_start_at, scheduled_end_at, start_at, end_at, mobile_insert_id, syllabus_id, task_details, estimated_duration, progress_percent, status, colorTheme, lecture_id, assigned_date, scheduled_date
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    related_lecture_id = try values.decodeIfPresent(String.self, forKey: .related_lecture_id)
    task_name = try values.decodeIfPresent(String.self, forKey: .task_name) ?? ""
    deadline = try values.decodeIfPresent(String.self, forKey: .deadline) ?? ""
    scheduled_start_at = try values.decodeIfPresent(String.self, forKey: .scheduled_start_at)
    scheduled_end_at = try values.decodeIfPresent(String.self, forKey: .scheduled_end_at)
    start_at = try values.decodeIfPresent(String.self, forKey: .start_at)
    end_at = try values.decodeIfPresent(String.self, forKey: .end_at)
    mobile_insert_id = try values.decodeIfPresent(String.self, forKey: .mobile_insert_id)
    syllabus_id = try values.decodeIfPresent(String.self, forKey: .syllabus_id)
    task_details = try values.decodeIfPresent(String.self, forKey: .task_details)
    estimated_duration = try values.decodeIfPresent(String.self, forKey: .estimated_duration)
    let decodedProgress = try values.decodeIfPresent(Int.self, forKey: .progress_percent)
    progress_percent = decodedProgress ?? 0
    status = try values.decodeIfPresent(String.self, forKey: .status) ?? "todo"
    colorTheme = try values.decodeIfPresent(String.self, forKey: .colorTheme) ?? "violet"
    lecture_id = try values.decodeIfPresent(String.self, forKey: .lecture_id)
    assigned_date = try values.decodeIfPresent(String.self, forKey: .assigned_date)
    scheduled_date = try values.decodeIfPresent(String.self, forKey: .scheduled_date)
    if decodedProgress == nil {
      progress_percent = status == "done" ? 100 : status == "inProgress" ? 50 : 0
    }
    progress_percent = min(100, max(0, progress_percent))
    status = progress_percent == 100 ? "done" : progress_percent > 0 ? "inProgress" : "todo"
  }

  var isImported: Bool { id.hasPrefix("ical-") }
  var isCompleted: Bool { progress_percent >= 100 }
  var dueDate: String? { dateOnly(deadline) }
  var isOverdue: Bool { dueDate.map { $0 < dateString(Date()) && !isCompleted } ?? false }

}
struct PlannerEvent: Codable, Identifiable, Hashable {
  var relatedLectureID: String? = nil
  var id = UUID().uuidString
  var title = ""
  var date = dateString(Date())
  var colorTheme = "teal"

  init() {}

  private enum CodingKeys: String, CodingKey {
    case id, title, date, colorTheme, relatedLectureID
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    relatedLectureID = try values.decodeIfPresent(String.self, forKey: .relatedLectureID)
    title = try values.decodeIfPresent(String.self, forKey: .title) ?? ""
    date = try values.decodeIfPresent(String.self, forKey: .date) ?? ""
    colorTheme = try values.decodeIfPresent(String.self, forKey: .colorTheme) ?? "teal"
  }

  var isImported: Bool { id.hasPrefix("ical-") }

}
struct SearchLecture: Codable, Identifiable {
  var id: String
  var name: String
  var public_lecture_data: [PublicLecture]?
  var schedules: [PublicSchedule]?
}
struct PublicLecture: Codable { var id: String; var name: String; var teacher: String?; var syllabus_id: String?; var classroom: String?; var details: String? }
struct PublicSchedule: Codable {
  var day_of_week: Int?
  var start_time: String?
  var end_time: String?
  var period_start_daytime: String?
}
func canonicalTerm(for schedule: PublicSchedule?) -> String {
  guard let raw = schedule?.period_start_daytime,
        raw.count == 10 || raw.dropFirst(10).first == "T",
        let date = dateOnly(raw), academicYear(for: dateValue(date)) > 0 else { return legacyDefaultTerm }
  return termForDate(dateValue(date))
}
struct Profile: Codable, Equatable {
  var department = ""
  var major = ""
  var icalUrl = ""
  var shareTemplates = false
  var studentYear = 0
  var classGroup = ""
  var icalExpiry:String? = ""

  init() {}

  private enum CodingKeys: String, CodingKey {
    case department, major, icalUrl, shareTemplates, icalExpiry, studentYear, classGroup
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    department = try values.decodeIfPresent(String.self, forKey: .department) ?? ""
    major = try values.decodeIfPresent(String.self, forKey: .major) ?? ""
    icalUrl = try values.decodeIfPresent(String.self, forKey: .icalUrl) ?? ""
    shareTemplates = try values.decodeIfPresent(Bool.self, forKey: .shareTemplates) ?? false
    icalExpiry = try values.decodeIfPresent(String.self, forKey: .icalExpiry)
    studentYear = try values.decodeIfPresent(Int.self, forKey: .studentYear) ?? 0
    classGroup = try values.decodeIfPresent(String.self, forKey: .classGroup) ?? ""
  }

}
let gradeLabels = ["A+", "A", "A−", "B+", "B", "B−", "C+", "C", "D", "D−", "F"]

struct GradeHistoryRow: Codable, Identifiable, Hashable {
  var id: String
  var academicTerm: String
  var instructor: String?
  var lectureTitle: String?
  var faculty: String?
  var enrollment: Double?
  var gpa: Double?
  var distribution: [Double?]
  var preferred: Bool
  var subjectName: String?
  var courseProgram: String?
  var dataType: String?
  var classCode: String?
  var matchKind: String
  var source: String
  var sourceLabel: String

  private enum CodingKeys: String, CodingKey {
    case id, academicTerm, instructor, lectureTitle, faculty, enrollment, gpa, distribution, preferred, subjectName, courseProgram, dataType, classCode, matchKind, source, sourceLabel
  }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    academicTerm = try values.decodeIfPresent(String.self, forKey: .academicTerm) ?? ""
    instructor = try values.decodeIfPresent(String.self, forKey: .instructor)
    lectureTitle = try values.decodeIfPresent(String.self, forKey: .lectureTitle)
    faculty = try values.decodeIfPresent(String.self, forKey: .faculty)
    enrollment = try values.decodeIfPresent(Double.self, forKey: .enrollment)
    gpa = try values.decodeIfPresent(Double.self, forKey: .gpa)
    let supplied = try values.decodeIfPresent([Double?].self, forKey: .distribution) ?? []
    // Missing buckets stay unknown; a shorter older payload never becomes zero data.
    distribution = Array(supplied.prefix(gradeLabels.count))
    if distribution.count < gradeLabels.count {
      distribution += Array(repeating: nil, count: gradeLabels.count - distribution.count)
    }
    preferred = try values.decodeIfPresent(Bool.self, forKey: .preferred) ?? false
    subjectName = try values.decodeIfPresent(String.self, forKey: .subjectName)
    courseProgram = try values.decodeIfPresent(String.self, forKey: .courseProgram)
    dataType = try values.decodeIfPresent(String.self, forKey: .dataType)
    classCode = try values.decodeIfPresent(String.self, forKey: .classCode)
    matchKind = try values.decodeIfPresent(String.self, forKey: .matchKind) ?? "subject"
    source = try values.decodeIfPresent(String.self, forKey: .source) ?? "grade_distributions"
    sourceLabel = try values.decodeIfPresent(String.self, forKey: .sourceLabel) ?? "保存済み集計（出典の詳細は未確認）"
  }
  var pickerTitle: String {
    ([nonempty(academicTerm) ?? "年度未登録"] + [nonempty(lectureTitle), nonempty(instructor), nonempty(courseProgram) ?? nonempty(faculty), nonempty(classCode)].compactMap { $0 }).joined(separator: " · ")
  }
}

func selectedGradeHistoryRow(in rows: [GradeHistoryRow], selectedID: String) -> GradeHistoryRow? {
  rows.first { $0.id == selectedID } ?? rows.first { $0.preferred } ?? rows.first
}

struct Draft: Codable, Identifiable {var id:String;var type:String;var title:String;var json:String}
struct AffiliationChoices: Codable, Identifiable {
  var faculty: String
  var majors: [String]
  var id: String { faculty }
}

struct TimetableUndo: Codable { var term: String; var rows: [Lecture] }
struct TimetableViewState: Codable { var terms: [String: [Lecture]] = [:]; var hidden: [String: [String]] = [:]; var undo: TimetableUndo? }
struct Snapshot: Codable {
  var timetableView = TimetableViewState()
  var activities: [ClubActivity] = []
  var campus = CampusDirectory()
  var lectureChat = ChatSnapshot()
  var chat = ChatSnapshot()
  var affiliations: [AffiliationChoices] = []
  var drafts:[Draft] = []
  var pendingCount = 0
  var lectures: [Lecture] = []
  var tasks: [PlannerTask] = []
  var events: [PlannerEvent] = []
  var searchResults: [SearchLecture] = []
  var searchStatus = "未検索"
  var searchQuery = ""
  var templates: [Lecture] = []
  var officialCatalog: OfficialCatalog?
  var officialSelection: [String] = []
  var officialLectures: [Lecture] = []
  var gradeHistory: [String: [GradeHistoryRow]] = [:]
  var gradeHistoryStatus: [String: DetailResourceStatus] = [:]
  var templateSuggestions: [String: TemplateSuggestionState] = [:]
  var profile = Profile()
  var account = "端末内のゲスト"
  var displayName = ""
  var avatarURL = ""
  var connection = "クラウド未設定"
  var configured = false
  var busy = false
  var message = ""
  var revision = 0

  init() {}

  private enum CodingKeys: String, CodingKey {
    case timetableView, activities, campus, lectureChat, chat, affiliations, drafts, pendingCount, lectures, tasks, events, searchResults, searchStatus, searchQuery, templates, officialCatalog, officialSelection, officialLectures, gradeHistory, gradeHistoryStatus, templateSuggestions, profile, account, displayName, avatarURL, connection, configured, busy, message, revision
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    timetableView = try values.decodeIfPresent(TimetableViewState.self, forKey: .timetableView) ?? TimetableViewState()
    activities = try values.decodeIfPresent([ClubActivity].self, forKey: .activities) ?? []
    campus = try values.decodeIfPresent(CampusDirectory.self, forKey: .campus) ?? CampusDirectory()
    lectureChat = try values.decodeIfPresent(ChatSnapshot.self, forKey: .lectureChat) ?? ChatSnapshot()
    chat = try values.decodeIfPresent(ChatSnapshot.self, forKey: .chat) ?? ChatSnapshot()
    affiliations = try values.decodeIfPresent([AffiliationChoices].self, forKey: .affiliations) ?? []
    drafts = try values.decodeIfPresent([Draft].self, forKey: .drafts) ?? []
    pendingCount = try values.decodeIfPresent(Int.self, forKey: .pendingCount) ?? 0
    lectures = try values.decodeIfPresent([Lecture].self, forKey: .lectures) ?? []
    tasks = try values.decodeIfPresent([PlannerTask].self, forKey: .tasks) ?? []
    events = try values.decodeIfPresent([PlannerEvent].self, forKey: .events) ?? []
    searchStatus = try values.decodeIfPresent(String.self, forKey: .searchStatus) ?? "未検索"
    searchQuery = try values.decodeIfPresent(String.self, forKey: .searchQuery) ?? ""
    searchResults = try values.decodeIfPresent([SearchLecture].self, forKey: .searchResults) ?? []
    templates = try values.decodeIfPresent([Lecture].self, forKey: .templates) ?? []
    officialCatalog = try values.decodeIfPresent(OfficialCatalog.self, forKey: .officialCatalog)
    officialSelection = try values.decodeIfPresent([String].self, forKey: .officialSelection) ?? []
    officialLectures = try values.decodeIfPresent([Lecture].self, forKey: .officialLectures) ?? []
    gradeHistory = try values.decodeIfPresent([String: [GradeHistoryRow]].self, forKey: .gradeHistory) ?? [:]
    gradeHistoryStatus = try values.decodeIfPresent([String: DetailResourceStatus].self, forKey: .gradeHistoryStatus) ?? [:]
    templateSuggestions = try values.decodeIfPresent([String: TemplateSuggestionState].self, forKey: .templateSuggestions) ?? [:]
    profile = try values.decodeIfPresent(Profile.self, forKey: .profile) ?? Profile()
    account = try values.decodeIfPresent(String.self, forKey: .account) ?? "端末内のゲスト"
    displayName = try values.decodeIfPresent(String.self, forKey: .displayName) ?? ""
    avatarURL = try values.decodeIfPresent(String.self, forKey: .avatarURL) ?? ""
    connection = try values.decodeIfPresent(String.self, forKey: .connection) ?? "クラウド未設定"
    configured = try values.decodeIfPresent(Bool.self, forKey: .configured) ?? false
    busy = try values.decodeIfPresent(Bool.self, forKey: .busy) ?? false
    message = try values.decodeIfPresent(String.self, forKey: .message) ?? ""
    revision = try values.decodeIfPresent(Int.self, forKey: .revision) ?? 0
  }

}

let plannerTimeZone = TimeZone(identifier: "Asia/Tokyo")!
var plannerCalendar: Calendar {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = plannerTimeZone
  return calendar
}
let weekdays = ["日", "月", "火", "水", "木", "金", "土"]
let periodTimes = ["08:45–10:15", "10:30–12:00", "13:00–14:30", "14:45–16:15", "16:30–18:00"]
// Records written by the pinned Web API without a term use this historical default.
let legacyDefaultTerm = "2026年度 1学期（夏ターム）"

private func plannerDateFormatter() -> DateFormatter {
  let formatter = DateFormatter()
  formatter.calendar = plannerCalendar
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = plannerTimeZone
  formatter.dateFormat = "yyyy-MM-dd"
  formatter.isLenient = false
  return formatter
}
func dateString(_ date: Date) -> String { plannerDateFormatter().string(from: date) }
func dateOnly(_ text: String?) -> String? {
  guard let text = text, text.count >= 10 else { return nil }
  let value = String(text.prefix(10))
  let formatter = plannerDateFormatter()
  guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
  return value
}
func dateValue(_ text: String?) -> Date {
  guard let value = dateOnly(text), let date = plannerDateFormatter().date(from: value) else { return Date() }
  return date
}
func academicYear(for date: Date) -> Int {
  let year = plannerCalendar.component(.year, from: date)
  return plannerCalendar.component(.month, from: date) < 4 ? year - 1 : year
}
func termOptions(for year: Int) -> [String] {
  ["\(year)年度 1学期（春ターム）", "\(year)年度 1学期（夏ターム）", "\(year)年度 2学期（秋ターム）", "\(year)年度 2学期（冬ターム）"]
}
var terms: [String] { termOptions(for: academicYear(for: Date())) }
func termForDate(_ date: Date) -> String {
  let month = plannerCalendar.component(.month, from: date)
  let index = month >= 12 || month < 4 ? 3 : month >= 10 ? 2 : month >= 6 ? 1 : 0
  return termOptions(for: academicYear(for: date))[index]
}
func availableTerms(lectures: [Lecture], selected: String) -> [String] {
  let year = academicYear(for: Date())
  let defaults = ((year - 1)...(year + 1)).flatMap { termOptions(for: $0) }
  let values = Set(defaults + lectures.map { $0.term ?? legacyDefaultTerm } + [selected])
  let seasons = ["春", "夏", "秋", "冬"]
  return values.sorted { lhs, rhs in
    let lhsYear = Int(lhs.prefix(4)) ?? 0
    let rhsYear = Int(rhs.prefix(4)) ?? 0
    if lhsYear != rhsYear { return lhsYear < rhsYear }
    let lhsSeason = seasons.firstIndex(where: { lhs.contains($0 + "ターム") }) ?? 4
    let rhsSeason = seasons.firstIndex(where: { rhs.contains($0 + "ターム") }) ?? 4
    return lhsSeason == rhsSeason ? lhs < rhs : lhsSeason < rhsSeason
  }
}
func taskDueOrder(_ lhs: PlannerTask, _ rhs: PlannerTask) -> Bool {
  if lhs.dueDate != rhs.dueDate { return (lhs.dueDate ?? "9999-12-31") < (rhs.dueDate ?? "9999-12-31") }
  if lhs.task_name != rhs.task_name { return lhs.task_name < rhs.task_name }
  return lhs.id < rhs.id
}
func scheduledLectures(on date: Date, in source: [Lecture]) -> [Lecture] {
  let day = plannerCalendar.component(.weekday, from: date) - 1
  let text = dateString(date)
  return source.filter {
    $0.day_of_the_week == day && ($0.term ?? legacyDefaultTerm) == termForDate(date) && dateOnly($0.cancelled_date) != text
  }.sorted { $0.period == $1.period ? $0.id < $1.id : $0.period < $1.period }
}
func nonempty(_ value: String?) -> String? {
  guard let value = value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  return value
}
func syllabusURL(for lecture: Lecture) -> URL? {
  guard let id = nonempty(lecture.syllabus_id) else { return nil }
  // Same public destination as Web, with the lecture's academic year.
  var url = URLComponents(string: "https://gakumu.academic.hokudai.ac.jp/Portal/Public/Syllabus/DetailMain.aspx")
  let year = Int((lecture.term ?? legacyDefaultTerm).prefix(4)) ?? academicYear(for: Date())
  url?.queryItems = [URLQueryItem(name: "lct_year", value: String(year)), URLQueryItem(name: "lct_cd", value: id)]
  return url?.url
}
enum CourseService { case moodle, elms }
func courseURL(for lecture: Lecture, service: CourseService) -> URL? {
  guard let id = nonempty(lecture.syllabus_id) else { return nil }
  let year = Int((lecture.term ?? legacyDefaultTerm).prefix(4)) ?? academicYear(for: Date())
  let code = id.count == 6 ? String(format: "%02d", year % 100) + id : id
  var url = URLComponents(string: service == .moodle ? "https://moodle.elms.hokudai.ac.jp/course/view.php" : "https://www.elms.hokudai.ac.jp/group/grouppage")
  url?.queryItems = [URLQueryItem(name: service == .moodle ? "name" : "idnumber", value: "p" + code)]
  return url?.url
}

struct OfficialSlot: Codable, Hashable { var weekday:Int; var period:Int }
struct OfficialCourse: Codable, Identifiable {var id:String; var page:Int; var studentYear:Int; var courseNames:[String]; var classGroup:String; var title:String; var instructor:String; var classroom:String; var openingTerm:String; var slots:[OfficialSlot]; var intensive:Bool; var notes:String}
struct OfficialDateOverride: Codable {var date:String; var weekday:Int; var sourceText:String}
struct OfficialCatalog: Codable {var title:String;var faculty:String;var department:String;var academicYear:Int;var semester:Int;var sourceLabel:String;var sourceFileName:String;var sourceSHA256:String;var sourcePages:Int;var notes:[String];var dateOverrides:[OfficialDateOverride];var courses:[OfficialCourse]}

func scheduledOfficialLectures(on date: Date, snapshot: Snapshot) -> [Lecture] {
 let ordinary = plannerCalendar.component(.weekday, from: date) - 1
 let mapped = snapshot.officialCatalog?.dateOverrides.first { $0.date == dateString(date) }?.weekday ?? ordinary
 let adjusted = activeOfficialLectures(snapshot).filter { $0.day_of_the_week == mapped }.map { original -> Lecture in var value = original; value.day_of_the_week = ordinary; return value }
 return scheduledLectures(on: date, in: adjusted)
}

struct ChatRoom: Codable {var id:String;var universityId:String;var facultyId:String;var departmentId:String;var name:String}
struct ChatMessage: Codable, Identifiable {var id:String;var roomId:String;var nickname:String;var body:String;var createdAt:String;var own:Bool}
struct ChatSnapshot: Codable {var room:ChatRoom?;var messages:[ChatMessage]=[];var status="学科チャットは準備中です";var ready=false;var hasMore=false;var draft="";var nickname=""}

// Uses the same status keys as the Web kanban; imported iCal completion is
// local and now supports all three states without changing the iCal source.
enum TaskBoardStatus: String, CaseIterable, Identifiable {
  case todo, inProgress, done
  var id: String { rawValue }
  var title: String { switch self { case .todo: return "未着手"; case .inProgress: return "作業中"; case .done: return "完了" } }
  var initialProgress: Int { switch self { case .todo: return 0; case .inProgress: return 50; case .done: return 100 } }
  static func available(for task: PlannerTask) -> [TaskBoardStatus] { allCases }
}

func calendarMonthDays(containing date: Date) -> [Date] {
  guard let start = plannerCalendar.dateInterval(of: .month, for: date)?.start,
        let range = plannerCalendar.range(of: .day, in: .month, for: start),
        let first = plannerCalendar.date(byAdding: .day, value: -(plannerCalendar.component(.weekday, from: start) - 1), to: start) else { return [] }
  let leading = plannerCalendar.component(.weekday, from: start) - 1
  let count = ((leading + range.count + 6) / 7) * 7
  return (0..<count).compactMap { plannerCalendar.date(byAdding: .day, value: $0, to: first) }
}
struct CalendarDaySummary {
  let events: Int
  let deadlines: Int
  let work: Int
  var total: Int { events + deadlines + work }
  var label: String {
    let parts = [(events, "予定"), (deadlines, "課題期限"), (work, "作業予定")].filter { $0.0 > 0 }
    return parts.isEmpty ? "予定・課題期限・作業予定なし" : parts.map { "\($0.1)\($0.0)件" }.joined(separator: "、")
  }
}
func calendarDaySummary(_ day: String, tasks: [PlannerTask], events: [PlannerEvent]) -> CalendarDaySummary {
  CalendarDaySummary(events: events.filter { dateOnly($0.date) == day }.count,
    deadlines: tasks.filter { $0.dueDate == day }.count,
    work: tasks.filter { dateOnly($0.scheduled_date) == day }.count)
}

func calendarDaySummaries(tasks: [PlannerTask], events: [PlannerEvent]) -> [String: CalendarDaySummary] {
  var eventCounts: [String: Int] = [:], deadlineCounts: [String: Int] = [:], workCounts: [String: Int] = [:]
  for event in events { if let day = dateOnly(event.date) { eventCounts[day, default: 0] += 1 } }
  for task in tasks {
    if let day = task.dueDate { deadlineCounts[day, default: 0] += 1 }
    if let day = dateOnly(task.scheduled_date) { workCounts[day, default: 0] += 1 }
  }
  let days = Set(eventCounts.keys).union(deadlineCounts.keys).union(workCounts.keys)
  return Dictionary(uniqueKeysWithValues: days.map { ($0, CalendarDaySummary(events: eventCounts[$0] ?? 0, deadlines: deadlineCounts[$0] ?? 0, work: workCounts[$0] ?? 0)) })
}

struct TodayPeriod: Identifiable {
  let period: Int
  let lectures: [Lecture]
  let current: Bool
  var id: Int { period }
}
func todayPeriods(on date: Date, snapshot: Snapshot) -> [TodayPeriod] {
  let lectures = scheduledLectures(on: date, in: activePersonalLectures(snapshot)) + scheduledOfficialLectures(on: date, snapshot: snapshot)
  let minute = plannerCalendar.component(.hour, from: date) * 60 + plannerCalendar.component(.minute, from: date)
  let bounds = [(525, 615), (630, 720), (780, 870), (885, 975), (990, 1080)]
  return (1...5).map { period in TodayPeriod(period: period, lectures: lectures.filter { $0.period == period }, current: minute >= bounds[period - 1].0 && minute < bounds[period - 1].1) }
}

func calendarWeekDays(containing date: Date) -> [Date] {
  let day = plannerCalendar.startOfDay(for: date)
  let offset = (plannerCalendar.component(.weekday, from: day) + 5) % 7
  guard let monday = plannerCalendar.date(byAdding: .day, value: -offset, to: day) else { return [] }
  return (0..<7).compactMap { plannerCalendar.date(byAdding: .day, value: $0, to: monday) }
}

struct ClubActivity: Codable, Identifiable { var id = "club-" + UUID().uuidString; var title = ""; var details = ""; var colorTheme = "teal"
 var lecture: Lecture { var l = Lecture(); l.id = id; l.lecture_name = title; l.lecture_details = details; l.colorTheme = colorTheme; l.day_of_the_week = -1; l.period = 0; return l }
}
struct CampusEntry: Codable, Identifiable { var id:String; var category:String; var title:String; var body:String; var url:String; var sponsor:String }
struct CampusDirectory: Codable { var entries:[CampusEntry]=[]; var status="掲載準備中です" }

struct SharedCourse: Codable { var n: String; var d: Int; var p: Int; var i: String; var c: String; var g: String? = nil }
struct ShareableLectureGroup: Identifiable { var id: String; var lectures: [Lecture]; var title: String { lectures.first?.lecture_name ?? "" } }
func lectureSharingIdentity(_ lecture: Lecture) -> String {
  if let group = nonempty(lecture.lecture_list_id) { return "group:" + group }
  if let group = nonempty(lecture.sharing_group_id) { return "local:" + group }
  if lecture.id.hasPrefix("official-") { return "official:" + lecture.id.components(separatedBy: ":")[0] }
  return "lecture:" + lecture.id
}
func shareableLectureGroups(_ lectures: [Lecture]) -> [ShareableLectureGroup] {
  var result: [ShareableLectureGroup] = []
  for lecture in lectures {
    let id = lectureSharingIdentity(lecture)
    if let index = result.firstIndex(where: { $0.id == id }) { result[index].lectures.append(lecture) }
    else { result.append(ShareableLectureGroup(id: id, lectures: [lecture])) }
  }
  return result
}
func sharedCourseRows(_ lectures: [Lecture], term: String) -> [SharedCourse] {
  shareableLectureGroups(lectures.filter { ($0.term ?? legacyDefaultTerm) == term }).enumerated().flatMap { index, group in
    group.lectures.map { SharedCourse(n: $0.lecture_name, d: $0.day_of_the_week, p: $0.period, i: $0.instructor, c: $0.classroom ?? "", g: "q\(index)") }
  }
}
struct SharedTimetable: Codable {
  var v = 1
  var kind = "HaskappTimetable"
  var term: String
  var rows: [SharedCourse]
  func validatedLectures() throws -> [Lecture] {
    guard v == 1, kind == "HaskappTimetable", rows.count > 0, rows.count <= 25,
      term.range(of: #"^\d{4}年度 [12]学期（[春夏秋冬]ターム）$"#, options: .regularExpression) != nil else { throw TimetableShareError.invalid }
    var occupied = Set<String>()
    var importedGroups: [String: String] = [:]
    var groupIdentity: [String: String] = [:]
    return try rows.map { row in
      guard !row.n.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, row.n.count <= 120, row.i.count <= 120, row.c.count <= 120, (1...5).contains(row.d), (1...5).contains(row.p), occupied.insert("\(row.d):\(row.p)").inserted else { throw TimetableShareError.invalid }
      var l = Lecture()
      if let key = row.g {
        guard key.range(of: #"^q[0-9]{1,3}$"#, options: .regularExpression) != nil else { throw TimetableShareError.invalid }
        let identity = row.n + "\u{0}" + row.i
        if let previous = groupIdentity[key], previous != identity { throw TimetableShareError.invalid }
        groupIdentity[key] = identity
        if importedGroups[key] == nil { importedGroups[key] = "qr-" + UUID().uuidString }
        l.sharing_group_id = importedGroups[key]
      }
      l.lecture_name = row.n; l.instructor = row.i; l.classroom = row.c; l.day_of_the_week = row.d; l.period = row.p; l.term = term; l.absences = nil; return l
    }
  }
}
enum TimetableShareError: LocalizedError, Equatable { case invalid, tooLarge, empty
  var errorDescription: String? { self == .empty ? "共有する講義を選択してください。" : self == .tooLarge ? "一つの講義の情報量がQRの上限を超えています。" : "同じ時限の重複、講義名、タームを確認してください。" }
}
func encodeTimetable(_ lectures: [Lecture], term: String) throws -> String {
  let payload = SharedTimetable(term: term, rows: sharedCourseRows(lectures, term: term))
  _ = try payload.validatedLectures()
  let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
  let data = try encoder.encode(payload)
  guard data.count <= 2200 else { throw TimetableShareError.tooLarge }
  return String(decoding: data, as: UTF8.self)
}
func encodeTimetablePages(_ lectures: [Lecture], term: String) throws -> [String] {
  let rows = sharedCourseRows(lectures, term: term)
  guard !rows.isEmpty else { throw TimetableShareError.empty }
  _ = try SharedTimetable(term: term, rows: rows).validatedLectures()
  var pages: [String] = []; var current: [SharedCourse] = []
  func encode(_ rows: [SharedCourse]) throws -> String { let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; let data = try encoder.encode(SharedTimetable(term: term, rows: rows)); guard data.count <= 2200 else { throw TimetableShareError.tooLarge }; return String(decoding: data, as: UTF8.self) }
  let keys = rows.compactMap(\.g).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
  for key in keys {
    let group = rows.filter { $0.g == key }
    if (try? encode(current + group)) != nil { current += group }
    else { if !current.isEmpty { pages.append(try encode(current)) }; _ = try encode(group); current = group }
  }
  if !current.isEmpty { pages.append(try encode(current)) }; return pages
}
func decodeTimetable(_ raw: String) throws -> [Lecture] {
  guard let data = raw.data(using: .utf8), data.count <= 2200 else { throw TimetableShareError.tooLarge }
  return try JSONDecoder().decode(SharedTimetable.self, from: data).validatedLectures()
}

func lectureConflictMessage(_ lecture: Lecture, existing: [Lecture]) -> String? {
 if existing.contains(where: { $0.id == lecture.id && $0.day_of_the_week == lecture.day_of_the_week && $0.period == lecture.period && ($0.term ?? legacyDefaultTerm) == (lecture.term ?? legacyDefaultTerm) }) { return nil }
 guard let conflict = existing.first(where: { $0.id != lecture.id && $0.day_of_the_week == lecture.day_of_the_week && $0.period == lecture.period && ($0.term ?? legacyDefaultTerm) == (lecture.term ?? legacyDefaultTerm) }) else { return nil }
 return "同じ時限に「" + conflict.lecture_name + "」があります。曜日・時限を変更してください。"
}

// Developer-launched view selection only. Does not alter authentication,
// storage namespaces, existing data, tutorial completion or feature flags.
func requestedReviewScreen(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> String? {
  guard let i = arguments.firstIndex(of: "--haskapp-review-screen"), arguments.indices.contains(i + 1) else { return nil }
  let value = arguments[i + 1]
  return ["today", "timetable", "tasks", "calendar", "week", "settings", "qr", "campus", "lecture", "grades"].contains(value) ? value : nil
}
func initialPlannerTab(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> String {
  switch requestedReviewScreen(arguments) {
  case "week", "calendar": return "calendar"
  case "qr", "lecture", "grades", "timetable": return "timetable"
  case "campus", "settings": return "settings"
  case "tasks": return "tasks"
  default: return "today"
  }
}

func effectiveTimetableLectures(_ snapshot: Snapshot) -> [Lecture] {
  let overlay = snapshot.timetableView.terms.values.flatMap { $0 }; let ids = Set(overlay.map(\.id))
  return (snapshot.lectures + snapshot.officialLectures).filter { !ids.contains($0.id) && !(snapshot.timetableView.hidden[$0.term ?? legacyDefaultTerm]?.contains($0.id) ?? false) } + overlay
}
func activePersonalLectures(_ snapshot: Snapshot) -> [Lecture] { let officialIDs = Set(snapshot.officialLectures.map(\.id)); return effectiveTimetableLectures(snapshot).filter { !officialIDs.contains($0.id) && !$0.id.hasPrefix("official-") } }
func activeOfficialLectures(_ snapshot: Snapshot) -> [Lecture] { let officialIDs = Set(snapshot.officialLectures.map(\.id)); return effectiveTimetableLectures(snapshot).filter { officialIDs.contains($0.id) || $0.id.hasPrefix("official-") } }

#if canImport(CoreImage) && canImport(CoreText)
import CoreGraphics
import CoreImage.CIFilterBuiltins
import CoreText

/// The profile image stays outside the QR and its four-module quiet zone.
/// Rendering is shared by the onscreen preview, Photos export and share sheet.
func timetableShareCard(payload: String, term: String, page: Int, count: Int, avatar: CGImage? = nil) throws -> CGImage {
  let width = 900, height = 1400
  guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw TimetableShareError.invalid }
  context.setFillColor(CGColor(red: 0.93, green: 0.98, blue: 0.97, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.setFillColor(CGColor(gray: 1, alpha: 1)); context.addPath(CGPath(roundedRect: CGRect(x: 40, y: 40, width: 820, height: 1320), cornerWidth: 44, cornerHeight: 44, transform: nil)); context.fillPath()
  let portrait = CGRect(x: 380, y: 1170, width: 140, height: 140)
  context.saveGState(); context.addEllipse(in: portrait); context.clip()
  if let avatar {
    let scale = max(portrait.width / CGFloat(avatar.width), portrait.height / CGFloat(avatar.height))
    let rect = CGRect(x: portrait.midX - CGFloat(avatar.width) * scale / 2, y: portrait.midY - CGFloat(avatar.height) * scale / 2, width: CGFloat(avatar.width) * scale, height: CGFloat(avatar.height) * scale)
    context.interpolationQuality = .high; context.draw(avatar, in: rect)
  } else {
    context.setFillColor(CGColor(red: 0.88, green: 0.94, blue: 0.93, alpha: 1)); context.fill(portrait)
    context.setFillColor(CGColor(red: 0.24, green: 0.47, blue: 0.45, alpha: 1)); context.fillEllipse(in: CGRect(x: 426, y: 1230, width: 48, height: 48)); context.fillEllipse(in: CGRect(x: 399, y: 1155, width: 102, height: 91))
  }
  context.restoreGState()
  func text(_ value: String, y: CGFloat, size: CGFloat, color: CGColor) {
    let font = CTFontCreateWithName("HiraginoSans-W6" as CFString, size, nil)
    let string = NSAttributedString(string: value, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTForegroundColorAttributeName as String): color])
    let line = CTLineCreateWithAttributedString(string); let textWidth = CTLineGetTypographicBounds(line, nil, nil, nil)
    context.textPosition = CGPoint(x: (CGFloat(width) - CGFloat(textWidth)) / 2, y: y); CTLineDraw(line, context)
  }
  let ink = CGColor(red: 0.09, green: 0.25, blue: 0.24, alpha: 1)
  text("Haskapp", y: 1110, size: 36, color: ink)
  text("時間割をシェア", y: 1053, size: 43, color: ink)
  text(term, y: 998, size: 25, color: ink)
  let filter = CIFilter.qrCodeGenerator(); filter.message = Data(payload.utf8); filter.correctionLevel = "M"
  guard let code = filter.outputImage, let qr = CIContext().createCGImage(code, from: code.extent) else { throw TimetableShareError.invalid }
  let pixels = qr.width, scale = max(1, 744 / (pixels + 8)), size = (pixels + 8) * scale
  let quiet = CGFloat(4 * scale), origin = CGPoint(x: CGFloat(width - size) / 2, y: CGFloat(210 + (744 - size) / 2))
  context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(origin: origin, size: CGSize(width: size, height: size)))
  context.interpolationQuality = .none; context.draw(qr, in: CGRect(x: origin.x + quiet, y: origin.y + quiet, width: CGFloat(pixels * scale), height: CGFloat(pixels * scale)))
  text(count > 1 ? "\(page + 1) / \(count)枚・すべてのQRを読み込んでください" : "Haskappの「QR画像を読み取る」で取り込み", y: 155, size: 24, color: ink)
  text("メモ・出欠・成績・課題は含まれません", y: 110, size: 22, color: CGColor(gray: 0.4, alpha: 1))
  guard let image = context.makeImage() else { throw TimetableShareError.invalid }; return image
}
#endif
