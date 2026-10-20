import SwiftUI

enum LectureDetailTab: String, CaseIterable {
  case lecture = "講義情報"
  case grades = "成績情報"
}

struct LectureDetail: View {
  @ObservedObject var store: PlannerStore
  var lectureID: String
  @State private var tab: LectureDetailTab = requestedReviewScreen() == "grades" ? .grades : .lecture
  @State private var editing = false
  @State private var editingAssessment = false
  @State private var reviewingSuggestion = false
  @State private var deleting = false
  @State private var chat = false

  private var lecture: Lecture? { store.snapshot.lectures.first { $0.id == lectureID } }
  var body: some View {
    Group {
      if let lecture = lecture {
        VStack(spacing: 0) {
          VStack(alignment: .leading, spacing: 4) {
            Text(lecture.lecture_name).font(.title3.bold()).lineLimit(2)
            Text(lecture.instructor).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal).padding(.top, 8)
          LearningLinks(lecture: lecture).padding(.horizontal)
          Picker("詳細の表示", selection: $tab) {
            ForEach(LectureDetailTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented).padding(.horizontal).padding(.vertical, 8)
          .accessibilityIdentifier("lecture.tabs")
          PlannerList {
            if tab == .lecture {
              Section { Button("この講義のチャット") { chat = true }.accessibilityIdentifier("lecture.chat") }
              LectureIdentitySection(lecture: lecture, schedules: schedules(for: lecture))
              overview(lecture)
              PromotionFooter(entries: store.snapshot.campus.entries)
            } else {
              AssessmentCriteriaSection(lecture: lecture) { editingAssessment = true }
              GradeHistorySection(store: store, lecture: lecture)
            }
          }
          .listStyle(.insetGrouped)
        }
        .navigationTitle("授業詳細").navigationBarTitleDisplayMode(.inline)
        .toolbar { Button("編集") { editing = true }.accessibilityIdentifier("lecture.edit") }
        .onAppear { store.action("campusOpen") }
        .sheet(isPresented: $chat) { DepartmentChatSheet(store: store, lecture: lecture) }
        .sheet(isPresented: $editing) { LectureEditor(store: store, initial: lecture, isNew: false) }
        .sheet(isPresented: $editingAssessment) { AssessmentEditor(store: store, lecture: lecture) }
        .sheet(isPresented: $reviewingSuggestion) { TemplateSuggestionReview(store: store, lectureID: lecture.id) }
        .confirmationDialog(lecture.schedule_is_shared && store.snapshot.account != "端末内のゲスト" ? "この講義の登録と全ての共有時限を自分の時間割から削除しますか？共有講義や他の利用者の登録は変更しません。" : "この時限の講義を削除しますか？", isPresented: $deleting, titleVisibility: .visible) {
          Button("削除", role: .destructive) { store.action("deleteLecture", ["id": lecture.id]) }
        }
      } else {
        EmptyState(title: "講義がありません", symbol: "calendar", detail: "時間割に戻ってください。")
      }
    }
  }

  @ViewBuilder private func overview(_ lecture: Lecture) -> some View {
    RelatedLectureTasks(store: store, lecture: lecture)
    AttendanceSection(store: store, lecture: lecture)
    Section("講義内容") {
      Text(nonempty(lecture.lecture_details) ?? "講義内容は未登録です。")
        .foregroundStyle(nonempty(lecture.lecture_details) == nil ? Color.secondary : Color.primary)
        .textSelection(.enabled)
    }
    Section("メモ・持ち物") {
      detailText("講義メモ", value: lecture.memo, empty: "メモはありません。")
      detailText("持ち物", value: lecture.belongings, empty: "持ち物は未登録です。")
    }
    Section("試験・休講") {
      LabeledContent("試験日時", value: nonempty(lecture.test_datetime) ?? "未登録")
      LabeledContent("休講日", value: nonempty(lecture.cancelled_date) ?? "未登録")
    }
    TemplateSuggestionEntry(store: store, lecture: lecture) { reviewingSuggestion = true }
    Section {
      Button("講義を削除", role: .destructive) { deleting = true }
        .disabled(store.snapshot.busy).accessibilityIdentifier("lecture.delete")
    }
  }
  private func schedules(for lecture: Lecture) -> [Lecture] {
    guard lecture.schedule_is_shared, let group = nonempty(lecture.lecture_list_id) else { return [lecture] }
    return store.snapshot.lectures.filter { $0.lecture_list_id == group }
      .sorted { ($0.day_of_the_week, $0.period) < ($1.day_of_the_week, $1.period) }
  }
  private func detailText(_ title: String, value: String?, empty: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.caption).foregroundStyle(.secondary)
      Text(nonempty(value) ?? empty).textSelection(.enabled)
        .foregroundStyle(nonempty(value) == nil ? Color.secondary : Color.primary)
    }.padding(.vertical, 3)
  }
}

