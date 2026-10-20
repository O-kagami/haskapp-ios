import SwiftUI
import PhotosUI
import Photos
import Vision
import CoreImage.CIFilterBuiltins

struct PlannerRoot: View {
  @ObservedObject var store:PlannerStore
  @AppStorage private var guestSelected: Bool
  @AppStorage private var tutorialComplete: Bool
  @State private var tutorialVisible = false
  @State private var selectedTab: String
  init(store: PlannerStore) {
    self.store = store
    _selectedTab = State(initialValue: initialPlannerTab())
    let arguments = ProcessInfo.processInfo.arguments
    let namespace = arguments.firstIndex(of: "-haskapp-ui-test-namespace").flatMap { index in arguments.indices.contains(index + 1) ? arguments[index + 1] : nil } ?? "normal"
    _guestSelected = AppStorage(wrappedValue: false, "haskapp.guest-selected." + namespace)
    _tutorialComplete = AppStorage(wrappedValue: false, "haskapp.tutorial-complete." + namespace)
  }
  private var showWelcome: Bool {
    let arguments = ProcessInfo.processInfo.arguments
    return store.snapshot.account == "端末内のゲスト" && !guestSelected && (!arguments.contains("-haskapp-ui-tests") || arguments.contains("-haskapp-ui-onboarding"))
  }
  var body:some View {
    Group { if showWelcome {
      VStack(spacing: 24) {
        Image(systemName: "calendar").font(.system(size: 56)).foregroundStyle(.teal)
        Text("Haskapp").font(.largeTitle.bold())
        Text("時間割・課題・予定をひとつに").foregroundStyle(.secondary)
        Button("Googleでログイン") { store.action("googleLogin") }.buttonStyle(.borderedProminent).disabled(!store.snapshot.configured || store.snapshot.busy).accessibilityIdentifier("auth.google")
        Button("ゲストで利用する") { guestSelected = true }.buttonStyle(.bordered).accessibilityIdentifier("auth.guest")
        Text("ゲストのデータはこの端末に保存されます。Googleでログインすると、Web版と同じアカウントのデータを利用できます。ゲストのデータは自動でコピーされません。").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
      }.padding(28)
    } else { TabView(selection: $selectedTab) {
      TodayScreen(store:store).tabItem{Label("今日",systemImage:"sun.max")}.tag("today")
      TimetableScreen(store:store).tabItem{Label("時間割",systemImage:"calendar")}.tag("timetable")
      TasksScreen(store:store).tabItem{Label("課題",systemImage:"checklist")}.tag("tasks")
      CalendarScreen(store:store).tabItem{Label("予定",systemImage:"calendar.badge.clock")}.tag("calendar")
      SettingsScreen(store:store).tabItem{Label("設定",systemImage:"gearshape")}.tag("settings")
    } } }.id(store.snapshot.account).tint(.teal).environment(\.locale,Locale(identifier:"ja_JP")).environment(\.timeZone,plannerTimeZone).environment(\.calendar,plannerCalendar)
    .sheet(isPresented: $tutorialVisible) { PlannerTutorial(store: store, onClose: { tutorialVisible = false }, onComplete: { tutorialComplete = true; tutorialVisible = false }, onGuest: { guestSelected = true }) }
    .onAppear { if (!ProcessInfo.processInfo.arguments.contains("-haskapp-ui-tests") || ProcessInfo.processInfo.arguments.contains("-haskapp-ui-tutorial")) && !ProcessInfo.processInfo.arguments.contains("-haskapp-readonly-grade-verification") && !tutorialComplete { tutorialVisible = true } }
    .background(PlannerPalette.background.ignoresSafeArea())
    .overlay(alignment:.top) {if store.snapshot.busy {ProgressView().padding(8).background(.regularMaterial,in:Capsule()).allowsHitTesting(false)}}
    .alert("Haskapp",isPresented:Binding(get:{!store.snapshot.message.isEmpty},set:{if !$0 {store.dismissMessage()}})){Button("OK"){store.dismissMessage()}}message:{Text(store.snapshot.message)}
  }
}
struct EmptyState: View {
  var title:String;var symbol:String;var detail:String
  var body:some View{VStack(spacing:12){Image(systemName:symbol).font(.largeTitle).foregroundStyle(.teal);Text(title).font(.headline);Text(detail).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)}.frame(maxWidth:.infinity).padding(28)}
}
struct LectureRow: View {
 var lecture:Lecture
 var body:some View {HStack(spacing:12){RoundedRectangle(cornerRadius:3).fill(lectureColor(lecture)).frame(width:4);VStack(alignment:.leading,spacing:4){Text(lecture.lecture_name).font(.headline);Text("\(weekdays[min(6,max(0,lecture.day_of_the_week))])曜 \(lecture.period)限 · \((nonempty(lecture.classroom) ?? "教室未登録"))").font(.subheadline).foregroundStyle(.secondary)};Spacer()}.padding(.vertical,4)}
}
struct TodayScreen:View {
 @ObservedObject var store:PlannerStore
 @State private var clock = Date()
 private var today:String{dateString(clock)}

