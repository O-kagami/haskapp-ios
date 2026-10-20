import SwiftUI

struct SettingsScreen: View {
  @ObservedObject var store: PlannerStore
  @State private var profile = Profile()
  @State private var profileBaseline = Profile()
  @State private var profileLoaded = false
  @State private var official = false
  @State private var campus = requestedReviewScreen() == "campus"
  @State private var chat = false
  @State private var setup = false
  @State private var drafts = false
  @State private var login = false
  @State private var tutorial = false
  @State private var sharing = false
  @State private var exporting = false
  @State private var guestConfirm = false
  @State private var migrateConfirm = false
  private var legacyPersonal: [Lecture] { store.snapshot.lectures.filter { $0.lecture_list_id == nil && !$0.personal_entry } }
  var body: some View {
    NavigationStack {
      PlannerForm {
        Section("アカウント") {
          if !store.snapshot.displayName.isEmpty {
            HStack {
              if let url = URL(string: store.snapshot.avatarURL) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Image(systemName: "person.crop.circle") }
                  .frame(width: 40, height: 40).clipShape(Circle())
              }
              Text(store.snapshot.displayName).font(.headline)
            }
          }
          LabeledContent("利用者", value: store.snapshot.account)
            .accessibilityElement(children: .combine).accessibilityIdentifier("account.identity")
          LabeledContent("保存状態", value: store.snapshot.connection)
          if store.snapshot.account == "端末内のゲスト" {
            Button("Googleでログイン") { store.action("googleLogin") }.disabled(!store.snapshot.configured || store.snapshot.busy)
            Button("メールでログイン") { login = true }.disabled(!store.snapshot.configured || store.snapshot.busy)
            AuthTermsNotice()
          } else {
            Button("ログアウト", role: .destructive) { store.action("logout") }.disabled(store.snapshot.busy)
            Button("ゲストで利用する") { guestConfirm = true }.disabled(store.snapshot.busy)
          }
          if store.snapshot.account == "端末内のゲスト" { Text("アカウント不要で利用中です。ゲストのデータはこの端末に保存され、ログイン先へ自動移行しません。").font(.caption).foregroundStyle(.secondary) }
          Button("再接続・再読み込み") { store.action("refresh") }.disabled(store.snapshot.busy)
        }
        Section("所属・初期設定") {
          Picker("学部", selection: Binding(get: { profile.department }, set: { value in
            if value != profile.department { profile.department = value; profile.major = "" }
          })) {
            Text("未選択").tag("")
            ForEach(store.snapshot.affiliations) { option in Text(option.faculty).tag(option.faculty) }
            if !profile.department.isEmpty && !store.snapshot.affiliations.contains(where: { $0.faculty == profile.department }) {
              Text("保存済み: \(profile.department)").tag(profile.department).disabled(true)
            }
          }.accessibilityIdentifier("profile.faculty")
          Picker("学科・コース", selection: $profile.major) {
            Text("未選択").tag("")
            ForEach(majorChoices, id: \.self) { Text($0).tag($0) }
            if !profile.major.isEmpty && !majorChoices.contains(profile.major) {
              Text("保存済み（旧表記）: \(profile.major)").tag(profile.major).disabled(true)
            }
          }.disabled(profile.department.isEmpty).accessibilityIdentifier("profile.major")
          Picker("学年", selection: $profile.studentYear) { Text("未設定").tag(0); ForEach(1...4, id: \.self) { Text("\($0)年").tag($0) } }.accessibilityIdentifier("profile.year")
          if profile.studentYear == 2 { Picker("クラス", selection: $profile.classGroup) { Text("未設定").tag(""); ForEach(["A", "B", "C"], id: \.self) { Text($0 + "クラス").tag($0) } } }
          Text("学年・クラスと公式科目の選択は、ログインすると本人専用のクラウドに同期できます。ゲストでは端末内に保存します。").font(.caption).foregroundStyle(.secondary)
          Text("Webと共通の正式な所属を表示しています。未掲載の所属は未選択のまま利用できます。").font(.caption).foregroundStyle(.secondary)
          Button("所属・学年から公式授業を一括追加") { official = true }.accessibilityIdentifier("profile.official.bulk")
          Button("利用者の共有テンプレートを探す") { store.action("templates", profile); setup = true }
            .disabled(store.snapshot.busy || profile.department.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || profile.major.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          Button("共有テンプレートの項目を確認") { sharing = true }
          Text(profile.shareTemplates ? "共有への同意: 有効" : "共有への同意: 未同意").font(.caption)
        }
        Section("公式テンプレート・学科チャット") {
          Button("サークル・キャンパス情報") { campus = true }.accessibilityIdentifier("campus.open")
          Button("大学公式の時間割テンプレート") { official = true }.accessibilityIdentifier("official.open")
          Button("同じ学科の人と話す") { chat = true }.accessibilityIdentifier("chat.open")
        }
        Section("iCalendar連携") {
          TextField("https://… のiCal URL", text: $profile.icalUrl).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
          OptionalDateField(title: "iCal有効期限", value: $profile.icalExpiry)
          Button("iCalから課題を読み込む") { store.action("importIcal", profile) }.disabled(profile.icalUrl.isEmpty || store.snapshot.busy)
          Text("Webと同じiCal設定を利用。インポートはUIDと日付で重複を防ぎます。定期予定の展開は未対応です。").font(.caption).foregroundStyle(.secondary)
        }
        Section { Button("設定を保存") { store.action("profile", profile) }.disabled(store.snapshot.busy) }
        Section("データ") {
          if store.snapshot.pendingCount > 0 {
            Button("未同期変更を送信（\(store.snapshot.pendingCount)件）") { store.action("syncPending") }.disabled(store.snapshot.busy)
          }
          Button("保存待ちの編集（\(store.snapshot.drafts.count)件）") { drafts = true }
          if store.snapshot.account != "端末内のゲスト" && !legacyPersonal.isEmpty {
            Button("既存の端末内個人講義を同期（\(legacyPersonal.count)件）") { migrateConfirm = true }
              .disabled(store.snapshot.busy).accessibilityIdentifier("private.migrate")
          }
          Button("JSONバックアップを書き出す") { exporting = true }
          Text("学年・クラス・個人講義・公式科目の選択は本人専用に同期します。予定と持ち物などの追加情報は端末内保存です。共有講義・課題・iCalは従来の保存先を利用します。").font(.caption).foregroundStyle(.secondary)
        }
        Section("接続設定") {
          Text(store.snapshot.configured ? "Supabaseの公開接続設定を読み込みました。接続・同期状態は上の保存状態で確認してください。" : "クラウド未設定。mobile/.env.localにWebの実環境と同じ公開URL・publishable keyを設定して再ビルドしてください。").font(.subheadline)
          Text("未接続の端末データを別アカウントへ自動移行しません。成績・出欠のサンプル値は生成しません。").font(.caption).foregroundStyle(.secondary)
        }
        Section("Haskapp for iOS") {
          Button("チュートリアルを開く") { tutorial = true }.accessibilityIdentifier("tutorial.open")
          Text("ビルド: " + (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "不明"))
          Text("Expo + Swift + SwiftUI")
          Text("北大生の時間割・課題・予定管理").foregroundStyle(.secondary)
        }
      }
      .sheet(isPresented: $campus) { CampusScreen(store: store) }
      .sheet(isPresented: $tutorial) { PlannerTutorial(store: store, onClose: { tutorial = false }) }
      .sheet(isPresented: $sharing) { TemplateSharingConsent(store: store, consent: $profile.shareTemplates) }
      .navigationTitle("設定").navigationBarTitleDisplayMode(.inline)
      .confirmationDialog("\(legacyPersonal.count)件の個人講義を現在ログイン中の本人専用保存先へ送ります。ゲストや他のアカウントのデータは移しません。先にJSONバックアップを保存してください。", isPresented: $migrateConfirm, titleVisibility: .visible) {
        Button("本人専用の保存先に同期") { store.action("migratePersonal") }
      }
      .onAppear {
        if !profileLoaded { resetProfile() }
      }
      .onChange(of: store.snapshot.account) { _ in resetProfile() }
      .onChange(of: store.snapshot.profile) { incoming in
        // A refresh or unrelated save must not erase an in-progress settings edit.
        if !profileLoaded || profile == profileBaseline { profile = incoming }
        profileBaseline = incoming
        profileLoaded = true
      }
      .confirmationDialog("ログアウトしてゲストで利用しますか？", isPresented: $guestConfirm, titleVisibility: .visible) {
        Button("ゲストで利用する") {
        let arguments = ProcessInfo.processInfo.arguments
        let namespace = arguments.firstIndex(of: "-haskapp-ui-test-namespace").flatMap { index in arguments.indices.contains(index + 1) ? arguments[index + 1] : nil } ?? "normal"
        UserDefaults.standard.set(true, forKey: "haskapp.guest-selected." + namespace)
        store.action("logout")
      }
      } message: { Text("ログイン中のデータとゲストの端末データは分けて保持します。自動コピーや削除は行いません。") }
      .sheet(isPresented: $drafts) { DraftsSheet(store: store) }
      .sheet(isPresented: $login) { LoginSheet(store: store) }
      .sheet(isPresented: $official) { OfficialTemplatesSheet(store: store, initialProfile: profile) }
      .sheet(isPresented: $chat) { DepartmentChatSheet(store: store) }
      .sheet(isPresented: $setup) { SetupSheet(store: store) }
      .sheet(isPresented: $exporting) {
        NavigationStack {
          ScrollView { Text(backup).font(.caption.monospaced()).textSelection(.enabled).padding() }
            .navigationTitle("バックアップ")
            .toolbar { ShareLink(item: backup); Button("完了") { exporting = false } }
        }
      }
    }
  }
  private var majorChoices: [String] { store.snapshot.affiliations.first(where: { $0.faculty == profile.department })?.majors ?? [] }
  private func resetProfile() {
    profile = store.snapshot.profile
    profileBaseline = store.snapshot.profile
    profileLoaded = true
  }
  private var backup: String {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return String(data: (try? encoder.encode(store.snapshot)) ?? Data(), encoding: .utf8) ?? ""
  }
}

