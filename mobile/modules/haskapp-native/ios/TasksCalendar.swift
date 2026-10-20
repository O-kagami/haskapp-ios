import SwiftUI

struct TaskRow: View {
  var task: PlannerTask
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
          .foregroundStyle(themeColor(task.colorTheme))
        Text(task.task_name).font(.headline)
        if task.isImported { Text("iCal").font(.caption).foregroundStyle(.secondary) }
      }
      HStack {
        Text(task.dueDate.map { "期限 \($0)" } ?? "期限なし")
          .foregroundStyle(task.isOverdue ? Color.red : Color.secondary)
        Spacer()
        Text("\(task.progress_percent)%")
      }.font(.caption)
      ProgressView(value: Double(task.progress_percent), total: 100).tint(themeColor(task.colorTheme))
    }.padding(.vertical, 4)
  }
}

struct TasksScreen: View {
  @ObservedObject var store: PlannerStore
  @State private var filter = "active"
  @State private var board = false
  @State private var query = ""
  @State private var editor: PlannerTask?
  var filtered: [PlannerTask] {
    store.snapshot.tasks.filter {
      (board || filter == "all" || (filter == "active" ? !$0.isCompleted : $0.isCompleted)) &&
      (query.isEmpty || $0.task_name.localizedCaseInsensitiveContains(query) || ($0.task_details ?? "").localizedCaseInsensitiveContains(query))
    }.sorted(by: taskDueOrder)
  }
  var body: some View {
    NavigationStack {
      PlannerList {
        Section {
          Picker("課題の表示形式", selection: $board) {
            Text("一覧").tag(false); Text("ボード").tag(true)
          }.pickerStyle(.segmented).accessibilityIdentifier("tasks.layout")
          if !board {
            Picker("表示", selection: $filter) {
              Text("未完了").tag("active"); Text("完了").tag("done"); Text("すべて").tag("all")
            }.pickerStyle(.segmented)
          }
        }
        if board {
          ForEach(TaskBoardStatus.allCases) { status in
            let tasks = filtered.filter { $0.status == status.rawValue }
            Section {
              if tasks.isEmpty { Text(query.isEmpty ? "課題はありません" : "検索に一致する課題はありません").foregroundStyle(.secondary) }
              taskRows(tasks)
              Button { addTask(status) } label: { Label("\(status.title)の課題を追加", systemImage: "plus") }
                .accessibilityIdentifier("tasks.add.\(status.rawValue)")
            } header: {
              Text("\(status.title)（\(tasks.count)件）").accessibilityIdentifier("tasks.group.\(status.rawValue)")
            }
          }
        } else {
          if filtered.isEmpty { EmptyState(title: "課題はありません", symbol: "checklist", detail: "＋から課題を登録できます。") }
          taskRows(filtered)
        }
      }
      .searchable(text: $query, prompt: "課題を検索")
      .navigationTitle("課題").navigationBarTitleDisplayMode(.inline)
      .toolbar { Button { addTask(.todo) } label: { Label("課題を追加", systemImage: "plus") } }
      .refreshable { store.action("refresh") }
      .sheet(item: $editor) { task in TaskEditor(store: store, initial: task, isNew: true) }
    }
  }
  private func addTask(_ status: TaskBoardStatus) {
    var task = PlannerTask(); task.status = status.rawValue; task.progress_percent = status.initialProgress; editor = task
  }
  @ViewBuilder private func taskRows(_ tasks: [PlannerTask]) -> some View {
    ForEach(tasks) { task in
      NavigationLink { TaskDetail(store: store, taskID: task.id) } label: { TaskRow(task: task) }
        .deleteDisabled(task.isImported || store.snapshot.busy)
        .contextMenu {
          ForEach(TaskBoardStatus.available(for: task).filter { $0.rawValue != task.status }) { status in
            Button("\(status.title)に移動") { store.action("taskStatus", ["id": task.id, "status": status.rawValue]) }
              .disabled(store.snapshot.busy)
          }
        }
        .swipeActions(edge: .leading) {
          Button(task.isCompleted ? "未完了に戻す" : "完了") {
            store.action("taskStatus", ["id": task.id, "status": task.isCompleted ? "todo" : "done"])
          }.tint(.teal).disabled(store.snapshot.busy)
        }
    }.onDelete { indices in
      guard !store.snapshot.busy else { return }
      for index in indices where tasks.indices.contains(index) && !tasks[index].isImported { store.action("deleteTask", ["id": tasks[index].id]) }
    }
  }

}