 var body:some View {NavigationStack{PlannerList {
  Section{VStack(alignment:.leading,spacing:8){Text(clock,format:.dateTime.month().day().weekday()).font(.title2.bold());Text(store.snapshot.account).foregroundStyle(.secondary);Label(store.snapshot.connection,systemImage:"externaldrive.badge.checkmark").font(.caption)}.padding(.vertical,8)}
  Section("今日の講義") {
   ForEach(todayPeriods(on: clock, snapshot: store.snapshot)) { slot in
    VStack(alignment: .leading, spacing: 7) {
     HStack { Text("\(slot.period)限").font(.headline); Text(periodTimes[slot.period - 1]).font(.caption).foregroundStyle(.secondary); Spacer(); if slot.current { Text("現在").font(.caption.bold()).foregroundStyle(.teal) } }.accessibilityIdentifier("today.period.\(slot.period)")
     if slot.lectures.isEmpty { Text("空きコマ").foregroundStyle(.secondary) }
     else { ForEach(slot.lectures) { lecture in NavigationLink {
      LecturePage(store: store, lecture: lecture)
     } label: { LectureRow(lecture: lecture) } } }
    }.padding(.vertical, 4)
   }
  }
  Section("期限が近い課題") {let tasks=store.snapshot.tasks.filter{!$0.isCompleted && $0.dueDate != nil}.sorted(by:taskDueOrder);if tasks.isEmpty {Text("期限のある未完了課題はありません").foregroundStyle(.secondary)}else {ForEach(Array(tasks.prefix(5))){t in NavigationLink{TaskDetail(store:store,taskID:t.id)}label:{TaskRow(task:t)}}}}
  Section("今日の試験・休講") {ForEach(store.snapshot.lectures.filter{dateOnly($0.test_datetime)==today || dateOnly($0.cancelled_date)==today}){l in NavigationLink{LectureDetail(store:store,lectureID:l.id)}label:{VStack(alignment:.leading){Text(l.lecture_name);if dateOnly(l.test_datetime)==today{Label("試験",systemImage:"pencil.and.list.clipboard").foregroundStyle(.orange)};if dateOnly(l.cancelled_date)==today{Label("休講",systemImage:"calendar.badge.minus").foregroundStyle(.secondary)}}}}}
  Section("今日の作業予定") {ForEach(store.snapshot.tasks.filter{!$0.isCompleted && dateOnly($0.scheduled_date)==today}.sorted(by:taskDueOrder)){t in NavigationLink{TaskDetail(store:store,taskID:t.id)}label:{TaskRow(task:t)}}}
  Section("今日の予定") {let events=store.snapshot.events.filter{dateOnly($0.date)==today};if events.isEmpty {Text("予定はありません").foregroundStyle(.secondary)}else{ForEach(events){e in Label(e.title,systemImage:"calendar.badge.clock")}}}
 }.onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { clock = $0 }.onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in clock = Date() }.navigationTitle("Haskapp").navigationBarTitleDisplayMode(.inline).refreshable{store.action("refresh")}.toolbar{Button{store.action("refresh")}label:{Image(systemName:"arrow.clockwise")}.disabled(store.snapshot.busy)}}}
}
struct TimetableScreen: View {
 @ObservedObject var store: PlannerStore
 @State private var term = termForDate(Date())
 @State private var editor: Lecture?
 @State private var detail: Lecture?
 @State private var search = false
 @State private var official = false
 @State private var intensive: OfficialCourse?
 @State private var qr = false
 @State private var reviewOpened = false
 private var allLectures: [Lecture] { effectiveTimetableLectures(store.snapshot) }
 var body: some View {
  NavigationStack {
   VStack(spacing: 8) {
    Picker("ターム", selection: $term) { ForEach(availableTerms(lectures: allLectures, selected: term), id: \.self) { Text($0).tag($0) } }.pickerStyle(.menu).font(.system(size: 16)).dynamicTypeSize(...DynamicTypeSize.large)
    GeometryReader { geometry in
     let width = max(1, (geometry.size.width - 36 - 24) / 5)
     let height = max(1, (geometry.size.height - 30 - 24) / 5)
     VStack(spacing: 4) {
      HStack(spacing: 4) { Color.clear.frame(width: 36, height: 26); ForEach(1...5, id: \.self) { day in Text(weekdays[day]).font(.system(size: 14, weight: .bold)).frame(width: width, height: 26).accessibilityIdentifier("timetable.day.\(day)") } }
      ForEach(1...5, id: \.self) { period in
       HStack(spacing: 4) {
        VStack(spacing: 3) { Text("\(period)限").font(.system(size: 12, weight: .bold)); Text(periodTimes[period-1].replacingOccurrences(of: "–", with: "\n")).font(.system(size: 9)).foregroundStyle(.secondary) }.frame(width: 36, height: height)
        ForEach(1...5, id: \.self) { day in
         let matches = allLectures.filter { $0.day_of_the_week == day && $0.period == period && ($0.term ?? legacyDefaultTerm) == term }
         Button { if let first = matches.first { detail = first } else { addLecture(day: day, period: period) } } label: {
          VStack(alignment: .leading, spacing: 3) {
           if matches.isEmpty { Image(systemName: "plus").font(.system(size: 16)).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity) }
           else { ForEach(Array(matches.prefix(2))) { lecture in
             HStack(alignment: .top, spacing: 3) {
              RoundedRectangle(cornerRadius: 2).fill(lectureColor(lecture)).frame(width: 3)
              VStack(alignment: .leading, spacing: 2) {
               Text(lecture.lecture_name).font(.system(size: min(13, max(10, height / 6)), weight: .semibold)).lineLimit(matches.count > 1 ? 2 : 3).minimumScaleFactor(0.8).foregroundStyle(.primary)
               Spacer(minLength: 0)
               if let room = nonempty(lecture.classroom) { Text(room).font(.system(size: min(11, max(9, height / 8)), weight: .medium)).lineLimit(matches.count > 1 ? 1 : 2).minimumScaleFactor(0.8).foregroundStyle(.primary) }
              }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
             }
            }; if matches.count > 2 { Text("ほか\(matches.count-2)件").font(.system(size: 10)) } }
          }.padding(5).frame(width: width, height: height, alignment: .topLeading).background(matches.first.map { lectureColor($0).opacity(0.22) } ?? Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
         }.buttonStyle(.plain).accessibilityIdentifier("timetable.cell.\(day).\(period)").accessibilityLabel("\(weekdays[day])曜日\(period)限 " + (matches.isEmpty ? "講義を追加" : matches.map { $0.lecture_name + "、" + (nonempty($0.classroom).map { "教室 " + $0 } ?? "教室未設定") }.joined(separator: "、")))
        }
       }
      }
     }
    }
    let unscheduled = (store.snapshot.officialCatalog?.courses ?? []).filter { $0.intensive && store.snapshot.officialSelection.contains($0.id) }
    if !unscheduled.isEmpty { Menu("集中講義・時限未定（\(unscheduled.count)件）") { ForEach(unscheduled) { course in Button(course.title) { intensive = course } } }.accessibilityIdentifier("timetable.intensive") }
    if let undo = store.snapshot.timetableView.undo { Button("直前の時間割表示に戻す（" + undo.term + "）") { store.action("undoTimetable") }.font(.caption).disabled(store.snapshot.busy).accessibilityIdentifier("timetable.undo") }
    Text("月〜金の全時限を表示 · 講義をタップして詳細").font(.system(size: 11)).foregroundStyle(.secondary)
   }.padding(.horizontal, 8).padding(.bottom, 4)
   .frame(maxWidth: .infinity, maxHeight: .infinity).background(PlannerPalette.background.ignoresSafeArea())
   .navigationTitle("時間割").navigationBarTitleDisplayMode(.inline)
   .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button { qr = true } label: { Image(systemName: "qrcode") }.accessibilityLabel("時間割QR").accessibilityIdentifier("timetable.qr") }; ToolbarItem(placement: .navigationBarTrailing) { Button { official = true } label: { Image(systemName: "building.columns") }.accessibilityLabel("公式テンプレート").accessibilityIdentifier("official.open") }; ToolbarItem(placement: .navigationBarLeading) { Button { search = true } label: { Label("講義を検索", systemImage: "magnifyingglass") } }; ToolbarItem(placement: .navigationBarTrailing) { Button { addLecture(day: 1, period: 1) } label: { Label("講義を追加", systemImage: "plus") } } }
   .onChange(of: store.snapshot.revision) { _ in
     guard !reviewOpened, !allLectures.isEmpty else { return }
     if requestedReviewScreen() == "qr" { reviewOpened = true; qr = true }
     if ["lecture", "grades"].contains(requestedReviewScreen() ?? ""), let first = allLectures.first(where: { ($0.term ?? legacyDefaultTerm) == term }) { reviewOpened = true; detail = first }
   }
   .sheet(item: $editor) { LectureEditor(store: store, initial: $0, isNew: true) }
   .navigationDestination(isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } })) {
     if let lecture = detail {
       let matches = allLectures.filter { $0.day_of_the_week == lecture.day_of_the_week && $0.period == lecture.period && ($0.term ?? legacyDefaultTerm) == term }
       if matches.count == 1 { LecturePage(store: store, lecture: lecture) }
       else { PlannerList { ForEach(matches) { item in NavigationLink { LecturePage(store: store, lecture: item) } label: { LectureRow(lecture: item) } } }.navigationTitle("同じ時限の講義") }
     }
   }
   .navigationDestination(isPresented: Binding(get: { intensive != nil }, set: { if !$0 { intensive = nil } })) { if let course = intensive { OfficialCourseDetail(store: store, courseID: course.id) } }
   .sheet(isPresented: $qr) { TimetableSharing(store: store, initialTerm: term) }
   .navigationDestination(isPresented: $official) { OfficialTemplatesSheet(store: store, embedded: true, initialOpening: term.contains("冬") ? "冬" : "秋") }
   .navigationDestination(isPresented: $search) { LectureSearch(store: store, term: term, onSelect: { term = $0.term ?? legacyDefaultTerm }, embedded: true) }
  }
 }
 private func addLecture(day: Int, period: Int) { guard store.snapshot.account == "端末内のゲスト" else { search = true; return }; var lecture = Lecture(); lecture.term = term; lecture.day_of_the_week = day; lecture.period = period; editor = lecture }
}
struct LectureEditor: View {
  @ObservedObject var store: PlannerStore
  let isNew: Bool
  @Environment(\.dismiss) private var dismiss
  @State private var lecture: Lecture
  @State private var assessment: AssessmentDraft
  init(store: PlannerStore, initial: Lecture, isNew: Bool) {
    self.store = store; self.isNew = isNew; _lecture = State(initialValue: initial)
    _assessment = State(initialValue: AssessmentDraft(lecture: initial))
  }
  private var conflict: String? { lectureConflictMessage(lecture, existing: effectiveTimetableLectures(store.snapshot)) }
  private var shared: Bool { lecture.schedule_is_shared && store.snapshot.account != "端末内のゲスト" }
  var body: some View {
    NavigationStack {
      PlannerForm {
        if shared {
          Section("共有される講義情報") {
            LabeledContent("講義名", value: lecture.lecture_name)
            LabeledContent("教員", value: nonempty(lecture.instructor) ?? "未登録")
            LabeledContent("シラバスID", value: nonempty(lecture.syllabus_id) ?? "未登録")
            LabeledContent("ターム", value: lecture.term ?? legacyDefaultTerm)
            LabeledContent("表示中の時限", value: "\(weekdays[min(6, max(0, lecture.day_of_the_week))])曜 \(lecture.period)限")
            Text(isNew ? "この講義に設定されている全ての共有時限を登録します。講義名・教員・シラバス・曜日・時限・タームは変更できません。" : "講義名・教員・シラバス・曜日・時限・タームは共有情報のため変更できません。")
              .font(.caption).foregroundStyle(.secondary)
            Text("教室・出欠・評価基準は、自分の登録に保存されてこの講義の全時限に反映されます。")
              .font(.caption).foregroundStyle(.secondary)
          }
        } else {
          Section("基本情報") {
            Text("個人講義は本人専用の保存先に同期します。講義詳細・シラバスID・色・持ち物はこの端末だけに保存します。").font(.caption).foregroundStyle(.secondary)
            TextField("講義名", text: $lecture.lecture_name)
            TextField("教員", text: $lecture.instructor)
            TextField("シラバスID", text: textBinding($lecture.syllabus_id))
            Picker("ターム", selection: Binding(get: { lecture.term ?? legacyDefaultTerm }, set: { lecture.term = $0 })) {
              ForEach(availableTerms(lectures: store.snapshot.lectures, selected: lecture.term ?? legacyDefaultTerm), id: \.self) { Text($0).tag($0) }
            }
            Picker("曜日", selection: $lecture.day_of_the_week) { ForEach(1...5, id: \.self) { Text(weekdays[$0]).tag($0) }; if lecture.day_of_the_week == 0 || lecture.day_of_the_week == 6 { Text("保存済みの曜日（表示対象外）").tag(lecture.day_of_the_week) } }
            Picker("時限", selection: $lecture.period) { ForEach(1...5, id: \.self) { Text("\($0)限").tag($0) } }
          }
        }
        Section("自分の講義設定") {
          TextField("教室", text: textBinding($lecture.classroom))
          if shared { Text("色は共有シラバスの情報に基づきます。").font(.caption).foregroundStyle(.secondary) }
          else { ThemePicker(selection: $lecture.colorTheme) }
        }
        Section("詳細") {
          TextField("講義詳細", text: textBinding($lecture.lecture_details), axis: .vertical)
          TextField("メモ", text: textBinding($lecture.memo), axis: .vertical)
          TextField("持ち物（端末内）", text: textBinding($lecture.belongings), axis: .vertical)
        }
        Section("出欠・評価基準（空欄は未登録）") {
          if let absences = lecture.absences {
            Stepper("欠席 \(absences) 回", value: Binding(get: { lecture.absences ?? 0 }, set: { lecture.absences = $0 }), in: 0...999)
          } else {
            Text("欠席回数は未記録です。").foregroundStyle(.secondary)
            Button("欠席0回として記録") { lecture.absences = 0 }
          }
          TextField("講義回数", text: $assessment.total).keyboardType(.numberPad)
          TextField("必要出席回数", text: $assessment.required).keyboardType(.numberPad)
          TextField("レポート %", text: $assessment.report).keyboardType(.numberPad)
          TextField("試験 %", text: $assessment.test).keyboardType(.numberPad)
          TextField("小テスト %", text: $assessment.quiz).keyboardType(.numberPad)
          TextField("評価メモ", text: Binding(get: { lecture.assessmentNote }, set: { lecture.assessmentNote = $0 }), axis: .vertical)
        }
        if let conflict = conflict { Section { Label(conflict, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) } }
        if let error = assessment.validationMessage {
          Section("入力内容を確認") {
            Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
              .accessibilityIdentifier("lecture.assessment.validation")
          }
        }
        Section("試験・休講日") {
          OptionalDateField(title: "試験日", value: $lecture.test_datetime)
          OptionalDateField(title: "休講日", value: $lecture.cancelled_date)
        }
      }
      .navigationTitle(isNew ? "講義を追加" : "講義を編集").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") {
            guard assessment.validationMessage == nil else { return }
            store.action(isNew ? "newLecture" : "saveLecture", assessment.applying(to: lecture)); dismiss()
          }
            .disabled(lecture.lecture_name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || assessment.validationMessage != nil || store.snapshot.busy || conflict != nil)
        }
      }
    }
  }
}
struct LectureSearch: View {
  @ObservedObject var store: PlannerStore
  var term: String
  var onSelect: (Lecture) -> Void = { _ in }
  var embedded = false
  @State private var query = ""
  @State private var selected: Lecture?
  @State private var officialDetail: OfficialCourse?
  @State private var onlyAffiliation = false
  @State private var onlyTerm = true
  @Environment(\.dismiss) private var dismiss
  private var officialResults: [OfficialCourse] {
    (store.snapshot.officialCatalog?.courses ?? []).filter { item in
      let text = normalizeQuery(query)
      let matches = text.isEmpty || text.split(separator: " ").allSatisfy { normalizeQuery(item.title + " " + item.instructor).contains($0) }
      let profile = store.snapshot.profile
      let affiliation = !onlyAffiliation || ((profile.department.isEmpty || profile.department == store.snapshot.officialCatalog?.faculty) && (profile.studentYear == 0 || item.studentYear == profile.studentYear) && (profile.major.isEmpty || item.courseNames.contains { profile.major == $0 || profile.major.hasSuffix(" " + $0) }) && (profile.classGroup.isEmpty || item.classGroup.isEmpty || profile.classGroup == item.classGroup))
      let targetTerm = !onlyTerm || (term.hasPrefix("2026年度 2学期") && (item.openingTerm == (term.contains("秋") ? "秋" : "冬") || ["2学期", "通年"].contains(item.openingTerm)))
      return matches && affiliation && targetTerm
    }
  }
  private var sharedResults: [SearchLecture] { store.snapshot.searchResults.filter { !onlyTerm || ($0.schedules ?? []).isEmpty || ($0.schedules ?? []).contains { nonempty($0.period_start_daytime) == nil || canonicalTerm(for: $0) == term } } }
  private func normalizeQuery(_ text: String) -> String { text.precomposedStringWithCompatibilityMapping.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ") }
  var body: some View {
    PlannerNavigation(embedded: embedded) {
      PlannerList {
        Section("検索条件") {
          Toggle("選択中の年度・ターム", isOn: $onlyTerm)
          Toggle("所属・学年で公式科目を絞る", isOn: $onlyAffiliation)
          Text(term).font(.caption)
          Text("共有カタログには所属・学年がないため、その条件は公式科目だけに適用します。").font(.caption).foregroundStyle(.secondary)
          Button("共有カタログを検索") { search() }.disabled(!store.snapshot.configured || store.snapshot.busy).accessibilityIdentifier("search.run")
          Text(store.snapshot.searchStatus).font(.caption).accessibilityIdentifier("search.status")
          if store.snapshot.busy { ProgressView("共有講義を検索中…") }
        }
        Section("公式科目（\(officialResults.count)件・端末で検索）") {
          if officialResults.isEmpty { Text("この条件の公式科目はありません。年度・タームや所属の絞り込みを確認してください。") }
          ForEach(officialResults) { item in
            VStack(alignment: .leading, spacing: 5) {
              Button(item.title) { officialDetail = item }.font(.headline)
              Text("\(item.studentYear)年 · \(item.classGroup) · \(item.openingTerm) · \(item.instructor)").font(.caption).foregroundStyle(.secondary)
              Text(item.intensive ? "集中講義・時限未定" : item.slots.map { "\(weekdays[$0.weekday])曜\($0.period)限" }.joined(separator: "・")).font(.caption)
              Button(store.snapshot.officialSelection.contains(item.id) ? "追加済み" : "公式科目を時間割に追加") {
                store.action("officialSelection", ["ids": Array(Set(store.snapshot.officialSelection + [item.id])).sorted()]); dismiss()
              }.disabled(store.snapshot.busy || store.snapshot.officialSelection.contains(item.id)).accessibilityIdentifier("search.official.add." + item.id)
            }.padding(.vertical, 4)
          }
        }
        if sharedResults.isEmpty && store.snapshot.searchStatus != "未検索" { Section("共有カタログ") { Text("この条件の共有講義はありません。タームの絞り込みを外して再検索できます。") } }
        ForEach(sharedResults) { result in
          Section {
            if let schedules = result.schedules, !schedules.isEmpty {
              ForEach(Array(schedules.enumerated()), id: \.offset) { entry in
                VStack(alignment: .leading, spacing: 4) {
                  Label(scheduleSummary(entry.element), systemImage: "calendar")
                  Text(nonempty(entry.element.period_start_daytime) == nil ? "年度・ターム未登録（登録時に確認）" : canonicalTerm(for: entry.element)).font(.caption).foregroundStyle(.secondary)
                }
              }
            } else {
              Text("共有時限が未登録です。").foregroundStyle(.secondary)
            }
            Button(registrationTitle(result)) { select(result) }
              .disabled(store.snapshot.busy || (cloudRegistration && ((result.schedules ?? []).isEmpty || isRegistered(result))))
          } header: {
            VStack(alignment: .leading) {
              Text(result.name)
              if let teacher = nonempty(result.public_lecture_data?.first?.teacher) { Text(teacher) }
            }
          } footer: {
            Text(cloudRegistration ? "共有時限は全てまとめて登録します。曜日・時限・タームを個別には変更できません。" : "ゲスト利用では、編集画面で選んだ1時限を端末内に保存します。")
          }
        }
      }
      .searchable(text: $query, prompt: "授業名・教員名（空欄は全科目）")
      .onSubmit(of: .search) { search() }
      .navigationTitle("講義を探す")
      .toolbar { if !embedded { Button("完了") { dismiss() } } }
      .navigationDestination(isPresented: Binding(get: { officialDetail != nil }, set: { if !$0 { officialDetail = nil } })) { if let course = officialDetail { OfficialCourseDetail(store: store, courseID: course.id) } }
      .sheet(item: $selected) { lecture in LectureEditor(store: store, initial: lecture, isNew: true) }
    }
  }
  private func search() {
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard store.snapshot.configured, !store.snapshot.busy else { return }
    store.action("search", ["query": text])
  }
  private func scheduleSummary(_ schedule: PublicSchedule) -> String {
    let weekday = schedule.day_of_week.flatMap { (0...6).contains($0) ? weekdays[$0] + "曜" : nil } ?? "曜日未指定"
    let start = nonempty(schedule.start_time).map { String($0.prefix(5)) } ?? "時刻未指定"
    let end = nonempty(schedule.end_time).map { "–" + String($0.prefix(5)) } ?? ""
    return "\(weekday) · \(start)\(end)"
  }
  private var cloudRegistration: Bool { store.snapshot.account != "端末内のゲスト" }
  private func isRegistered(_ result: SearchLecture) -> Bool {
    store.snapshot.lectures.contains { $0.lecture_list_id == result.id }
  }
  private func registrationTitle(_ result: SearchLecture) -> String {
    guard cloudRegistration else { return "講義を端末に追加" }
    let count = result.schedules?.count ?? 0
    return isRegistered(result) ? "登録済み（全\(count)時限）" : "講義を登録（全\(count)時限）"
  }
  private func select(_ result: SearchLecture) {
    let schedule = result.schedules?.first
    var lecture = Lecture()
    lecture.schedule_is_shared = cloudRegistration
    lecture.term = cloudRegistration ? canonicalTerm(for: schedule) : term
    lecture.lecture_list_id = result.id
    lecture.lecture_name = result.name
    lecture.instructor = "未登録教員"
    if let data = result.public_lecture_data?.first {
      lecture.lecture_name = nonempty(data.name) ?? result.name
      lecture.instructor = nonempty(data.teacher) ?? "未登録教員"
      lecture.classroom = data.classroom
      lecture.syllabus_id = data.syllabus_id
      lecture.lecture_details = data.details
    }
    if let schedule = schedule {
      lecture.day_of_the_week = schedule.day_of_week.flatMap { (0...6).contains($0) ? $0 : nil } ?? 1
      lecture.period = ["08:45", "10:30", "13:00", "14:45", "16:30"].firstIndex(of: String((schedule.start_time ?? "").prefix(5))).map { $0 + 1 } ?? 1
    }
    onSelect(lecture)
    selected = lecture
  }
}

struct PlannerTutorial: View {
  @ObservedObject var store: PlannerStore
  var onClose: () -> Void
  var onComplete: () -> Void = {}
  var onGuest: () -> Void = {}
  private let namespace: String
  @AppStorage private var step: Int
  @State private var profile = Profile()
  @State private var loaded = false
  @State private var courses = false
  @State private var sharing = false
  init(store: PlannerStore, onClose: @escaping () -> Void, onComplete: @escaping () -> Void = {}, onGuest: @escaping () -> Void = {}) {
    self.store = store; self.onClose = onClose; self.onComplete = onComplete; self.onGuest = onGuest
    let args = ProcessInfo.processInfo.arguments
    let namespace = args.firstIndex(of: "-haskapp-ui-test-namespace").flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil } ?? "normal"
    self.namespace = namespace
    _step = AppStorage(wrappedValue: 0, "haskapp.tutorial-step." + namespace)
  }
  private var draftKey: String { "haskapp.tutorial-profile." + namespace + "." + store.snapshot.account }
  private let titles = ["ログイン方法", "所属・学年", "授業を選択", "iCalの課題", "共有テンプレート"]
  private var majors: [String] { store.snapshot.affiliations.first { $0.faculty == profile.department }?.majors ?? [] }
  var body: some View {
    NavigationStack {
      PlannerForm {
        Section { Text("\(min(4, max(0, step)) + 1) / 5 · " + titles[min(4, max(0, step))]).font(.headline).accessibilityIdentifier("tutorial.step") }
        switch step {
        case 0:
          Section("利用方法") {
            Text("今日で授業・締切を確認し、時間割で講義、課題で進捗、予定で日程を管理します。各データはログイン中の本人用とゲスト用に分けて保持します。")
            Text(store.snapshot.account == "端末内のゲスト" ? "GoogleでWeb版と同じアカウントを利用できます。ゲストのままでも始められます。" : "ログイン済みです。" )
            if store.snapshot.account == "端末内のゲスト" { Button("Googleでログイン") { store.action("googleLogin") }.disabled(!store.snapshot.configured || store.snapshot.busy); Button("ゲストで続ける") { onGuest(); step = 1 } }
            Text("途中で閉じてもこのステップから再開できます。端末の既存データは保持します。").font(.caption)
          }
        case 1:
          Section("所属") {
            Picker("学部", selection: Binding(get: { profile.department }, set: { profile.department = $0; profile.major = "" })) { Text("未選択").tag(""); ForEach(store.snapshot.affiliations) { Text($0.faculty).tag($0.faculty) } }
            Picker("学科・コース", selection: $profile.major) { Text("未選択").tag(""); ForEach(majors, id: \.self) { Text($0).tag($0) } }
            Picker("学年", selection: $profile.studentYear) { Text("未設定").tag(0); ForEach(1...4, id: \.self) { Text("\($0)年").tag($0) } }
            if profile.studentYear == 2 { Picker("クラス", selection: $profile.classGroup) { Text("未設定").tag(""); ForEach(["A", "B", "C"], id: \.self) { Text($0).tag($0) } } }
            Button("所属を保存") { store.action("profile", profile) }.disabled(store.snapshot.busy)
          }
        case 2:
          Section("公式授業") { Text("所属・学年・クラスを選び、候補の曜日・時限を確認して追加します。重複する時限は登録できません。科目の選択は履修申請ではありません。"); TimetablePreview(lectures: store.snapshot.lectures + store.snapshot.officialLectures); Text("候補を確認して選択または一括追加します。既存の授業は残ります。"); Button("テンプレートから授業を選択") { courses = true }; Text("選択済み: \(store.snapshot.officialSelection.count)科目") }
        case 3:
          Section("課題を取り込む") { Text("ELMSのiCal URLから提出期限を取り込みます。予定は講義と関連付けでき、月間／週間で確認できます。URLは秘密情報のため共有しません。"); SecureField("iCalのHTTPS URL", text: $profile.icalUrl).textInputAutocapitalization(.never).autocorrectionDisabled(); Button("iCalから課題を読み込む") { store.action("importIcal", profile) }.disabled(profile.icalUrl.isEmpty || store.snapshot.busy); Text("iCalは課題だけを取り込みます。URLは共有テンプレートに含めません。あとで設定できます。").font(.caption) }
        default:
          Section("他の利用者への共有") { Text("QRは時間割の公開項目だけを共有します。読み込んだ内容は確認してから取り込みます。チャットの投稿はログイン後に自分で送信してください。"); Text("授業名・時間割・授業の評価割合を共有テンプレートとして提供するか選べます。個人の得点・取得成績、メモ、課題、予定、秘密URLは共有しません。"); Button("共有する項目を確認") { sharing = true }; Text(profile.shareTemplates ? "同意済み" : "未同意（初期値）") }
        }
        Section {
          if step > 0 { Button("戻る") { step -= 1 } }
          Button(step < 4 ? "次へ（未設定でも進む）" : "チュートリアルを完了") { if step < 4 { step += 1 } else { store.action("profile", profile); onComplete(); onClose() } }.accessibilityIdentifier("tutorial.next")
          Button("あとで再開") { onClose() }
        }
      }.navigationTitle("はじめてのHaskapp").navigationBarTitleDisplayMode(.inline)
        .onAppear { if !loaded { profile = store.snapshot.profile
          if let draft = UserDefaults.standard.dictionary(forKey: draftKey) { profile.department = draft["department"] as? String ?? profile.department; profile.major = draft["major"] as? String ?? profile.major; profile.studentYear = draft["year"] as? Int ?? profile.studentYear; profile.classGroup = draft["class"] as? String ?? profile.classGroup }
          loaded = true } }
        .onChange(of: profile) { value in UserDefaults.standard.set(["department": value.department, "major": value.major, "year": value.studentYear, "class": value.classGroup], forKey: draftKey) }
        .sheet(isPresented: $courses) { OfficialTemplatesSheet(store: store, initialProfile: profile) }
        .sheet(isPresented: $sharing) { TemplateSharingConsent(store: store, consent: $profile.shareTemplates) }
        .toolbar { Button("閉じる") { onClose() } }
    }
  }
}

