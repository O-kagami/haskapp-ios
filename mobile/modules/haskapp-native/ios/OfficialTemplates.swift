import SwiftUI

private struct TimetableReplacementPayload: Encodable { var term: String; var ids: [String] }

struct OfficialTemplatesSheet: View {
  @ObservedObject var store: PlannerStore
  var initialProfile: Profile? = nil
  var embedded = false
  var initialOpening = "秋"
  @Environment(\.dismiss) private var dismiss
  @State private var year = 0
  @State private var course = ""
  @State private var classGroup = ""
  @State private var selected = Set<String>()
  @State private var loaded = false
  @State private var faculty = ""
  @State private var opening = "秋"
  @State private var bulkConfirm = false
  @State private var replace = false
  @State private var replaceConfirm = false
  private var targetTerm: String { "\(store.snapshot.officialCatalog?.academicYear ?? 2026)年度 2学期（\(opening)ターム）" }
  private var candidateIDs: [String] { filtered.filter { selected.contains($0.id) && !$0.intensive }.map(\.id) }
  private var oldRows: [Lecture] { effectiveTimetableLectures(store.snapshot).filter { ($0.term ?? legacyDefaultTerm) == targetTerm } }
  private var replacementRows: [Lecture] {
    (store.snapshot.officialCatalog?.courses ?? []).filter { candidateIDs.contains($0.id) }.flatMap { item in item.slots.map { slot in var l = Lecture(); l.id = item.id + ":" + opening + ":\(slot.weekday):\(slot.period)"; l.lecture_name = item.title; l.instructor = item.instructor; l.classroom = item.classroom; l.day_of_the_week = slot.weekday; l.period = slot.period; l.term = targetTerm; return l } }
  }
  private var previewLectures: [Lecture] {
    if replace { return replacementRows }
    var rows = effectiveTimetableLectures(store.snapshot)
    let oldIDs = Set(rows.map(\.id))
    for item in store.snapshot.officialCatalog?.courses.filter({ selected.contains($0.id) }) ?? [] {
      let terms = ["2学期", "通年"].contains(item.openingTerm) ? ["秋", "冬"] : [item.openingTerm]
      for season in terms { for slot in item.slots { var l = Lecture(); l.id = item.id + ":" + season + ":\(slot.weekday):\(slot.period)"; l.lecture_name = item.title; l.day_of_the_week = slot.weekday; l.period = slot.period; l.term = "\(store.snapshot.officialCatalog?.academicYear ?? 2026)年度 2学期（\(season)ターム）"; if !oldIDs.contains(l.id) { rows.append(l) } } }
    }; return rows
  }