struct TaskDetail: View {
  @ObservedObject var store: PlannerStore
  var taskID: String
  @State private var editing = false
  @State private var deleting = false
  var task: PlannerTask? { store.snapshot.tasks.first { $0.id == taskID } }
  var body: some View {
    Group {
      if let task = task {
        PlannerList {
          Section { TaskRow(task: task); Text(task.task_details ?? "") }
          Section("進捗") {
            Picker("状態", selection: Binding(get: { task.status }, set: { store.action("taskStatus", ["id": task.id, "status": $0]) })) {
              Text("未着手").tag("todo")
              Text("作業中").tag("inProgress")
              Text("完了").tag("done")
            }.pickerStyle(.segmented).disabled(store.snapshot.busy)
          }
          Section("作業計画") {
            if let date = dateOnly(task.assigned_date) { LabeledContent("課題提示日", value: date) }
            if let date = dateOnly(task.scheduled_date) { LabeledContent("作業予定日", value: date) }
            if let duration = task.estimated_duration, !duration.isEmpty { LabeledContent("見積時間", value: duration) }
            if let lecture = store.snapshot.lectures.first(where: { ($0.lecture_list_id ?? $0.id) == (task.related_lecture_id ?? task.lecture_id) }) {
              NavigationLink { LectureDetail(store: store, lectureID: lecture.id) } label: { LabeledContent("講義", value: lecture.lecture_name) }
            }
          }
          if task.isImported {
            Section { Text("iCal配信元の課題です。内容の編集・削除は配信元で行ってください。進捗状態はこの端末に保存されます。").font(.caption).foregroundStyle(.secondary) }
          } else {
            Section { Button("削除", role: .destructive) { deleting = true } }
          }
        }
        .navigationTitle(task.task_name).navigationBarTitleDisplayMode(.inline)
        .toolbar { if !task.isImported { Button("編集") { editing = true } } }
        .sheet(isPresented: $editing) { TaskEditor(store: store, initial: task, isNew: false) }
        .confirmationDialog("課題を削除しますか？", isPresented: $deleting, titleVisibility: .visible) {
          Button("削除", role: .destructive) { store.action("deleteTask", ["id": task.id]) }
        }
      } else { EmptyState(title: "課題がありません", symbol: "checklist", detail: "課題タブに戻ってください。") }
    }
  }
}

struct OptionalDateField: View {
  var title: String
  @Binding var value: String?
  var body: some View {
    Toggle("\(title)を設定", isOn: Binding(get: { !(value ?? "").isEmpty }, set: { value = $0 ? dateString(Date()) : nil }))
    if !(value ?? "").isEmpty {
      DatePicker(title, selection: Binding(get: { dateValue(value) }, set: { value = dateString($0) }), displayedComponents: .date)
    }
  }
}

struct TaskEditor: View {
  @ObservedObject var store: PlannerStore
  let isNew: Bool
  @State private var task: PlannerTask
  @Environment(\.dismiss) private var dismiss
  init(store: PlannerStore, initial: PlannerTask, isNew: Bool) {
    self.store = store; self.isNew = isNew; _task = State(initialValue: initial)
  }
  var body: some View {
    NavigationStack {
      PlannerForm {
        Section("課題") {
          TextField("課題名", text: $task.task_name)
          TextField("詳細", text: textBinding($task.task_details), axis: .vertical)
          OptionalDateField(title: "期限", value: Binding(get: { task.deadline.isEmpty ? nil : task.deadline }, set: { task.deadline = $0 ?? "" }))
          Picker("講義", selection: Binding(get: { task.related_lecture_id ?? task.lecture_id ?? "" }, set: { task.related_lecture_id = $0.isEmpty ? nil : $0; task.lecture_id = $0.isEmpty ? nil : $0 })) {
            Text("講義なし").tag("")
            // Keep a removed or inaccessible course link until the user explicitly changes it.
            if let id = task.related_lecture_id ?? task.lecture_id, !uniqueLectures.contains(where: { ($0.lecture_list_id ?? $0.id) == id }) { Text("登録済みの講義").tag(id) }
            ForEach(uniqueLectures) { lecture in Text(lecture.lecture_name).tag(lecture.lecture_list_id ?? lecture.id) }
          }.accessibilityIdentifier("task.lecture")
        }
        Section("作業計画") {
          OptionalDateField(title: "課題提示日", value: $task.assigned_date)
          OptionalDateField(title: "作業予定日", value: $task.scheduled_date)
          TextField("見積時間（例 02:00:00）", text: textBinding($task.estimated_duration))
          Picker("状態", selection: Binding(get: { task.status }, set: { status in
            task.status = status
            task.progress_percent = status == "done" ? 100 : status == "inProgress" ? 50 : 0
          })) {
            Text("未着手").tag("todo"); Text("作業中").tag("inProgress"); Text("完了").tag("done")
          }
        }
      }
      .navigationTitle(isNew ? "課題を追加" : "課題を編集").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { store.action(isNew ? "newTask" : "saveTask", task); dismiss() }
            .disabled(task.task_name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.snapshot.busy || task.isImported)
        }
      }
    }
  }
  private var uniqueLectures: [Lecture] {
    var ids = Set<String>()
    return (store.snapshot.lectures + store.snapshot.officialLectures + store.snapshot.activities.map(\.lecture)).filter { ids.insert($0.lecture_list_id ?? $0.id).inserted }
  }
}