struct TemplateSharingConsent: View {
  @ObservedObject var store: PlannerStore
  @Binding var consent: Bool
  @Environment(\.dismiss) private var dismiss
  @State private var approved = false
  var body: some View {
    NavigationStack {
      PlannerList {
        Section("他の利用者が再利用できる情報") {
          Text("共有講義の授業名・教員・時限、教室、レポート・試験・小テストの評価割合、授業回数・出席要件。")
          Text("個人の得点・取得成績、欠席回数、自由記述メモ、課題、iCal・Google Calendarの予定・URLは対象外です。")
          ForEach(store.snapshot.lectures.filter { $0.lecture_list_id != nil && !$0.personal_entry }) { lecture in
            VStack(alignment: .leading) { Text(lecture.lecture_name).font(.headline); Text("教室: " + (lecture.classroom ?? "未設定")); Text("レポート \(lecture.grading_report.map(String.init) ?? "未設定")% · 試験 \(lecture.grading_test.map(String.init) ?? "未設定")% · 小テスト \(lecture.grading_quiz.map(String.init) ?? "未設定")%") }.font(.caption)
          }
          Text("公式PDFの選択・本人専用の個人講義は、共有講義に紐付いていないため送信しません。").font(.caption)
        }
        Section { Toggle("この項目を他の利用者のテンプレートに提供する", isOn: $approved); Text("この画面では同意の設定だけを変更します。送信は設定保存時です。解除しても既に共有されたテンプレートの回収は別の確認が必要です。").font(.caption); Button("同意の選択を保存") { consent = approved; dismiss() } }
      }.navigationTitle("共有項目の確認").onAppear { approved = consent }.toolbar { Button("キャンセル") { dismiss() } }
    }
  }
}