  private var choices: [String] { Array(Set(store.snapshot.officialCatalog?.courses.flatMap(\.courseNames) ?? [])).sorted() }
  private var filtered: [OfficialCourse] {
    (store.snapshot.officialCatalog?.courses ?? []).filter {
      (faculty.isEmpty || faculty == store.snapshot.officialCatalog?.faculty) && ($0.openingTerm == opening || ["2学期", "通年"].contains($0.openingTerm)) && (year == 0 || $0.studentYear == year) && (course.isEmpty || $0.courseNames.contains(course)) && (classGroup.isEmpty || $0.classGroup.isEmpty || $0.classGroup == classGroup)
    }.sorted { ($0.studentYear, $0.classGroup, $0.title, $0.openingTerm) < ($1.studentYear, $1.classGroup, $1.title, $1.openingTerm) }
  }
  private var applicationMode: some View {
Section("適用方法") {
            Picker("適用方法", selection: $replace) { Text("追加").tag(false); Text("表示を置換").tag(true) }.pickerStyle(.segmented).accessibilityIdentifier("official.mode")
            if replace {
              Text("対象: " + targetTerm).font(.headline)
              Text("現在\(oldRows.count)時限 → 選択後\(replacementRows.count)時限。この端末の対象タームの表示を置換します。元の授業・成績・メモ・課題・共有グループは削除せず、時間割の『直前の表示に戻す』で復元できます。Webや他の端末には反映しません。").font(.caption).fixedSize(horizontal: false, vertical: true)
              Button("表示中の候補をすべて選択") { selected.formUnion(filtered.filter { !$0.intensive }.map(\.id)) }.disabled(filtered.isEmpty)
              Text("集中講義は置換の対象外です。同じ時限の候補は、いずれかを選んでください。").font(.caption).foregroundStyle(.secondary)
            }
          }
  }
  private var courseList: some View {
Section("公式科目（\(filtered.count)件）") {
            if filtered.isEmpty { Text("この条件の科目は収録されていません。").foregroundStyle(.secondary) }
            ForEach(filtered) { item in
              courseRow(item)
            }
          }
  }
  private func courseRow(_ item: OfficialCourse) -> some View {
HStack(alignment: .top) {
                Button { if selected.contains(item.id) { selected.remove(item.id) } else { selected.insert(item.id) } } label: { Image(systemName: selected.contains(item.id) ? "checkmark.circle.fill" : "circle").font(.title2).padding(.vertical, 8) }.buttonStyle(.plain).accessibilityLabel("\(item.title)を\(selected.contains(item.id) ? "選択解除" : "選択")")
                NavigationLink { OfficialCourseDetail(store: store, courseID: item.id) } label: {
                  VStack(alignment: .leading, spacing: 5) {
                    Text(item.title).font(.headline)
                    Text("\(item.studentYear)年 · \(item.classGroup.isEmpty ? "コース共通" : item.classGroup + "クラス") · \(item.openingTerm)").font(.caption).foregroundStyle(.secondary)
                    Text(item.intensive ? "集中講義（日程未指定）" : item.slots.map { "\(weekdays[$0.weekday])\($0.period)限" }.joined(separator: "・")).font(.caption)
                    Text(item.instructor + " · " + item.classroom).font(.caption).foregroundStyle(.secondary)
                  }
                }
              }
  }
  var body: some View {
    PlannerNavigation(embedded: embedded) {
      PlannerList {
        if let catalog = store.snapshot.officialCatalog {
          Section {
            Label(catalog.sourceLabel, systemImage: "building.columns.fill").font(.headline).foregroundStyle(.teal)
            Text(catalog.title)
            Text("\(catalog.faculty) · \(catalog.department)").font(.subheadline)
            Text("公式テンプレートはログインの有無にかかわらず常に利用できます。選んだ科目は時間割に表示し、ログインすると本人専用の保存先に同期できます。").font(.caption).foregroundStyle(.secondary)
          }
          Section("絞り込み") {
            Picker("学部", selection: $faculty) { Text("全学部（収録分）").tag(""); ForEach(store.snapshot.affiliations) { Text($0.faculty).tag($0.faculty) } }
            Text("対象: 2026年度 第2学期").font(.caption)
            Picker("ターム", selection: $opening) { Text("秋").tag("秋"); Text("冬").tag("冬") }.pickerStyle(.segmented)
            Picker("学年", selection: $year) { Text("すべて・未設定").tag(0); ForEach(1...4, id: \.self) { Text("\($0)年").tag($0) } }.accessibilityIdentifier("official.year")
            Picker("コース", selection: $course) { Text("全コース").tag(""); ForEach(choices, id: \.self) { Text($0).tag($0) } }.accessibilityIdentifier("official.course")
            Picker("2年次クラス", selection: $classGroup) { Text("全クラス").tag(""); ForEach(["A", "B", "C"], id: \.self) { Text($0 + "クラス").tag($0) } }
            Text("他学部・学科の公式資料は未収録です。1年次はこのPDFに記載がありません。").font(.caption).foregroundStyle(.secondary)
          }
          applicationMode
          Section {
            Button("該当する全\(filtered.count)科目を追加") { bulkConfirm = true }.disabled(replace || filtered.isEmpty || year == 0 || course.isEmpty || (year == 2 && classGroup.isEmpty)).accessibilityIdentifier("official.bulk")
            Text("学年・コース（2年次はクラス）を選択してください。候補を確認して追加します。履修の確定ではありません。同時刻の科目は候補として並び、集中講義は別に表示します。既存の選択は残します。").font(.caption).foregroundStyle(.secondary)
          }
          courseList
          Section("大学からの注記") {
            ForEach(catalog.dateOverrides, id: \.date) { Text($0.sourceText) }
            ForEach(catalog.notes, id: \.self) { Text($0).font(.caption) }
            Text("出典: \(catalog.sourceFileName) · \(catalog.sourcePages)ページ").font(.caption).foregroundStyle(.secondary)
          }
        } else { Text("公式時間割を読み込み中です。") }
        Section("適用後の時間割プレビュー") { TimetablePreview(lectures: previewLectures); Text("曜日・時限を確認してから保存してください。重複は保存時に検証します。").font(.caption) }
      }.navigationTitle("公式テンプレート").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { if !embedded { Button("完了") { dismiss() } } }; ToolbarItem(placement: .confirmationAction) { Button(replace ? "置換内容を確認" : "選択を保存") { if replace { replaceConfirm = true } else { store.action("officialSelection", ["ids": Array(selected).sorted()]); dismiss() } }.disabled(store.snapshot.busy || (replace && candidateIDs.isEmpty)).accessibilityIdentifier("official.save") } }
      .confirmationDialog("\(filtered.count)科目（集中講義\(filtered.filter(\.intensive).count)件）を選択に追加しますか？", isPresented: $bulkConfirm, titleVisibility: .visible) {
        Button("既存の選択を残して一括追加") { selected.formUnion(filtered.map(\.id)); store.action("officialSelection", ["ids": Array(selected).sorted()]); dismiss() }
      }
      .confirmationDialog("対象の時間割表示を置換しますか？", isPresented: $replaceConfirm, titleVisibility: .visible) {
        Button("復元記録を保存して表示を置換") { store.action("replaceTimetable", TimetableReplacementPayload(term: targetTerm, ids: candidateIDs)) }
        Button("キャンセル", role: .cancel) {}
      } message: { Text(targetTerm + "\n現在\(oldRows.count)時限 → \(replacementRows.count)時限。原本の授業・成績・課題は残します。保存に失敗した場合は表示を切り替えません。") }
      .onAppear {
        if !loaded {
          let profile = initialProfile ?? store.snapshot.profile
          opening = initialOpening; selected = Set(store.snapshot.officialSelection); year = profile.studentYear; classGroup = profile.classGroup; faculty = profile.department
          course = choices.first { profile.major == $0 || profile.major.hasSuffix(" " + $0) } ?? ""; loaded = true
        }
      }
    }
  }
}
struct OfficialCourseDetail: View {
  @ObservedObject var store: PlannerStore
  var courseID: String
  @State private var tab: LectureDetailTab = requestedReviewScreen() == "grades" ? .grades : .lecture
  @State private var chat = false
  private var course: OfficialCourse? { store.snapshot.officialCatalog?.courses.first { $0.id == courseID } }
  var body: some View {
    VStack(spacing: 0) {
      LearningLinks(lecture: course.map { historyReference(for: $0) }).padding(.horizontal)
      Picker("詳細の表示", selection: $tab) { ForEach(LectureDetailTab.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
        .pickerStyle(.segmented).padding(.horizontal).padding(.vertical, 8).accessibilityIdentifier("lecture.tabs")
      PlannerList {
      if let item = course {
        if tab == .lecture {
        Section("大学公式（本人提供PDF）") {
          Text(item.title).font(.headline)
          LabeledContent("担当教員", value: item.instructor)
          LabeledContent("教室", value: item.classroom)
          if item.intensive { Text("集中講義。曜日・時限は資料に指定されていません。日程は大学の案内を確認してください。") }
          else { ForEach(item.slots, id: \.self) { Text("\(weekdays[$0.weekday])曜\($0.period)限 · \(periodTimes[$0.period - 1])") } }
          if !item.notes.isEmpty { Text(item.notes) }
          Text("原資料 \(item.page)ページ").font(.caption).foregroundStyle(.secondary)
        }
        Section { Button("この講義のチャット") { chat = true }.accessibilityIdentifier("lecture.chat") }
        Section("関連する課題") { let related = store.snapshot.tasks.filter { $0.related_lecture_id == item.id || $0.related_lecture_id?.hasPrefix(item.id + ":") == true }; if related.isEmpty { Text("関連する未完了の課題はありません。").foregroundStyle(.secondary) }; ForEach(related.sorted(by: taskDueOrder)) { task in NavigationLink { TaskDetail(store: store, taskID: task.id) } label: { TaskRow(task: task) } }; Text("科目名だけでは共有講義に紐付けません").font(.caption).foregroundStyle(.secondary) }
        Section("欠席回数") { Text("未登録").foregroundStyle(.secondary) }
        Section("講義メモ") { Text("メモはありません。").foregroundStyle(.secondary) }
        } else {
        Section("評価基準") { Text("未登録").foregroundStyle(.secondary) }
        GradeHistorySection(store: store, lecture: historyReference(for: item), officialReference: true)
        }
        if tab == .lecture && store.snapshot.officialSelection.contains(item.id) { Button("自分の時間割から外す", role: .destructive) { store.action("officialSelection", ["ids": store.snapshot.officialSelection.filter { $0 != item.id }]) } }
      } else { Text("公式科目が見つかりません。") }
      PromotionFooter(entries: store.snapshot.campus.entries)
      }
    }.navigationTitle("授業詳細").navigationBarTitleDisplayMode(.inline)
      .onAppear { store.action("campusOpen") }
      .sheet(isPresented: $chat) { if let course = course { DepartmentChatSheet(store: store, lecture: historyReference(for: course)) } }
  }
  private func historyReference(for item: OfficialCourse) -> Lecture {
    var lecture = Lecture()
    lecture.id = item.id
    lecture.lecture_name = item.title
    lecture.instructor = item.instructor
    lecture.classroom = item.classroom
    lecture.term = nil
    return lecture
  }
}