struct AuthTermsNotice: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("続行すると、利用規約とプライバシーポリシーに同意したものとみなされます。")
        .font(.caption).foregroundStyle(.secondary)
      HStack {
        Link("利用規約", destination: URL(string: "https://haskapp.foo/terms")!)
        Link("プライバシーポリシー", destination: URL(string: "https://haskapp.foo/privacy")!)
      }.font(.caption)
    }
  }
}

struct LoginSheet: View {
  @ObservedObject var store: PlannerStore
  @State private var email = ""
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      PlannerForm {
        Section {
          TextField("メール", text: $email)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .keyboardType(.emailAddress).textContentType(.emailAddress)
          Text("Web版と同じメールのログインリンクを利用します。この端末でメールのリンクを開いてログインしてください。")
            .font(.caption).foregroundStyle(.secondary)
        }
        Section { AuthTermsNotice() }
        Section {
          Button("ログインリンクを送信") {
            store.action("magicLink", ["email": email.trimmingCharacters(in: .whitespacesAndNewlines)])
            dismiss()
          }.disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.snapshot.configured || store.snapshot.busy)
        }
      }.navigationTitle("メールでログイン").toolbar { Button("キャンセル") { dismiss() } }
    }
  }
}

struct SetupSheet: View {
  @ObservedObject var store: PlannerStore
  @State private var selected = Set<String>()
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      PlannerList {
        Section {
          Text("登録する講義を選択してください。既存の時間割は保持します。").foregroundStyle(.secondary)
          if store.snapshot.account != "端末内のゲスト" {
            Text("ログイン中は講義単位で登録します。1つ選ぶと、同じ講義の全ての共有時限が対象になります。")
              .font(.caption).foregroundStyle(.secondary)
          }
        }
        if store.snapshot.busy { ProgressView("テンプレートを確認中…") }
        else if store.snapshot.templates.isEmpty { EmptyState(title: "テンプレートがありません", symbol: "list.bullet.rectangle", detail: "所属を確認し、接続後に検索してください。手動登録も利用できます。") }
        ForEach(store.snapshot.templates) { lecture in
          Button {
            toggle(lecture)
          } label: {
            HStack { LectureRow(lecture: lecture); Image(systemName: selected.contains(lecture.id) ? "checkmark.circle.fill" : "circle") }
          }.disabled(store.snapshot.busy)
        }
      }
      .navigationTitle("時間割の初期設定")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("登録") { store.action("setup", Array(selected).sorted()); dismiss() }.disabled(selected.isEmpty || store.snapshot.busy)
        }
      }
    }
  }
  private func toggle(_ lecture: Lecture) {
    let ids: Set<String>
    if store.snapshot.account != "端末内のゲスト", let group = lecture.lecture_list_id {
      ids = Set(store.snapshot.templates.filter { $0.lecture_list_id == group }.map { $0.id })
    } else { ids = [lecture.id] }
    if ids.isSubset(of: selected) { selected.subtract(ids) } else { selected.formUnion(ids) }
  }
}

