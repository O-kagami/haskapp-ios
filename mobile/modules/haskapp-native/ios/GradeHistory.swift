import SwiftUI
import Charts

struct GradeHistorySection: View {
  @ObservedObject var store: PlannerStore
  let lecture: Lecture
  var officialReference = false
  @State private var selectedID = ""
  @State private var requested = false

  private var rows: [GradeHistoryRow]? { store.snapshot.gradeHistory[lecture.id] }
  private var status: DetailResourceStatus? { store.snapshot.gradeHistoryStatus[lecture.id] }
  private var selectedRow: GradeHistoryRow? {
    guard let rows = rows else { return nil }
    return selectedGradeHistoryRow(in: rows, selectedID: selectedID)
  }
  var body: some View {
    Section {
      if status?.status == "loading" { ProgressView("過去の成績を読み込み中…").accessibilityIdentifier("grades.loading") }
      if status?.source == "cache" || status?.stale == true {
        Label("保存済み", systemImage: "internaldrive")
          .font(.caption).foregroundStyle(.orange).accessibilityIdentifier("grades.cached")
      }
      if let error = nonempty(status?.error) {
        Label(error, systemImage: "exclamationmark.triangle")
          .font(.caption).foregroundStyle(.orange).accessibilityIdentifier("grades.error")
      }
      if let rows = rows {
        if rows.isEmpty {
          Text("該当する過去の成績データはありません。")
            .foregroundStyle(.secondary).accessibilityIdentifier("grades.empty")
        } else {
          VStack(alignment: .leading, spacing: 10) {
            Text("年度・担当・講義を選択").font(.headline).fixedSize(horizontal: false, vertical: true)
            Menu {
              ForEach(rows) { row in Button(row.pickerTitle) { selectedID = row.id } }
            } label: {
              HStack(alignment: .top, spacing: 12) {
                Text(selectedRow?.pickerTitle ?? "集計を選択").font(.subheadline).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1)
                Image(systemName: "chevron.up.chevron.down").font(.caption).padding(.top, 3)
              }.padding(.vertical, 8).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }.accessibilityLabel("年度・担当・講義を選択").accessibilityValue(selectedRow?.pickerTitle ?? "").accessibilityIdentifier("grades.cohort")
          }.padding(.vertical, 4)
          if let row = selectedRow { GradeHistoryDetails(row: row) }
        }
      } else if status?.status != "loading" {
        Text("成績データは未取得です。")
          .font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("grades.unavailable")
      }
      Button("過去の成績を再読み込み") { load() }
        .disabled(!store.snapshot.configured || store.snapshot.busy || status?.status == "loading")
        .accessibilityIdentifier("grades.reload")
      if (rows?.isEmpty ?? true) { CachedGradeSummary(lecture: lecture) }
    } header: { Text("過去の成績分布") }
    .onAppear { loadIfNeeded() }
    .onChange(of: lecture.id) { _ in selectedID = ""; requested = false; loadIfNeeded() }
    .onChange(of: store.snapshot.configured) { _ in loadIfNeeded() }
  }
  private func loadIfNeeded() {
    guard rows == nil, !requested, status?.status != "loading", store.snapshot.configured else { return }
    load()
  }
  private func load() { requested = true; store.action("gradeHistory", ["id": lecture.id]) }
}

private struct GradeHistoryDetails: View {
  let row: GradeHistoryRow
  var body: some View {
    GradeDistributionChart(distribution: row.distribution)
  }
}

private struct GradeDistributionChart: View {
  let distribution: [Double?]
  @State private var showValues = false
  private var values: [Double?] { validGradeDistribution(distribution) }
  private var knownSum: Double { values.compactMap { $0 }.reduce(0, +) }
  private func color(_ index: Int) -> Color {
    if index < 3 { return .blue }
    if index < 6 { return .cyan }
    if index < 8 { return .orange }
    return .gray
  }
  var body: some View {
    if values.contains(where: { $0 != nil }) {
      VStack(alignment: .leading, spacing: 8) {
        Text("成績区分ごとの割合（%）").font(.caption).foregroundStyle(.secondary)
        Chart(Array(values.enumerated()), id: \.offset) { item in
          if let percentage = item.element {
            BarMark(x: .value("成績", gradeLabels[item.offset]), y: .value("割合（%）", percentage))
              .foregroundStyle(color(item.offset)).cornerRadius(3)
              .accessibilityLabel(gradeLabels[item.offset])
              .accessibilityValue(gradePercentage(percentage))
          }
        }
        .chartXScale(domain: gradeLabels)
        .chartYScale(domain: 0.0...100.0)
        .chartYAxis { AxisMarks(values: [0, 25, 50, 75, 100]) }
        .frame(height: 210)
        .accessibilityLabel("過去の成績分布、割合はパーセント")
        .accessibilityIdentifier("grades.chart")
      }.padding(.vertical, 5)
    } else {
      Text("成績区分の割合は未取得です。").foregroundStyle(.secondary)
    }
    if values.contains(where: { $0 == nil }) {
      Text("未取得の区分あり。0%とは異なります。")
        .font(.caption).foregroundStyle(.secondary)
    }
    if knownSum > 100.5 {
      Label("元データの割合合計が100%を超過", systemImage: "exclamationmark.triangle")
        .font(.caption).foregroundStyle(.orange)
    }
    DisclosureGroup("区分別の割合（数値）", isExpanded: $showValues) {
      ForEach(Array(values.enumerated()), id: \.offset) { item in
        LabeledContent(gradeLabels[item.offset], value: gradePercentage(item.element))
          .accessibilityIdentifier("grades.bucket.\(item.offset)")
      }
    }.accessibilityIdentifier("grades.values")
  }
}

private struct CachedGradeSummary: View {
  let lecture: Lecture
  var body: some View {
    if let distribution = lecture.gradeDistribution {
      Text("保存済み・年度・集計元未確認").font(.caption).foregroundStyle(.secondary)
      GradeDistributionChart(distribution: distribution.map { Optional($0) })
    }
  }
}