struct CalendarScreen: View {
  @ObservedObject var store: PlannerStore
  @State private var selected = Date()
  @State private var weekly = requestedReviewScreen() == "week"
  @State private var editor: PlannerEvent?
  var dayText: String { dateString(selected) }
  var events: [PlannerEvent] { store.snapshot.events.filter { dateOnly($0.date) == dayText } }
  var body: some View {
    NavigationStack {
      PlannerList {
        Section { Picker("カレンダー表示", selection: $weekly) { Text("月間").tag(false); Text("週間").tag(true) }.pickerStyle(.segmented).accessibilityIdentifier("calendar.layout")
          if weekly { WeekOverview(selected: $selected, store: store) } else { MonthOverview(selected: $selected, tasks: store.snapshot.tasks, events: store.snapshot.events) } }
        eventSection
        Section { Label("予定", systemImage: "calendar").foregroundStyle(.blue); Label("提出期限", systemImage: "flag.fill").foregroundStyle(.orange); Text("関連講義がある予定は講義色を使います。記号でも区別できます。").font(.caption) }
        taskSection
        workSection
        examSection
        lectureSection
        cancellationSection
      }
      .navigationTitle("予定").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) { Button("今日") { selected = Date() }.accessibilityLabel("今日を表示").accessibilityIdentifier("calendar.today") }
        ToolbarItem(placement: .navigationBarTrailing) {
          Button { var event = PlannerEvent(); event.date = dayText; editor = event } label: { Label("予定を追加", systemImage: "plus") }
        }
      }
      .refreshable { store.action("refresh") }
      .sheet(item: $editor) { event in
        if event.isImported { ImportedEventDetail(event: event) }
        else { EventEditor(store: store, initial: event, isNew: !store.snapshot.events.contains(where: { $0.id == event.id })) }
      }
    }
  }
  var eventSection: some View {
    Section("\(dayText) の予定") {
      if events.isEmpty { Text("予定はありません").foregroundStyle(.secondary) }
      ForEach(events) { event in
        Button { editor = event } label: { Label(event.title + (event.isImported ? " · iCal" : ""), systemImage: "calendar.badge.clock").foregroundStyle(themeColor(event.colorTheme)) }
          .deleteDisabled(event.isImported)
      }.onDelete { indices in
        let selectedEvents = events
        for index in indices where !selectedEvents[index].isImported { store.action("deleteEvent", ["id": selectedEvents[index].id]) }
      }
    }
  }
  var taskSection: some View {
    Section("課題の期限") {
      ForEach(store.snapshot.tasks.filter { $0.dueDate == dayText }.sorted(by: taskDueOrder)) { task in
        NavigationLink { TaskDetail(store: store, taskID: task.id) } label: { TaskRow(task: task) }
      }
    }
  }
  var workSection: some View {
    Section("課題の作業予定") {
      ForEach(store.snapshot.tasks.filter { dateOnly($0.scheduled_date) == dayText }.sorted(by: taskDueOrder)) { task in
        NavigationLink { TaskDetail(store: store, taskID: task.id) } label: { TaskRow(task: task) }
      }
    }
  }
  var examSection: some View {
    Section("試験") {
      ForEach(store.snapshot.lectures.filter { dateOnly($0.test_datetime) == dayText }) { lecture in
        NavigationLink { LectureDetail(store: store, lectureID: lecture.id) } label: { LectureRow(lecture: lecture) }
      }
    }
  }
  var lectureSection: some View {
    Section("この日の講義") {
      ForEach(scheduledLectures(on: selected, in: activePersonalLectures(store.snapshot)) + scheduledOfficialLectures(on: selected, snapshot: store.snapshot)) { lecture in
        NavigationLink {
          LecturePage(store: store, lecture: lecture)
        } label: { LectureRow(lecture: lecture) }
      }
    }
  }
  var cancellationSection: some View {
    Section("休講") {
      ForEach(store.snapshot.lectures.filter { dateOnly($0.cancelled_date) == dayText }) { lecture in
        NavigationLink { LectureDetail(store: store, lectureID: lecture.id) } label: {
          Label(lecture.lecture_name + " · 休講", systemImage: "calendar.badge.minus").foregroundStyle(.secondary)
        }
      }
    }
  }
}