struct LearningLinks: View {
  var lecture: Lecture?
  var body: some View {
    HStack {
      Link(destination: lecture.flatMap { courseURL(for: $0, service: .moodle) } ?? URL(string: "https://moodle.elms.hokudai.ac.jp/")!) { Label("Moodle", systemImage: "graduationcap") }
      Link(destination: lecture.flatMap { courseURL(for: $0, service: .elms) } ?? URL(string: "https://www.elms.hokudai.ac.jp/")!) { Label("ELMS", systemImage: "globe") }
    }.buttonStyle(.bordered).accessibilityIdentifier("lecture.learningLinks")
  }
}

struct TimetablePreview: View {
  let lectures: [Lecture]
  @State private var term = termForDate(Date())
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("時間割プレビュー").font(.headline)
      Picker("プレビューのターム", selection: $term) { ForEach(availableTerms(lectures: lectures, selected: term), id: \.self) { Text($0).tag($0) } }
      if lectures.isEmpty { Text("授業を選ぶと、ここに曜日と時限が表示されます。").foregroundStyle(.secondary) }
      else {
        Grid(horizontalSpacing: 4, verticalSpacing: 4) {
          GridRow { Text(""); ForEach(1...5, id: \.self) { Text(weekdays[$0]).font(.caption.bold()) } }
          ForEach(1...5, id: \.self) { period in
            GridRow {
              Text("\(period)").font(.caption)
              ForEach(1...5, id: \.self) { day in
                let rows = lectures.filter { $0.day_of_the_week == day && $0.period == period && ($0.term ?? legacyDefaultTerm) == term }
                Text(rows.map(\.lecture_name).joined(separator: " / ")).font(.system(size: 9)).lineLimit(4).frame(maxWidth: .infinity, minHeight: 42).padding(2).background(rows.count > 1 ? Color.orange.opacity(0.2) : Color.teal.opacity(rows.isEmpty ? 0.04 : 0.16), in: RoundedRectangle(cornerRadius: 5))
              }
            }
          }
        }
        Text("オレンジは重複候補です。既存授業は残し、新しい重複登録は拒否します。").font(.caption).foregroundStyle(.secondary)
      }
    }.accessibilityIdentifier("timetable.preview")
  }
}