private struct LectureIdentitySection: View {
  let lecture: Lecture
  let schedules: [Lecture]
  var body: some View {
    Section {
      VStack(alignment: .leading, spacing: 12) {
        ForEach(schedules) { schedule in
          Label("\(weekdays[min(6, max(0, schedule.day_of_the_week))])曜 \(schedule.period)限" + ((1...5).contains(schedule.period) ? " · \(periodTimes[schedule.period - 1])" : ""), systemImage: "clock")
            .font(.subheadline)
        }
        Label(nonempty(lecture.classroom) ?? "教室未登録", systemImage: "mappin.and.ellipse")
          .font(.subheadline)
      }.padding(.vertical, 4)
      if let id = nonempty(lecture.syllabus_id) {
        LabeledContent("シラバスID", value: id).font(.caption).textSelection(.enabled)
        if let url = syllabusURL(for: lecture) { Link(destination: url) { Label("シラバスを開く", systemImage: "book") } }
        if let url = courseURL(for: lecture, service: .moodle) { Link(destination: url) { Label("Moodleを開く", systemImage: "graduationcap") } }
        if let url = courseURL(for: lecture, service: .elms) { Link(destination: url) { Label("ELMSを開く", systemImage: "globe") } }
      }
    }
    .listRowSeparator(.hidden)
  }
}