struct MonthOverview: View {
  @Binding var selected: Date
  let tasks: [PlannerTask]
  let events: [PlannerEvent]
  @Environment(\.dynamicTypeSize) private var textSize
  private var days: [Date] { calendarMonthDays(containing: selected) }
  private var month: Int { plannerCalendar.component(.month, from: selected) }
  private var title: String { "\(plannerCalendar.component(.year, from: selected))年 \(month)月" }
  private func label(_ date: Date, summary: CalendarDaySummary) -> String {
    let weekday = weekdays[plannerCalendar.component(.weekday, from: date) - 1]
    return "\(dateString(date)) \(weekday)曜日、\(summary.label)" + (dateString(date) == dateString(Date()) ? "、今日" : "")
  }
  var body: some View {
    let activity = calendarDaySummaries(tasks: tasks, events: events)
    let empty = CalendarDaySummary(events: 0, deadlines: 0, work: 0)
    VStack(spacing: 12) {
      HStack {
        Button { move(-1) } label: { Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }.buttonStyle(.plain).accessibilityLabel("前の月").accessibilityIdentifier("calendar.previous")
        Spacer(); Text(title).font(.headline).accessibilityIdentifier("calendar.month"); Spacer()
        Button { move(1) } label: { Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }.buttonStyle(.plain).accessibilityLabel("次の月").accessibilityIdentifier("calendar.next")
      }
      if textSize.isAccessibilitySize {
        DatePicker("日付を選択", selection: $selected, displayedComponents: .date).datePickerStyle(.compact)
        ForEach(days.filter { plannerCalendar.component(.month, from: $0) == month && (activity[dateString($0)]?.total ?? 0) > 0 }, id: \.self) { date in
          let info = activity[dateString(date)] ?? empty
          Button { selected = date } label: {
            VStack(alignment: .leading) { Text(dateString(date)); Text(info.label).font(.subheadline) }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
          }.accessibilityLabel(label(date, summary: info)).accessibilityAddTraits(dateString(date) == dateString(selected) ? .isSelected : [])
            .accessibilityIdentifier("calendar.day." + dateString(date))
        }
      } else {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 5) {
          ForEach(weekdays, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary).accessibilityHidden(true) }
          ForEach(days, id: \.self) { date in
            let info = activity[dateString(date)] ?? empty
            Button { selected = date } label: {
              VStack(spacing: 2) {
                Text("\(plannerCalendar.component(.day, from: date))").font(.body.weight(dateString(date) == dateString(selected) ? .bold : .regular))
                if let event = events.first(where: { dateOnly($0.date) == dateString(date) }) { Text(event.title).font(.system(size: 8)).lineLimit(1).foregroundStyle(themeColor(event.colorTheme)) }
                if let task = tasks.first(where: { $0.dueDate == dateString(date) }) { Label(task.task_name, systemImage: "flag.fill").font(.system(size: 8)).lineLimit(1).foregroundStyle(.orange) }
                HStack(spacing: 3) {
                  if info.events > 0 { Image(systemName: "calendar").foregroundStyle(.blue) }
                  if info.deadlines > 0 { Image(systemName: "flag.fill").foregroundStyle(.orange) }
                  if info.work > 0 { Image(systemName: "pencil").foregroundStyle(.teal) }
                }.font(.system(size: 9)).frame(height: 12)
              }.frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
                .background(dateString(date) == dateString(selected) ? Color.teal.opacity(0.17) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                .foregroundStyle(plannerCalendar.component(.month, from: date) == month ? Color.primary : Color.secondary)
            }.buttonStyle(.plain).accessibilityLabel(label(date, summary: info))
              .accessibilityAddTraits(dateString(date) == dateString(selected) ? .isSelected : [])
              .accessibilityHint("この日の内容を表示します")
              .accessibilityIdentifier("calendar.day." + dateString(date))
          }
        }
        HStack(spacing: 12) { Label("予定", systemImage: "calendar"); Label("期限", systemImage: "flag.fill"); Label("作業", systemImage: "pencil") }.font(.caption).foregroundStyle(.secondary)
      }
      Text("選択日: " + dateString(selected)).font(.subheadline).accessibilityIdentifier("calendar.selected")
    }
  }
  private func move(_ amount: Int) {
    guard let start = plannerCalendar.dateInterval(of: .month, for: selected)?.start,
          let date = plannerCalendar.date(byAdding: .month, value: amount, to: start) else { return }
    selected = date
  }
}