struct DraftsSheet: View {
  @ObservedObject var store: PlannerStore
  @Environment(\.dismiss) private var dismiss
  @State private var selectedFieldsDraft: SelectedLectureFieldsDraft?
  @State private var selectedFieldsDraftID = ""
  @State private var lecture: Lecture?
  @State private var task: PlannerTask?
  @State private var event: PlannerEvent?
  @State private var decodingError = false
  var body: some View {
    NavigationStack {
      PlannerList {
        if store.snapshot.drafts.isEmpty { Text("保存待ちの編集はありません").foregroundStyle(.secondary) }
        ForEach(store.snapshot.drafts) { draft in
          Button { open(draft) } label: { Label(draft.title, systemImage: "square.and.pencil") }
        }.onDelete { indices in
          let drafts = store.snapshot.drafts
          for index in indices { store.action("discardDraft", ["id": drafts[index].id]) }
        }
      }
      .navigationTitle("保存待ちの編集")
      .toolbar { Button("完了") { dismiss() } }
      .sheet(item: $selectedFieldsDraft) { item in SelectedLectureFieldsRecovery(store: store, draft: item, draftID: selectedFieldsDraftID) }
      .sheet(item: $lecture) { item in LectureEditor(store: store, initial: item, isNew: !store.snapshot.lectures.contains(where: { $0.id == item.id })) }
      .sheet(item: $task) { item in TaskEditor(store: store, initial: item, isNew: !store.snapshot.tasks.contains(where: { $0.id == item.id })) }
      .sheet(item: $event) { item in EventEditor(store: store, initial: item, isNew: !store.snapshot.events.contains(where: { $0.id == item.id })) }
      .alert("編集を開けません", isPresented: $decodingError) { Button("OK", role: .cancel) {} } message: {
        Text("データの形式を読み取れませんでした。元の編集は削除していません。設定のJSONバックアップで内容を確認できます。")
      }
    }
  }
  private func open(_ draft: Draft) {
    guard let data = draft.json.data(using: .utf8) else { decodingError = true; return }
    do {
      if draft.type == "saveLectureFields" {
        let selected = try JSONDecoder().decode(SelectedLectureFieldsDraft.self, from: data)
        selectedFieldsDraftID = draft.id
        selectedFieldsDraft = selected
      }
      else if draft.type.contains("Lecture") { lecture = try JSONDecoder().decode(Lecture.self, from: data) }
      else if draft.type.contains("Task") { task = try JSONDecoder().decode(PlannerTask.self, from: data) }
      else if draft.type.contains("Event") { event = try JSONDecoder().decode(PlannerEvent.self, from: data) }
      else { decodingError = true }
    } catch { decodingError = true }
  }
}

