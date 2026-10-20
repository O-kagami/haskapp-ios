import SwiftUI

final class PlannerStore: ObservableObject {
  @Published var snapshot = Snapshot()
  var send: ((String)->Void)?
  func receive(_ json: String) {
    guard let data = json.data(using:.utf8) else {return}
    do {
      let incoming = try JSONDecoder().decode(Snapshot.self, from: data)
      // Expo prop setters can run during a SwiftUI view update. Apply the
      // decoded snapshot on the next main turn, preserving delivery order.
      DispatchQueue.main.async { [weak self] in self?.snapshot = incoming }
    } catch {
      let message = "表示データを読み込めません: \(error.localizedDescription)"
      DispatchQueue.main.async { [weak self] in self?.snapshot.message = message }
    }
  }
  func dismissMessage() {
    let dismissed = snapshot.message
    DispatchQueue.main.async { [weak self] in
      guard let self = self, self.snapshot.message == dismissed else { return }
      self.snapshot.message = ""
    }
  }
  func action<T:Encodable>(_ type:String, _ payload:T) {
    guard let data = try? JSONEncoder().encode(payload),let object = try? JSONSerialization.jsonObject(with:data),let json=try? JSONSerialization.data(withJSONObject:["type":type,"payload":object]),let text=String(data:json,encoding:.utf8) else {snapshot.message="操作データを作成できませんでした。内容を確認してください。";return}
    send?(text)
  }
  func action(_ type:String) {action(type,[: ] as [String:String])}
}

func themeColor(_ name:String)->Color {switch name {case "red":return .red;case "rose":return Color(red:0.85,green:0.22,blue:0.40);case "orange":return .orange;case "yellow":return .yellow;case "violet":return .purple;case "indigo":return .indigo;case "blue":return .blue;case "green":return .green;case "pink":return .pink;case "grey":return .gray;default:return .teal}}
func textBinding(_ value:Binding<String?>)->Binding<String>{Binding(get:{value.wrappedValue ?? ""},set:{value.wrappedValue=$0})}
func optionalInt(_ value:Binding<Int?>)->Binding<String>{Binding(get:{value.wrappedValue.map(String.init) ?? ""},set:{value.wrappedValue=Int($0)})}
func dateBinding(_ value:Binding<String>)->Binding<Date>{Binding(get:{dateValue(value.wrappedValue)},set:{value.wrappedValue=dateString($0)})}

struct ThemePicker: View {
  @Binding var selection: String
  private let choices = [("auto", "授業ごとに自動"), ("teal", "青緑"), ("violet", "紫"), ("indigo", "藍"), ("blue", "青"), ("green", "緑"), ("yellow", "黄"), ("orange", "オレンジ"), ("red", "赤"), ("rose", "ローズ"), ("pink", "ピンク"), ("grey", "グレー")]
  var body: some View {
    Picker("色", selection: $selection) {
      ForEach(choices, id: \.0) { choice in Text(choice.1).tag(choice.0) }
    }
  }
}

func lectureColor(_ lecture: Lecture) -> Color {
  if lecture.colorTheme != "auto" && lecture.colorTheme != "grey" { return themeColor(lecture.colorTheme) }
  let colors = ["teal", "blue", "violet", "orange", "green", "pink", "indigo", "red", "yellow", "rose"]
  var hash: UInt32 = 2166136261
  for scalar in (lecture.lecture_name.precomposedStringWithCompatibilityMapping + "|" + lecture.instructor.precomposedStringWithCompatibilityMapping).unicodeScalars { hash = (hash ^ scalar.value) &* 16777619 }
  return themeColor(colors[Int(hash % UInt32(colors.count))])
}

// Dynamic semantic surfaces: follow the OS theme; retain native light surfaces.
enum PlannerPalette {
  static let backgroundUIColor = UIColor { traits in traits.userInterfaceStyle == .dark ? UIColor(red: 0.09, green: 0.13, blue: 0.18, alpha: 1) : .systemGroupedBackground }
  static let cardUIColor = UIColor { traits in traits.userInterfaceStyle == .dark ? UIColor(red: 0.15, green: 0.20, blue: 0.26, alpha: 1) : .secondarySystemGroupedBackground }
  static let selectedUIColor = UIColor { traits in traits.userInterfaceStyle == .dark ? UIColor(red: 0.23, green: 0.30, blue: 0.38, alpha: 1) : .secondarySystemGroupedBackground }
  static var background: Color { Color(uiColor: backgroundUIColor) }
  static var card: Color { Color(uiColor: cardUIColor) }
  static func configureNativeSurfaces() {
    let nav = UINavigationBarAppearance(); nav.configureWithOpaqueBackground(); nav.backgroundColor = backgroundUIColor; nav.titleTextAttributes = [.foregroundColor: UIColor.label]; nav.largeTitleTextAttributes = [.foregroundColor: UIColor.label]
    UINavigationBar.appearance().standardAppearance = nav; UINavigationBar.appearance().scrollEdgeAppearance = nav
    let tabs = UITabBarAppearance(); tabs.configureWithOpaqueBackground(); tabs.backgroundColor = backgroundUIColor
    UITabBar.appearance().standardAppearance = tabs; UITabBar.appearance().scrollEdgeAppearance = tabs
    UISegmentedControl.appearance().backgroundColor = cardUIColor; UISegmentedControl.appearance().selectedSegmentTintColor = selectedUIColor
    UITextView.appearance().backgroundColor = .clear
  }
}
struct PlannerList<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () -> Content) { self.content = content() }
  var body: some View { List { content.listRowBackground(PlannerPalette.card) }.scrollContentBackground(.hidden).background(PlannerPalette.background).presentationBackground(PlannerPalette.background) }
}
struct PlannerForm<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () -> Content) { self.content = content() }
  var body: some View { Form { content.listRowBackground(PlannerPalette.card) }.scrollContentBackground(.hidden).background(PlannerPalette.background).presentationBackground(PlannerPalette.background) }
}
