import SwiftUI

struct DepartmentChatSheet: View {
  @ObservedObject var store: PlannerStore
  var lecture: Lecture? = nil
  private var chat: ChatSnapshot { lecture == nil ? store.snapshot.chat : store.snapshot.lectureChat }
  private func action(_ name: String, _ payload: [String: String] = [:]) { store.action(lecture == nil ? name : name.replacingOccurrences(of: "chat", with: "lectureChat"), payload) }
  @Environment(\.dismiss) private var dismiss
  @State private var bodyText = ""
  @State private var nickname = ""
  @State private var loaded = false
  private var guest: Bool { store.snapshot.account == "端末内のゲスト" }
  var body: some View {
    NavigationStack {
      PlannerList {
        Section {
          Text(chat.room?.name ?? "学科未設定").font(.headline)
          Text(lecture == nil ? "同じ学科の学年共通ルームです。所属は自己申告で、大学の在籍確認を意味しません。" : "共有講義に登録した利用者だけのルームです。投稿内容と表示名は参加者に見えます。").font(.caption).foregroundStyle(.secondary)
          Label(chat.status, systemImage: chat.ready ? "bubble.left.and.bubble.right" : "clock").font(.subheadline).accessibilityIdentifier("chat.status")
          if guest { Button("Googleでログイン") { store.action("googleLogin") }.disabled(!store.snapshot.configured || store.snapshot.busy); Text("ゲストはメッセージの閲覧・送信ができません。").font(.caption).foregroundStyle(.secondary) }
          if chat.room == nil { Text("設定で学部・学科・コースを保存すると、対応するルームが選ばれます。学年で分けません。").font(.caption) }
        }
        Section("メッセージ") {
          if chat.hasMore { Button("以前のメッセージを読み込む") { store.action("chatHistory", ["older": true]) }.disabled(store.snapshot.busy) }
          if chat.messages.isEmpty { Text(chat.ready ? "まだメッセージはありません。" : "チャットの配信はまだ開始されていません。").foregroundStyle(.secondary) }
          ForEach(chat.messages) { message in
            VStack(alignment: .leading, spacing: 6) {
              HStack { Text(message.nickname).font(.caption.bold()); if message.own { Text("自分").font(.caption).foregroundStyle(.teal) }; Spacer(); Text(chatTime(message.createdAt)).font(.caption2).foregroundStyle(.secondary) }
              Text(message.body).textSelection(.enabled)
            }.padding(.vertical, 4)
          }
          if chat.ready { Button("再読み込み") { action("chatHistory") }.disabled(store.snapshot.busy) }
        }
        if !guest, chat.room != nil {
          Section("投稿・下書き") {
            TextField("表示名（1〜32文字）", text: $nickname).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("chat.nickname")
            Text("メールアドレスやGoogleの氏名は自動で投稿しません。表示名は自分で入力してください。").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $bodyText).frame(minHeight: 120).accessibilityLabel("メッセージ").accessibilityIdentifier("chat.body")
            Text("\(bodyText.unicodeScalars.count) / 2000文字").font(.caption).foregroundStyle(.secondary)
            Button("下書きを端末に保存") { action("chatDraft", ["body": bodyText, "nickname": nickname]) }.disabled(store.snapshot.busy || bodyText.unicodeScalars.count > 2000 || nickname.unicodeScalars.count > 32)
            Button("送信") { action("chatSend", ["body": bodyText, "nickname": nickname]) }.disabled(!chat.ready || store.snapshot.busy || bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bodyText.unicodeScalars.count > 2000 || nickname.unicodeScalars.count > 32).accessibilityIdentifier("chat.send")
          }
        }
      }.navigationTitle(lecture == nil ? "学科チャット" : "講義チャット").navigationBarTitleDisplayMode(.inline)
      .toolbar { Button("完了") { dismiss() } }
      .onAppear { { if let lecture = lecture { store.action("lectureChatOpen", ["id": lecture.id]) } else { store.action("chatOpen") } }(); loadDraft() }
      .onChange(of: chat.draft) { draft in if draft != bodyText { bodyText = draft } }
      .onChange(of: chat.room?.id) { _ in loaded = false; loadDraft() }
      .onChange(of: chat.nickname) { value in if !loaded || nickname.isEmpty { nickname = value; loaded = true } }
    }
  }
  private func loadDraft() { bodyText = chat.draft; nickname = chat.nickname; loaded = true }
  private func chatTime(_ raw: String) -> String { if let date = ISO8601DateFormatter().date(from: raw) { return date.formatted(.dateTime.month().day().hour().minute()) }; return raw }
}