struct CampusScreen: View {
  @ObservedObject var store: PlannerStore
  @State private var activity: ClubActivity?
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      PlannerList {
        Section("自分のサークル") {
          Text("サークルは時限を持たない講義として扱います。時間割には配置せず、予定や課題を関連付けられます。登録内容はこの端末の利用者ごとに保存します。").font(.caption).foregroundStyle(.secondary)
          ForEach(store.snapshot.activities) { item in NavigationLink { ClubDetail(store: store, activity: item) } label: { Label(item.title, systemImage: "person.3").foregroundStyle(themeColor(item.colorTheme)) } }
          Button("サークルを登録") { activity = ClubActivity() }.accessibilityIdentifier("campus.add")
        }
        Section("公開サークル情報") {
          Text(store.snapshot.campus.status).font(.caption).foregroundStyle(.secondary)
          ForEach(store.snapshot.campus.entries.filter { $0.category == "club" }) { entry in
            VStack(alignment: .leading, spacing: 8) { Text(entry.title).font(.headline); Text(entry.body); if let url = publicCampusURL(entry.url) { Link("掲載元を確認", destination: url) }; Button("自分のサークルに登録") { var item = ClubActivity(); item.title = entry.title; item.details = entry.body; activity = item } }
          }
        }
        PromotionFooter(entries: store.snapshot.campus.entries)
      }.navigationTitle("サークル・キャンパス情報").toolbar { Button("完了") { dismiss() } }
        .onAppear { store.action("campusOpen") }
        .sheet(item: $activity) { item in ClubEditor(store: store, initial: item) }
    }
  }
}
struct ClubEditor: View {
  @ObservedObject var store: PlannerStore
  @State var activity: ClubActivity
  @Environment(\.dismiss) private var dismiss
  init(store: PlannerStore, initial: ClubActivity) { self.store = store; _activity = State(initialValue: initial) }
  var body: some View {
    NavigationStack { PlannerForm { TextField("サークル名", text: $activity.title); TextField("活動内容・メモ", text: $activity.details, axis: .vertical); ThemePicker(selection: $activity.colorTheme); Text("大学公認などの確認を行うものではありません。自分用の活動として保存します。").font(.caption) }.navigationTitle("サークルを登録").toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("保存") { store.action("saveActivity", activity); dismiss() }.disabled(activity.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.snapshot.busy) } } }
  }
}
struct ClubDetail: View {
  @ObservedObject var store: PlannerStore
  let activity: ClubActivity
  @State private var event: PlannerEvent?
  var body: some View {
    PlannerList {
      Section { Text(activity.details.isEmpty ? "活動メモは未登録です。" : activity.details); Text("曜日・時限を持たない活動です。").font(.caption) }
      Section("サークルの予定") {
        ForEach(store.snapshot.events.filter { $0.relatedLectureID == activity.id }.sorted { $0.date < $1.date }) { item in Button { event = item } label: { Label(item.date + " " + item.title, systemImage: "calendar").foregroundStyle(themeColor(activity.colorTheme)) } }
        Button("予定を追加") { var item = PlannerEvent(); item.relatedLectureID = activity.id; item.colorTheme = activity.colorTheme; event = item }
      }
      Section("関連する課題") { ForEach(store.snapshot.tasks.filter { $0.related_lecture_id == activity.id }.sorted(by: taskDueOrder)) { task in NavigationLink { TaskDetail(store: store, taskID: task.id) } label: { TaskRow(task: task) } } }
    }.navigationTitle(activity.title).sheet(item: $event) { item in EventEditor(store: store, initial: item, isNew: !store.snapshot.events.contains(where: { $0.id == item.id })) }
  }
}
func publicCampusURL(_ raw: String) -> URL? { guard let url = URL(string: raw), url.scheme == "https", url.user == nil, url.password == nil else { return nil }; return url }
struct PromotionFooter: View {
  var entries: [CampusEntry]
  var body: some View {
    let promotions = entries.filter { $0.category == "promotion" }
    if !promotions.isEmpty {
      Section("広告・企業広報") { ForEach(promotions) { entry in VStack(alignment: .leading, spacing: 4) { Text(entry.title).font(.subheadline); Text(entry.body).font(.caption).foregroundStyle(.secondary); if !entry.sponsor.isEmpty { Text("掲載元: " + entry.sponsor).font(.caption2) }; if let url = publicCampusURL(entry.url) { Link("掲載元を見る", destination: url).font(.caption) } } } }
    }
  }
}