private struct AttendanceSection: View {
  @ObservedObject var store: PlannerStore
  let lecture: Lecture
  private var summary: AttendanceSummary { AttendanceSummary(lecture: lecture) }
  var body: some View {
    Section("自分の出欠") {
      HStack {
        Button { setAbsences(max(0, (summary.absences ?? 0) - 1)) } label: { Image(systemName: "minus") }
          .buttonStyle(.bordered).disabled((summary.absences ?? 0) == 0 || store.snapshot.busy)
          .accessibilityLabel("欠席を1回減らす").accessibilityIdentifier("lecture.absence.minus")
        Spacer()
        VStack(spacing: 3) {
          Text(summary.absences.map { "\($0) 回" } ?? "未記録").font(.title2.bold()).monospacedDigit()
          Text("欠席回数").font(.caption).foregroundStyle(.secondary)
        }.foregroundStyle(summary.exceedsLimit ? Color.red : Color.primary)
        Spacer()
        Button { setAbsences((summary.absences ?? 0) + 1) } label: { Image(systemName: "plus") }
          .buttonStyle(.bordered).disabled(!summary.canIncrement || store.snapshot.busy)
          .accessibilityLabel("欠席を1回増やす").accessibilityIdentifier("lecture.absence.plus")
      }.padding(.vertical, 8)
      if summary.absences == nil {
        Button("欠席0回として記録") { setAbsences(0) }.disabled(store.snapshot.busy)
          .accessibilityIdentifier("lecture.absence.recordZero")
        Text("欠席回数は未記録です。0回とは区別して表示しています。")
          .font(.caption).foregroundStyle(.secondary)
      }
      LabeledContent("講義回数", value: summary.total.map { "\($0) 回" } ?? "未登録")
      LabeledContent("必要出席回数", value: summary.required.map { "\($0) 回" } ?? "未登録")
      if summary.hasInvalidCriteria {
        Label("出席条件に矛盾があります。成績情報から評価基準を確認してください。", systemImage: "exclamationmark.triangle")
          .font(.caption).foregroundStyle(.orange)
      } else if let limit = summary.maximumAbsences {
        LabeledContent("登録した条件での欠席上限", value: "\(limit) 回")
        if summary.exceedsLimit {
          Label("登録した欠席上限を超えています。シラバスの条件を確認してください。", systemImage: "exclamationmark.triangle.fill")
            .font(.caption).foregroundStyle(.red)
        } else if let remaining = summary.remainingAbsences {
          Text("登録した条件では、あと\(remaining)回まで欠席できます。実際の出席要件はシラバスを確認してください。")
            .font(.caption).foregroundStyle(.secondary)
        }
      } else {
        Text("講義回数・必要出席回数が未登録のため、欠席上限は計算していません。")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
  }
  private func setAbsences(_ count: Int) { store.action("absence", ["id": lecture.id, "count": String(count)]) }
}

private struct RelatedLectureTasks: View {
  @ObservedObject var store: PlannerStore
  let lecture: Lecture
  private var related: [PlannerTask] { tasksRelated(to: lecture, in: store.snapshot.tasks) }
  var body: some View {
    Section("関連する課題") {
      if related.isEmpty { Text("関連課題はありません。").foregroundStyle(.secondary) }
      else {
        let open = related.filter { !$0.isCompleted }
        let completed = related.filter(\.isCompleted)
        if open.isEmpty { Text("未完了の課題はありません。").foregroundStyle(.secondary) }
        ForEach(open) { task in NavigationLink { TaskDetail(store: store, taskID: task.id) } label: { TaskRow(task: task) } }
        if !completed.isEmpty {
          DisclosureGroup("完了済み \(completed.count)件") {
            ForEach(completed) { task in NavigationLink { TaskDetail(store: store, taskID: task.id) } label: { TaskRow(task: task) } }
          }
        }
      }
    }
  }
}

private struct AssessmentCriteriaSection: View {
  let lecture: Lecture
  var edit: () -> Void
  private var summary: AssessmentSummary { AssessmentSummary(lecture: lecture) }
  var body: some View {
    Section {
      if summary.hasWeights && summary.isValid { AssessmentWeightBar(summary: summary) }
      ForEach(summary.weights) { weight in
        LabeledContent(weight.title, value: weight.percentage.map { "\($0)%" } ?? "未登録")
          .accessibilityIdentifier("assessment.\(weight.id)")
      }
      if summary.hasWeights {
        LabeledContent("入力済みの割合の合計", value: summary.knownTotal.formatted(.number.precision(.fractionLength(0))) + "%")
        if !summary.isValid {
          Label("割合は0〜100%で、合計100%以内になるよう確認してください。", systemImage: "exclamationmark.triangle")
            .font(.caption).foregroundStyle(.orange)
        } else if summary.hasMissingWeights || (summary.unallocated ?? 0) > 0 {
          Text("未登録の項目と残りの割合は不明です。「その他」の評価方法としては扱っていません。")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      LabeledContent("講義回数", value: lecture.grading_attendance_total.map { "\($0) 回" } ?? "未登録")
      LabeledContent("必要出席回数", value: lecture.grading_attendance_required.map { "\($0) 回" } ?? "未登録")
      if let note = summary.memo ?? summary.criteria {
        VStack(alignment: .leading, spacing: 5) {
          Text("自分の評価基準・メモ").font(.caption).foregroundStyle(.secondary)
          Text(note).textSelection(.enabled)
        }
      }
      if !summary.hasWeights && summary.criteria == nil && summary.memo == nil {
        Text("評価の割合・メモは未登録です。シラバスを確認して入力するか、共有テンプレートの候補を確認できます。")
          .font(.caption).foregroundStyle(.secondary)
      }
      Button("評価基準を編集", action: edit).accessibilityIdentifier("assessment.edit")
    } header: { Text("評価基準") }
  }
}

private struct AssessmentWeightBar: View {
  let summary: AssessmentSummary
  private func color(_ id: String) -> Color { id == "report" ? .blue : (id == "test" ? .orange : .teal) }
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      GeometryReader { geometry in
        HStack(spacing: 0) {
          ForEach(summary.weights) { weight in
            if let percent = weight.percentage, percent > 0 {
              color(weight.id).frame(width: geometry.size.width * CGFloat(percent) / 100)
            }
          }
          if let unallocated = summary.unallocated, unallocated > 0 {
            Color.secondary.opacity(0.16).frame(width: geometry.size.width * CGFloat(unallocated) / 100)
          }
        }.clipShape(RoundedRectangle(cornerRadius: 6))
      }.frame(height: 20).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 5) {
        ForEach(summary.weights) { weight in
          if let percentage = weight.percentage {
            Label { Text("\(weight.title) \(percentage)%") } icon: { Circle().fill(color(weight.id)).frame(width: 8, height: 8) }
          }
        }
        if let unallocated = summary.unallocated, unallocated > 0 {
          Label("未設定の割合 \(unallocated.formatted(.number.precision(.fractionLength(0))))%", systemImage: "circle.dashed").foregroundStyle(.secondary)
        }
      }.font(.caption)
    }.padding(.vertical, 5)
  }
}

private struct AssessmentEditor: View {
  @ObservedObject var store: PlannerStore
  let lectureID: String
  @State private var draft: AssessmentDraft
  @Environment(\.dismiss) private var dismiss
  init(store: PlannerStore, lecture: Lecture) {
    self.store = store; lectureID = lecture.id; _draft = State(initialValue: AssessmentDraft(lecture: lecture))
  }
  private var current: Lecture? { store.snapshot.lectures.first { $0.id == lectureID } }
  var body: some View {
    NavigationStack {
      PlannerForm {
        Section {
          Text("空欄は未登録、0は登録済みの値として保存します。自分の登録の評価基準を変更します。")
            .font(.caption).foregroundStyle(.secondary)
        }
        Section("評価の割合") {
          numberField("レポート %", value: $draft.report, id: "assessment.input.report")
          numberField("試験 %", value: $draft.test, id: "assessment.input.test")
          numberField("小テスト %", value: $draft.quiz, id: "assessment.input.quiz")
        }
        Section("出席条件") {
          numberField("講義回数", value: $draft.total, id: "assessment.input.total")
          numberField("必要出席回数", value: $draft.required, id: "assessment.input.required")
        }
        Section("評価基準・メモ") {
          TextField("自分の評価基準・メモ", text: $draft.memo, axis: .vertical).lineLimit(3...8)
          Text("Web版の評価メモと同じ項目に保存します。講義情報タブの講義メモとは別の項目です。")
            .font(.caption).foregroundStyle(.secondary)
        }
        if let error = draft.validationMessage { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).accessibilityIdentifier("assessment.validation") } }
      }
      .navigationTitle("評価基準を編集").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") {
            guard let current = current, draft.validationMessage == nil else { return }
            store.action("saveLecture", draft.applying(to: current)); dismiss()
          }.disabled(current == nil || draft.validationMessage != nil || store.snapshot.busy)
            .accessibilityIdentifier("assessment.save")
        }
      }
    }
  }
  private func numberField(_ title: String, value: Binding<String>, id: String) -> some View {
    HStack { Text(title); Spacer(); TextField("未登録", text: value).multilineTextAlignment(.trailing).keyboardType(.numberPad).frame(minWidth: 70).accessibilityLabel(title).accessibilityIdentifier(id) }
  }
}

