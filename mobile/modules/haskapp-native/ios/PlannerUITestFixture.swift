import Foundation

// Isolated visual-test transport. Three explicit launch arguments are required;
// normal launches cannot activate it. All fixture actions are consumed here and
// never forwarded to the JS engine, Supabase, authentication or live Realtime.
final class PlannerUITestFixture {
  private weak var store: PlannerStore?
  private var state: [String: Any] = [:]
  static let lectureID = "qa-lecture-resource"
  static func make(store: PlannerStore) -> PlannerUITestFixture? {
    let args = ProcessInfo.processInfo.arguments
    guard args.contains("-haskapp-ui-tests"), args.contains("-haskapp-ui-resource-fixture"),
          let index = args.firstIndex(of: "-haskapp-ui-test-namespace"), args.indices.contains(index + 1), UUID(uuidString: args[index + 1]) != nil else { return nil }
    return PlannerUITestFixture(store: store)
  }
  private init(store: PlannerStore) { self.store = store }
  func receive(_ json: String) {
    guard state.isEmpty, let data = json.data(using: .utf8), var input = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    let id = Self.lectureID
    input["account"] = "QA専用・実アカウントではありません"
    input["connection"] = "QA専用データ・通信なし"
    input["configured"] = false
    input["busy"] = false
    input["message"] = ""
    input["lectures"] = [["id": id, "lecture_list_id": "qa-group", "lecture_name": "QA専用 成績・提案", "instructor": "QA担当", "classroom": "QA教室", "term": "2026年度 2学期（秋ターム）", "day_of_the_week": 1, "period": 1, "colorTheme": "teal", "grading_report": 0, "memo": "QAの個人メモを保持"]]
    input["tasks"] = []; input["events"] = []; input["officialSelection"] = []; input["officialLectures"] = []
    input["gradeHistory"] = [id: [
      ["id": "qa-cohort-1", "academicTerm": "2025 QA", "instructor": "QA担当", "lectureTitle": "QA専用集計A", "faculty": "QA学部", "enrollment": 120, "gpa": 2.75, "distribution": [10,20,10,20,10,5,10,10,5,0,0], "preferred": true, "sourceLabel": "QA専用集計（実データではありません）"],
      ["id": "qa-cohort-2", "academicTerm": "2024 QA", "instructor": "QA別担当", "lectureTitle": "QA専用集計B", "faculty": "QA学部", "enrollment": 0, "gpa": 0, "distribution": [0,0,NSNull(),NSNull(),NSNull(),NSNull(),NSNull(),NSNull(),NSNull(),NSNull(),NSNull()], "preferred": false, "sourceLabel": "QA専用・欠損とゼロの確認"]
    ]]
    input["gradeHistoryStatus"] = [id: ["status": "ready", "source": "cache", "stale": true, "error": "QA: オフラインを模した表示", "fetchedAt": "2026-10-05T00:00:00Z"]]
    func field(_ key: String, _ label: String, _ value: Int, _ eligible: Bool, _ current: Any) -> [String: Any] {
      ["key": key, "label": label, "value": value, "currentValue": current, "eligible": eligible, "sourceTemplateId": "qa-template", "sourceCreatedAt": "2026-09-01T00:00:00Z", "conflictCount": 0]
    }
    input["templateSuggestions"] = [id: ["status": "ready", "source": "cache", "stale": true, "proposal": ["id": "qa-proposal", "ownerId": "qa-owner", "lectureId": id, "groupId": "qa-group", "affiliationId": "qa-affiliation", "createdAt": "2026-10-05T00:00:00Z", "sourceLabel": "QA専用共有候補（実データではありません）", "warning": "画面検証専用。大学や利用者の実績ではありません。", "fields": [field("grading_report", "レポート", 30, false, 0), field("grading_test", "試験", 70, true, NSNull()), field("grading_quiz", "小テスト", 20, true, NSNull())]]]]
    state = input; publish()
  }
  func action(_ json: String) {
    guard let data = json.data(using: .utf8), let action = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    if action["type"] as? String == "applySuggestion", let payload = action["payload"] as? [String: Any], payload["id"] as? String == Self.lectureID, payload["proposalId"] as? String == "qa-proposal", let keys = payload["fields"] as? [String], var lectures = state["lectures"] as? [[String: Any]] {
      for key in keys where ["grading_test", "grading_quiz"].contains(key) && lectures[0][key] == nil { lectures[0][key] = key == "grading_test" ? 70 : 20 }
      state["lectures"] = lectures; publish()
    }
    // Every other action is intentionally consumed; this harness tests native
    // presentation only. Real transport/patch correctness has portable tests.
  }
  private func publish() {
    guard let data = try? JSONSerialization.data(withJSONObject: state), let json = String(data: data, encoding: .utf8) else { return }
    store?.receive(json)
  }
}