struct TimetableSharing: View {
  @ObservedObject var store: PlannerStore
  let initialTerm: String
  @State private var selected = Set<String>()
  @State private var initialized = false
  @State private var page = 0
  @State private var raw = ""
  @State private var imported: [Lecture] = []
  @State private var error = ""
  @State private var imageItem: PhotosPickerItem?
  @State private var sharing = false
  @State private var avatar: UIImage?
  @State private var saveStatus = ""
  @Environment(\.dismiss) private var dismiss
  private var lectures: [Lecture] { effectiveTimetableLectures(store.snapshot).filter { ($0.term ?? legacyDefaultTerm) == initialTerm } }
  private var groups: [ShareableLectureGroup] { shareableLectureGroups(lectures) }
  private var generation: Result<[String], Error> { Result { try encodeTimetablePages(groups.filter { selected.contains($0.id) }.flatMap(\.lectures), term: initialTerm) } }
  private var pages: [String] { (try? generation.get()) ?? [] }
  private var shareImages: [UIImage] { let values = pages; let images = values.enumerated().compactMap { index, payload in cardImage(payload, page: index, count: values.count) }; return images.count == values.count ? images : [] }
  private func cardImage(_ payload: String, page: Int, count: Int) -> UIImage? { guard let image = try? timetableShareCard(payload: payload, term: initialTerm, page: page, count: count, avatar: avatar?.cgImage) else { return nil }; return UIImage(cgImage: image) }
  var body: some View {
    NavigationStack {
      PlannerList {
        Section("時間割QR") {
          Text(initialTerm).font(.subheadline)
          qrPreview
          Text("授業名・教員・教室・全ての曜日と時限を共有します。メモ・出欠・成績・課題・認証情報・秘密URLは含めません。").font(.caption).foregroundStyle(.secondary)
        }
        Section {
          DisclosureGroup("共有する講義（\(selected.count)/\(groups.count)件）") {
            ForEach(groups) { group in
              Button {
                if selected.contains(group.id) { selected.remove(group.id) } else { selected.insert(group.id) }
                page = 0
              } label: {
                HStack(alignment: .top) {
                  Image(systemName: selected.contains(group.id) ? "checkmark.circle.fill" : "circle")
                  VStack(alignment: .leading, spacing: 4) {
                    Text(group.title).font(.headline)
                    if let instructor = nonempty(group.lectures.first?.instructor) { Text(instructor).font(.caption) }
                    Text(group.lectures.sorted { ($0.day_of_the_week, $0.period) < ($1.day_of_the_week, $1.period) }.map { "\(weekdays[min(6, max(0, $0.day_of_the_week))])\($0.period)限" + (nonempty($0.classroom).map { "・" + $0 } ?? "") }.joined(separator: " / ")).font(.caption).fixedSize(horizontal: false, vertical: true)
                  }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
              }.accessibilityIdentifier("qr.course." + group.id)
            }
          }
        }
        Section("QRから取り込む") {
          PhotosPicker(selection: $imageItem, matching: .images) { Label("QR画像を読み取る", systemImage: "qrcode.viewfinder") }.accessibilityIdentifier("qr.read")
          Text("受け取ったQR画像を選び、内容を確認してから追加します。複数枚の場合は順番に読み込みます。").font(.caption)
          TextField("QRの文字列を貼り付け", text: $raw, axis: .vertical).accessibilityIdentifier("qr.payload")
          Button("内容を確認") { inspect(raw) }.disabled(raw.isEmpty)
          if !error.isEmpty { Text(error).foregroundStyle(.orange) }
          if !imported.isEmpty {
            TimetablePreview(lectures: imported)
            Text("新しい個人講義として追加します。既存授業は削除せず、認証やチャットの所属は引き継ぎません。").font(.caption)
            Button("確認した時間割を追加") { store.action("importTimetable", ["lectures": imported]); imported = []; raw = "" }.disabled(store.snapshot.busy).accessibilityIdentifier("qr.import")
          }
        }
      }.navigationTitle("時間割をQRで共有").toolbar { Button("完了") { dismiss() } }
        .onAppear { initializeSelection() }
        .task(id: store.snapshot.avatarURL) { await loadAvatar(store.snapshot.avatarURL) }
        .onChange(of: groups.map(\.id)) { _ in initializeSelection() }
        .onChange(of: imageItem) { item in Task { await read(item) } }
        .sheet(isPresented: $sharing) { TimetableShareSheet(images: shareImages) }
    }
  }
  @ViewBuilder private var qrPreview: some View {
    switch generation {
    case .success(let values):
      let index = min(max(0, page), values.count - 1)
      if let image = cardImage(values[index], page: index, count: values.count) {
        Image(uiImage: image).interpolation(.none).resizable().scaledToFit().frame(maxWidth: 320, maxHeight: 500).padding(8).background(Color.white, in: RoundedRectangle(cornerRadius: 8)).frame(maxWidth: .infinity).accessibilityLabel("時間割QRコード").accessibilityIdentifier("qr.image")
        if values.count > 1 {
          HStack { Button("前のQR") { page = max(0, index - 1) }.disabled(index == 0); Spacer(); Text("\(index + 1) / \(values.count)枚"); Spacer(); Button("次のQR") { page = min(values.count - 1, index + 1) }.disabled(index + 1 == values.count) }
          Text("容量に合わせて分割しました。全てのQRに全時限を分けて保持し、同じ講義の時限は1枚にまとめています。").font(.caption).foregroundStyle(.secondary)
        }
        Text("プロフィール画像を添えたカードです。アイコン未設定時はプレースホルダーを使います。共有前に内容を確認してください。").font(.caption).foregroundStyle(.secondary)
        Button("共有カードを写真に保存") { Task { await saveCards() } }.disabled(shareImages.isEmpty).accessibilityIdentifier("qr.save")
        if !saveStatus.isEmpty { Text(saveStatus).font(.caption).accessibilityIdentifier("qr.saveStatus") }
        Button("QRカードをSNSなどに共有") { sharing = true }.disabled(shareImages.count != values.count).accessibilityIdentifier("qr.share")
      } else { Label("QR画像を生成できませんでした。画面を開き直してください。", systemImage: "exclamationmark.triangle").foregroundStyle(.orange).accessibilityIdentifier("qr.renderError") }
    case .failure(let problem):
      Label(lectures.isEmpty ? "このタームには共有できる授業がありません。" : problem.localizedDescription, systemImage: "info.circle").font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("qr.error")
    }
  }
  @MainActor private func loadAvatar(_ raw: String) async {
    avatar = nil
    guard let url = URL(string: raw), url.scheme == "https", url.user == nil, url.password == nil, let host = url.host, !host.isEmpty, host != "localhost", !host.hasSuffix(".local") else { return }
    do {
      let configuration = URLSessionConfiguration.ephemeral; configuration.timeoutIntervalForRequest = 12
      let session = URLSession(configuration: configuration); defer { session.invalidateAndCancel() }
      let (data, response) = try await session.data(from: url)
      guard !Task.isCancelled, store.snapshot.avatarURL == raw, let response = response as? HTTPURLResponse, response.statusCode == 200, response.mimeType?.hasPrefix("image/") == true, data.count <= 5_000_000, let image = UIImage(data: data) else { return }
      avatar = UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256)).image { _ in image.draw(in: CGRect(x: 0, y: 0, width: 256, height: 256)) }
    } catch { /* A missing or expired avatar safely falls back to the placeholder. */ }
  }
  @MainActor private func saveCards() async {
    let images = shareImages; guard !images.isEmpty else { saveStatus = "カードを生成できませんでした。"; return }
    let permission = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
    guard permission == .authorized || permission == .limited else { saveStatus = "写真への保存が許可されていません。共有ボタンからファイルにも保存できます。"; return }
    do { try await PHPhotoLibrary.shared().performChanges { for image in images { PHAssetChangeRequest.creationRequestForAsset(from: image) } }; saveStatus = "共有カード\(images.count)枚を写真に保存しました。" }
    catch { saveStatus = "写真への保存に失敗しました。もう一度お試しください。" }
  }
  private func initializeSelection() { if !initialized && !groups.isEmpty { selected = Set(groups.map(\.id)); initialized = true } }
  private func inspect(_ value: String) { do { imported = try decodeTimetable(value); error = "" } catch { imported = []; self.error = error.localizedDescription } }
  @MainActor private func read(_ item: PhotosPickerItem?) async {
    do {
      guard let data = try await item?.loadTransferable(type: Data.self), data.count < 20_000_000 else { throw TimetableShareError.invalid }
      let request = VNDetectBarcodesRequest(); request.symbologies = [.qr]
      try VNImageRequestHandler(data: data).perform([request])
      guard let payload = request.results?.compactMap(\.payloadStringValue).first else { throw TimetableShareError.invalid }
      raw = payload; inspect(payload)
    } catch { imported = []; self.error = "QRを読み取れませんでした。Haskappの時間割QR画像を確認してください。" }
  }
}