struct ImportedEventDetail: View {
  let event: PlannerEvent
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      PlannerForm {
        LabeledContent("予定", value: event.title)
        LabeledContent("日付", value: event.date)
        Text("iCal配信元の予定です。内容の編集・削除は配信元で行ってください。").foregroundStyle(.secondary)
      }.navigationTitle("iCalの予定").toolbar { Button("完了") { dismiss() } }
    }
  }
}

struct EventEditor: View {
  @ObservedObject var store: PlannerStore
  let isNew: Bool
  @State private var event: PlannerEvent
  @Environment(\.dismiss) private var dismiss
  init(store: PlannerStore, initial: PlannerEvent, isNew: Bool) { self.store = store; self.isNew = isNew; _event = State(initialValue: initial) }
  var body: some View {
    NavigationStack {
      PlannerForm {
        TextField("予定名", text: $event.title)
        DatePicker("日付", selection: dateBinding($event.date), displayedComponents: .date)
        Picker("関連講義・サークル", selection: Binding(get: { event.relatedLectureID ?? "" }, set: { event.relatedLectureID = $0.isEmpty ? nil : $0 })) { Text("指定なし").tag(""); ForEach(store.snapshot.lectures + store.snapshot.officialLectures + store.snapshot.activities.map(\.lecture)) { lecture in Text(lecture.lecture_name).tag(lecture.id) }; if let id = event.relatedLectureID, !(store.snapshot.lectures + store.snapshot.officialLectures + store.snapshot.activities.map(\.lecture)).contains(where: { $0.id == id }) { Text("保存済みの関連先").tag(id) } }.accessibilityIdentifier("event.lecture")
        ThemePicker(selection: $event.colorTheme)
        if event.relatedLectureID != nil { Text("講義に関連付けた予定は、講義の色で表示します。").font(.caption) }
      }
      .navigationTitle(isNew ? "予定を追加" : "予定を編集")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { store.action(isNew ? "newEvent" : "saveEvent", event); dismiss() }
            .disabled(event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.snapshot.busy || event.isImported)
        }
      }
    }
  }
}

struct WeekOverview: View {
  @Binding var selected: Date
  @ObservedObject var store: PlannerStore
  private var days: [Date] { calendarWeekDays(containing: selected) }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Button { move(-7) } label: { Label("前週", systemImage: "chevron.left") }.accessibilityIdentifier("calendar.previousWeek")
        Spacer(); Text(days.first.map(dateString) ?? "").font(.caption); Spacer()
        Button { move(7) } label: { Label("翌週", systemImage: "chevron.right") }.accessibilityIdentifier("calendar.nextWeek")
      }
      ForEach(days, id: \.self) { day in
        let date = dateString(day)
        VStack(alignment: .leading, spacing: 6) {
          Button { selected = day } label: { Text(date + "（" + weekdays[plannerCalendar.component(.weekday, from: day) - 1] + "）").font(.subheadline.bold()) }
          let events = store.snapshot.events.filter { dateOnly($0.date) == date }
          let tasks = store.snapshot.tasks.filter { $0.dueDate == date }
          if events.isEmpty && tasks.isEmpty { Text("予定・提出期限なし").font(.caption).foregroundStyle(.secondary) }
          ForEach(events) { event in Label(event.title, systemImage: "calendar").foregroundStyle(themeColor(event.colorTheme)).font(.caption) }
          ForEach(tasks.sorted(by: taskDueOrder)) { task in HStack { Label("提出", systemImage: "flag.fill").foregroundStyle(.orange); Text(task.task_name).foregroundStyle(themeColor(task.colorTheme)) }.font(.caption) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(8).background(date == dateString(selected) ? Color.teal.opacity(0.12) : Color.secondary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
      }
    }.accessibilityIdentifier("calendar.week")
  }
  private func move(_ days: Int) { selected = plannerCalendar.date(byAdding: .day, value: days, to: selected) ?? selected }
}