private struct TemplateSuggestionEntry: View {
  @ObservedObject var store: PlannerStore
  let lecture: Lecture
  var review: () -> Void
  private var state: TemplateSuggestionState? { store.snapshot.templateSuggestions[lecture.id] }
  var body: some View {
    Section("共有テンプレートからの提案") {
      Label("未入力の項目を、同じ講義の共有情報から確認できます。", systemImage: "text.badge.plus")
        .font(.subheadline)
      Text("内容を確認して選択した項目だけ反映します。登録済みの値や自分のメモは保持します。")
        .font(.caption).foregroundStyle(.secondary)
      if nonempty(lecture.lecture_list_id) == nil {
        Text("共有講義との紐付けがないため、この講義の候補は取得できません。講義名だけでテンプレートを適用することはありません。")
          .font(.caption).foregroundStyle(.secondary)
      } else {
        if let proposal = state?.proposal {
          Text("確認できる候補 \(proposal.fields.filter { $0.canApply(to: lecture) }.count)項目").font(.caption).foregroundStyle(.secondary)
        }
        Button("候補を確認", action: review)
          .disabled(!store.snapshot.configured && state?.proposal == nil)
          .accessibilityIdentifier("suggestion.review")
        if !store.snapshot.configured && state?.proposal == nil { Text("候補の取得にはクラウド接続が必要です。").font(.caption).foregroundStyle(.secondary) }
      }
    }
  }
}