func qrImage(_ raw: String) -> UIImage? {
  let filter = CIFilter.qrCodeGenerator(); filter.message = Data(raw.utf8); filter.correctionLevel = "M"
  guard let output = filter.outputImage, let image = CIContext().createCGImage(output.transformed(by: CGAffineTransform(scaleX: 7, y: 7)), from: output.extent.applying(CGAffineTransform(scaleX: 7, y: 7))) else { return nil }
  return UIImage(cgImage: image)
}
struct TimetableShareSheet: UIViewControllerRepresentable {
  let images: [UIImage]
  func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: images, applicationActivities: nil) }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct PlannerNavigation<Content: View>: View {
  var embedded: Bool
  var content: Content
  init(embedded: Bool, @ViewBuilder content: () -> Content) { self.embedded = embedded; self.content = content() }
  var body: some View { if embedded { content } else { NavigationStack { content } } }
}
// Common routing only; detail content remains the existing shared pages.
struct LecturePage: View {
  @ObservedObject var store: PlannerStore
  let lecture: Lecture
  var body: some View {
    if lecture.id.hasPrefix("official-") { OfficialCourseDetail(store: store, courseID: lecture.id.components(separatedBy: ":")[0]) }
    else if let activity = store.snapshot.activities.first(where: { $0.id == lecture.id }) { ClubDetail(store: store, activity: activity) }
    else { LectureDetail(store: store, lectureID: lecture.id) }
  }
}