struct TemplateSuggestionReview: View {
  @ObservedObject var store: PlannerStore
  let lectureID: String
  @Environment(\.dismiss) private var dismiss
  @State private var selectedKeys = Set<String>()
  @State private var requested = false
  @State private var confirming = false
  private var lecture: Lecture? { store.snapshot.lectures.first { $0.id == lectureID } }
  private var state: TemplateSuggestionState? { store.snapshot.templateSuggestions[lectureID] }
  private var proposal: TemplateProposal? { state?.proposal }
  private var selectedFields: [TemplateProposalField] {
    guard let lecture = lecture else { return [] }
    return proposal?.fields.filter { selectedKeys.contains($0.key) && $0.canApply(to: lecture) } ?? []
  }
  var body: some View {
    NavigationStack {
      PlannerList {
        Section {
          Text("共有テンプレートは利用者の登録情報です。正確さや今年度の評価方法を保証するものではありません。シラバスと照らし合わせてください。")
            .font(.caption).foregroundStyle(.secondary)
          Text("反映する項目を1つずつ選んでください。選択するだけでは保存されません。")
            .font(.subheadline)
        }
        if state?.status == "loading" { Section { ProgressView("候補を読み込み中…") } }
        if let error = nonempty(state?.error) { Section { Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) } }
        if let proposal = proposal, let lecture = lecture {
          proposalContents(proposal, lecture: lecture)
        } else if state?.status == "empty" {
          Section { Text("この講義に一致する共有テンプレートの候補はありません。").foregroundStyle(.secondary) }
        } else if state?.status != "loading" && state?.error == nil {
          Section { Text("候補はまだ取得していません。").foregroundStyle(.secondary) }
        }
        Section {
          Button("候補を再読み込み") { load() }
            .disabled(!store.snapshot.configured || store.snapshot.busy)
            .accessibilityIdentifier("suggestion.reload")
          if let fetchedAt = detailTimestamp(state?.fetchedAt) { Text("取得日時: \(fetchedAt.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
        }
      }
      .navigationTitle("提案を確認").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } }
      .safeAreaInset(edge: .bottom) {
        Button("選択した\(selectedFields.count)項目を反映") { confirming = true }
          .buttonStyle(.borderedProminent).frame(maxWidth: .infinity).padding()
          .background(.regularMaterial)
          .disabled(selectedFields.isEmpty || store.snapshot.busy || state?.status == "loading")
          .accessibilityIdentifier("suggestion.apply")
      }
      .confirmationDialog("選択した\(selectedFields.count)項目を自分の講義に保存しますか？共有テンプレートへの投稿は行いません。", isPresented: $confirming, titleVisibility: .visible) {
        Button("選択した項目を保存") {
          guard let proposal = proposal, !selectedFields.isEmpty else { return }
          store.action("applySuggestion", ApplyTemplateProposal(id: lectureID, proposalId: proposal.id, fields: selectedFields.map(\.key)))
          selectedKeys = []
        }
      }
      .onAppear { if state == nil && !requested && store.snapshot.configured { load() } }
      .onChange(of: proposal?.id) { _ in selectedKeys = [] }
    }
  }
  @ViewBuilder private func proposalContents(_ proposal: TemplateProposal, lecture: Lecture) -> some View {
    Section("候補の出典") {
      Text(proposal.sourceLabel).font(.subheadline)
      if let warning = nonempty(proposal.warning) { Text(warning).font(.caption).foregroundStyle(.secondary) }
      if state?.source == "cache" || state?.stale == true {
        Label("保存済みの候補です。現在の共有情報とは異なる場合があります。", systemImage: "internaldrive")
          .font(.caption).foregroundStyle(.orange)
      }
      Text("テンプレート作成日は授業の開講年度を示すものではありません。")
        .font(.caption).foregroundStyle(.secondary)
    }
    Section("項目ごとに確認") {
      ForEach(proposal.fields) { field in
        VStack(alignment: .leading, spacing: 8) {
          Toggle(isOn: Binding(get: { selectedKeys.contains(field.key) && field.canApply(to: lecture) }, set: { enabled in if enabled { selectedKeys.insert(field.key) } else { selectedKeys.remove(field.key) } })) {
            Text(field.label).font(.headline)
          }
          .disabled(!field.canApply(to: lecture) || store.snapshot.busy)
          .accessibilityIdentifier("suggestion.field.\(field.key)")
          Text(field.displayValue).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
          if !field.canApply(to: lecture) {
            Label("登録済みの内容を保持します。この項目は反映できません。", systemImage: "lock")
              .font(.caption).foregroundStyle(.secondary)
          }
          if let current = field.currentValue { Text("取得時の登録値: \(current.displayValue)").font(.caption).foregroundStyle(.secondary) }
          if let date = detailTimestamp(field.sourceCreatedAt) {
            Text("テンプレート作成日: \(date.formatted(date: .abbreviated, time: .omitted))").font(.caption).foregroundStyle(.secondary)
          } else { Text("テンプレート作成日: 未記録").font(.caption).foregroundStyle(.secondary) }
          if field.conflictCount > 0 {
            Label("異なる値の候補が\(field.conflictCount)件あります。内容を確認してください。", systemImage: "exclamationmark.triangle")
              .font(.caption).foregroundStyle(.orange)
          }
        }.padding(.vertical, 5)
      }
      if proposal.fields.isEmpty { Text("提案できる項目はありません。").foregroundStyle(.secondary) }
    }
  }
  private func load() { requested = true; selectedKeys = []; store.action("suggestion", ["id": lectureID]) }
}


// Rejected selected-field proposals remain read-only backups. They never enter
// LectureEditor and never replay their full-object recovery data.
struct SelectedLectureFieldsRecovery: View {
  @ObservedObject var store: PlannerStore
  let draft: SelectedLectureFieldsDraft
  let draftID: String
  @Environment(\.dismiss) private var dismiss
  @State private var waitingForReload = false
  @State private var requestedID: String?
  @State private var reloadFailure: String?
  @State private var reviewing = false
  @State private var confirmingCancellation = false
  private var lecture: Lecture? { store.snapshot.lectures.first { $0.id == draft.id } }
  var body: some View {
    NavigationStack {
      PlannerList {
        Section {
          Text("選択した項目の保存は、更新済みの値との競合などで完了しませんでした。下の内容は確認用のバックアップです。")
          Text("講義全体の編集には戻しません。無関係なメモ・欠席回数などを再送せず、現在の候補を取得して空欄の項目だけ選び直します。")
            .font(.caption).foregroundStyle(.secondary)
        }
        Section("保存できなかった選択項目") {
          ForEach(draft.fields) { field in
            VStack(alignment: .leading, spacing: 6) {
              Text(field.label).font(.caption).foregroundStyle(.secondary)
              Text(field.displayValue).textSelection(.enabled)
            }
          }
          if draft.fields.isEmpty { Text("選択項目の値はありません。元データはJSONバックアップで確認できます。").foregroundStyle(.secondary) }
        }
        Section {
          if let lecture = lecture {
            Text(lecture.lecture_name).font(.headline)
            Button("現在の候補を取得して選び直す") {
              guard store.snapshot.lectures.contains(where: { $0.id == draft.id }) else { return }
              let requestID = UUID().uuidString
              requestedID = requestID
              reloadFailure = nil
              waitingForReload = true
              store.action("suggestion", ["id": draft.id, "requestId": requestID])
            }
            .disabled(!store.snapshot.configured || store.snapshot.busy || waitingForReload)
            .accessibilityIdentifier("suggestion.recovery.review")
            if waitingForReload { ProgressView("現在の候補を確認中…") }
            if let error = reloadFailure {
              Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
            }
            if !store.snapshot.configured { Text("現在の候補の確認にはクラウド接続が必要です。").font(.caption).foregroundStyle(.secondary) }
          } else {
            Text("対象の講義が現在の時間割に見つかりません。この内容から講義の作成・再保存は行いません。元の編集は保持しているので、設定のJSONバックアップで確認できます。")
              .font(.caption).foregroundStyle(.secondary)
              .accessibilityIdentifier("suggestion.recovery.missingLecture")
          }
        }
        Section {
          Button("この未同期の提案を取り消す", role: .destructive) { confirmingCancellation = true }
            .disabled(draftID.isEmpty || store.snapshot.busy || waitingForReload)
            .accessibilityIdentifier("suggestion.recovery.cancel")
          Text("この提案に一致する未同期の操作だけを取り消します。後から行った編集・操作と、この確認用のバックアップは保持します。サーバーの現在の値は次の同期で確認します。")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      .navigationTitle("保存できなかった提案").navigationBarTitleDisplayMode(.inline)
      .toolbar { Button("閉じる") { dismiss() } }
      .sheet(isPresented: $reviewing) { TemplateSuggestionReview(store: store, lectureID: draft.id) }
      .confirmationDialog("この未同期の提案を取り消しますか？", isPresented: $confirmingCancellation, titleVisibility: .visible) {
        Button("未同期の提案を取り消す", role: .destructive) {
          guard !draftID.isEmpty, !store.snapshot.busy else { return }
          store.action("cancelLectureFields", ["draftId": draftID])
        }
      } message: {
        Text("選択した提案に一致する操作だけを同期待ちから外します。後から行った編集・操作と、このバックアップは残ります。サーバーへ書き込まず、既に保存済みの内容も元に戻しません。現在の値は次の同期で確認します。")
      }
      .onChange(of: store.snapshot.revision) { _ in
        guard waitingForReload else { return }
        guard lecture != nil else { waitingForReload = false; requestedID = nil; return }
        // A terminal reply must echo this exact explicit request. This remains
        // safe when SwiftUI coalesces loading and terminal snapshots.
        guard let requestID = requestedID,
              let lookup = store.snapshot.templateSuggestions[draft.id],
              lookup.requestId == requestID, lookup.status != "loading" else { return }
        waitingForReload = false
        requestedID = nil
        if lookup.status == "error" && lookup.proposal == nil {
          reloadFailure = lookup.error ?? "現在の候補を取得できませんでした。元の編集は保持しています。"
        } else if ["ready", "empty", "error"].contains(lookup.status) {
          reviewing = true
        } else {
          reloadFailure = "候補の更新を確認できませんでした。元の編集は保持しています。再試行してください。"
        }
      }
    }
  }
}
