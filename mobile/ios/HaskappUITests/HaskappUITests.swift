import XCTest

final class HaskappUITests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    // Uses an isolated guest namespace and never the user's connected account.
    app.launchArguments = ["-haskapp-ui-tests", "-haskapp-ui-test-namespace", UUID().uuidString]
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 30))
    return app
  }
  private func name(_ prefix: String) -> String { "\(prefix)-\(UUID().uuidString.prefix(8))" }
  private func addTask(_ name: String, in app: XCUIApplication, deadline: Bool = true) {
    app.tabBars.buttons["課題"].tap()
    app.buttons["課題を追加"].firstMatch.tap()
    let field = app.textFields["課題名"]
    XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText(name)
    if !deadline {
      let toggle = app.switches["期限を設定"]
      XCTAssertTrue(toggle.exists)
      if toggle.value as? String == "1" {
        // iOS 27 exposes the entire labelled row as the switch accessibility frame.
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
      }
      XCTAssertTrue(NSPredicate(format: "value == %@", "0").evaluate(with: toggle), "Deadline must be disabled before saving")
    }
    app.buttons["保存"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts[name].firstMatch.waitForExistence(timeout: 10))
  }

  func testNormalStartupReadsEmptySecureSession() {
    // Only on a fresh dedicated simulator: this reads the empty Keychain and
    // makes no authentication request or backend mutation.
    let app = XCUIApplication()
    app.launch()
    if app.buttons["auth.guest"].waitForExistence(timeout: 5) { XCTAssertTrue(app.buttons["auth.google"].exists); app.buttons["auth.guest"].tap() }
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 30))
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "Normal native startup"; shot.lifetime = .keepAlways; add(shot)
  }

  func testExplicitGuestEntryPersistsWithoutAnAccount() {
    let app = XCUIApplication()
    app.launchArguments = ["-haskapp-ui-tests", "-haskapp-ui-onboarding", "-haskapp-ui-test-namespace", UUID().uuidString]
    app.launch()
    XCTAssertTrue(app.buttons["auth.guest"].waitForExistence(timeout: 30))
    XCTAssertTrue(app.buttons["auth.google"].exists)
    let entry = XCTAttachment(screenshot: app.screenshot()); entry.name = "Guest account entry"; entry.lifetime = .keepAlways; add(entry)
    app.buttons["auth.guest"].tap()
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 10))
    app.terminate(); app.launch()
    XCTAssertTrue(app.tabBars.buttons["設定"].waitForExistence(timeout: 30))
    app.tabBars.buttons["設定"].tap()
    let identity = app.descendants(matching: .any).matching(identifier: "account.identity").firstMatch
    XCTAssertTrue((identity.label + (identity.value as? String ?? "")).contains("端末内のゲスト"))
    XCTAssertFalse(app.buttons["auth.guest"].exists)
  }

  func testWeekdayGridFitsWithoutScrolling() {
    let app = launch()
    app.tabBars.buttons["時間割"].tap()
    for day in 1...5 {
      XCTAssertTrue(app.staticTexts["timetable.day.\(day)"].isHittable)
      for period in 1...5 { XCTAssertTrue(app.buttons["timetable.cell.\(day).\(period)"].isHittable) }
    }
    XCTAssertFalse(app.staticTexts["timetable.day.0"].exists)
    XCTAssertFalse(app.staticTexts["timetable.day.6"].exists)
    XCTAssertEqual(app.scrollViews.count, 0)
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Five weekday grid"; shot.lifetime = .keepAlways; add(shot)
  }

  func testWeekdayGridFitsAtLargestAccessibilityTextSize() {
    let app = XCUIApplication()
    app.launchArguments = ["-haskapp-ui-tests", "-haskapp-ui-test-namespace", UUID().uuidString, "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 30)); app.tabBars.buttons["時間割"].tap()
    for day in 1...5 { for period in 1...5 { XCTAssertTrue(app.buttons["timetable.cell.\(day).\(period)"].isHittable) } }
    XCTAssertEqual(app.scrollViews.count, 0)
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Weekday grid large text"; shot.lifetime = .keepAlways; add(shot)
  }

  func testLocalPlannerSurvivesRestart() {
    let app = launch()
    let lectureName = name("QA-Lecture")
    let taskName = name("QA-Task")
    let eventName = name("QA-Event")
    app.tabBars.buttons["時間割"].tap()
    app.buttons["講義を追加"].firstMatch.tap()
    let lecture = app.textFields["講義名"]
    XCTAssertTrue(lecture.waitForExistence(timeout: 5)); lecture.tap(); lecture.typeText(lectureName)
    app.buttons["保存"].firstMatch.tap()
    let cell = app.buttons["timetable.cell.1.1"]
    expectation(for: NSPredicate(format: "label CONTAINS %@", lectureName), evaluatedWith: cell)
    waitForExpectations(timeout: 10)
    addTask(taskName, in: app)
    app.tabBars.buttons["予定"].tap()
    app.buttons["予定を追加"].firstMatch.tap()
    let event = app.textFields["予定名"]
    XCTAssertTrue(event.waitForExistence(timeout: 5)); event.tap(); event.typeText(eventName)
    app.buttons["保存"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts[eventName].firstMatch.waitForExistence(timeout: 10))
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Native calendar"; shot.lifetime = .keepAlways; add(shot)
    app.terminate(); app.launch()
    XCTAssertTrue(app.tabBars.buttons["課題"].waitForExistence(timeout: 30))
    app.tabBars.buttons["課題"].tap()
    XCTAssertTrue(app.staticTexts[taskName].firstMatch.waitForExistence(timeout: 10))
    app.tabBars.buttons["予定"].tap()
    XCTAssertTrue(app.staticTexts[eventName].firstMatch.waitForExistence(timeout: 10))
    app.tabBars.buttons["設定"].tap()
    let identity = app.descendants(matching: .any).matching(identifier: "account.identity").firstMatch
    XCTAssertTrue(identity.waitForExistence(timeout: 5))
    XCTAssertTrue((identity.label + (identity.value as? String ?? "")).contains("端末内のゲスト"))
  }

  func testTaskWithoutDeadlineAndCancelledEditSurvivesRestart() {
    let app = launch()
    let original = name("QA-Undated")
    let discarded = name("QA-Cancelled")
    addTask(original, in: app, deadline: false)
    app.staticTexts[original].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["期限なし"].firstMatch.waitForExistence(timeout: 5))
    app.buttons["編集"].firstMatch.tap()
    let field = app.textFields["課題名"]
    XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap()
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: original.count) + discarded)
    app.buttons["キャンセル"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts[original].firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts[discarded].exists)
    app.terminate(); app.launch()
    XCTAssertTrue(app.tabBars.buttons["課題"].waitForExistence(timeout: 30))
    app.tabBars.buttons["課題"].tap()
    XCTAssertTrue(app.staticTexts[original].firstMatch.waitForExistence(timeout: 10))
    app.staticTexts[original].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["期限なし"].firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts[discarded].exists)
  }

  func testTaskWithoutLectureSurvivesEditAndRestart() {
    let app = launch()
    let taskName = name("QA-Personal")
    addTask(taskName, in: app)
    app.staticTexts[taskName].firstMatch.tap()
    app.buttons["編集"].firstMatch.tap()
    let selection = app.descendants(matching: .any).matching(identifier: "task.lecture").firstMatch
    XCTAssertTrue(selection.waitForExistence(timeout: 5))
    XCTAssertTrue((selection.label + (selection.value as? String ?? "")).contains("講義なし"))
    let field = app.textFields["課題名"]
    field.tap(); field.typeText("-Edited")
    let editedName = field.value as! String
    app.buttons["保存"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts[editedName].firstMatch.waitForExistence(timeout: 10))
    app.terminate(); app.launch()
    XCTAssertTrue(app.tabBars.buttons["課題"].waitForExistence(timeout: 30))
    app.tabBars.buttons["課題"].tap()
    app.staticTexts[editedName].firstMatch.tap()
    app.buttons["編集"].firstMatch.tap()
    XCTAssertTrue(selection.waitForExistence(timeout: 5))
    XCTAssertTrue((selection.label + (selection.value as? String ?? "")).contains("講義なし"))
  }

  func testTaskCanCompleteAndReopen() {
    let app = launch()
    let taskName = name("QA-State")
    addTask(taskName, in: app)
    app.staticTexts[taskName].firstMatch.tap()
    let progress = app.segmentedControls.firstMatch
    XCTAssertTrue(progress.waitForExistence(timeout: 5))
    progress.buttons["完了"].tap()
    XCTAssertTrue(app.staticTexts["100%"].firstMatch.waitForExistence(timeout: 10))
    progress.buttons["未着手"].tap()
    XCTAssertTrue(app.staticTexts["0%"].firstMatch.waitForExistence(timeout: 10))
    app.terminate(); app.launch()
    XCTAssertTrue(app.tabBars.buttons["課題"].waitForExistence(timeout: 30))
    app.tabBars.buttons["課題"].tap()
    XCTAssertTrue(app.staticTexts[taskName].firstMatch.waitForExistence(timeout: 10))
  }

  func testUnsavedProfileSurvivesTabChangesAndRefresh() {
    let app = launch()
    app.tabBars.buttons["設定"].tap()
    XCTAssertFalse(app.textFields["学部"].exists)
    let faculty = app.buttons["profile.faculty"]
    XCTAssertTrue(faculty.waitForExistence(timeout: 5)); faculty.tap()
    app.buttons["工学部"].firstMatch.tap()
    let major = app.buttons["profile.major"]
    major.tap(); app.buttons["情報エレクトロニクス学科 情報理工学コース"].firstMatch.tap()
    app.tabBars.buttons["今日"].tap()
    app.tabBars.buttons["設定"].tap()
    XCTAssertTrue((faculty.label + (faculty.value as? String ?? "")).contains("工学部"))
    app.buttons["再接続・再読み込み"].tap()
    XCTAssertTrue((major.label + (major.value as? String ?? "")).contains("情報理工学コース"))
  }
  func testOfficialCatalogIsPermanentAndYearFilterHasNoInventedFirstYear() {
    let app = launch()
    app.tabBars.buttons["時間割"].tap()
    app.buttons["official.open"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["大学公式（本人提供PDF）"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["official.save"].exists)
    app.buttons["official.year"].tap(); app.buttons["1年"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["この条件の科目は収録されていません。"].waitForExistence(timeout: 5))
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Official catalog and honest first-year filter"; shot.lifetime = .keepAlways; add(shot)
    app.buttons["official.year"].tap(); app.buttons["3年"].firstMatch.tap()
    app.buttons["official.course"].tap(); app.buttons["情報理工学コース"].firstMatch.tap()
    let selected = app.buttons["データベースとWebインテリジェンスを選択"]
    for _ in 0..<5 { if selected.isHittable { break }; app.swipeUp() }
    XCTAssertTrue(selected.isHittable); selected.tap()
    app.buttons["official.save"].tap()
    if app.alerts.firstMatch.waitForExistence(timeout: 5) { app.alerts.buttons["OK"].tap() }
    XCTAssertTrue(app.buttons["timetable.cell.2.3"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["timetable.cell.2.3"].label.contains("データベースとWebインテリジェンス"))
    XCTAssertTrue(app.buttons["timetable.cell.5.3"].label.contains("データベースとWebインテリジェンス"))
    app.terminate(); app.launch()
    app.tabBars.buttons["時間割"].tap()
    XCTAssertTrue(app.buttons["timetable.cell.2.3"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["timetable.cell.2.3"].label.contains("データベースとWebインテリジェンス"))
    XCTAssertTrue(app.buttons["timetable.cell.5.3"].label.contains("データベースとWebインテリジェンス"))
    let grid = XCTAttachment(screenshot: app.screenshot()); grid.name = "Official subject persisted on weekday grid"; grid.lifetime = .keepAlways; add(grid)
  }
  func testGuestChatShowsRealConnectionStateWithoutMessagesOrComposer() {
    let app = launch()
    app.tabBars.buttons["設定"].tap()
    let entry = app.buttons["chat.open"]
    for _ in 0..<6 { if entry.isHittable { break }; app.swipeUp() }
    XCTAssertTrue(entry.isHittable); entry.tap()
    XCTAssertTrue(app.staticTexts["ゲストはメッセージの閲覧・送信ができません。"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["chat.send"].exists)
    XCTAssertTrue(app.staticTexts["チャットの配信はまだ開始されていません。"].exists)
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Guest department chat requires authentication"; shot.lifetime = .keepAlways; add(shot)
  }

  private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
    func visible() -> Bool {
      guard element.exists else { return false }
      let frame = element.frame
      // iOS 27 may expose an offscreen List row with a zero activation frame.
      // Avoid asking hittability until layout places it inside the viewport.
      guard frame.width > 0, frame.height > 0, frame.minY > 100, frame.maxY < app.frame.maxY - 60 else { return false }
      return !element.isEnabled || element.isHittable
    }
    for _ in 0..<8 { if visible() { return }; app.swipeUp() }
    for _ in 0..<8 { if visible() { return }; app.swipeDown() }
    XCTAssertTrue(element.isHittable)
  }

  private func addAndOpenLecture(_ title: String, in app: XCUIApplication) {
    app.tabBars.buttons["時間割"].tap()
    app.buttons["講義を追加"].firstMatch.tap()
    let field = app.textFields["講義名"]
    XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText(title)
    app.buttons["保存"].firstMatch.tap()
    let cell = app.buttons["timetable.cell.1.1"]
    expectation(for: NSPredicate(format: "label CONTAINS %@", title), evaluatedWith: cell)
    waitForExpectations(timeout: 10)
    cell.tap()
    XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 5))
    app.staticTexts[title].firstMatch.tap()
    XCTAssertTrue(app.segmentedControls["lecture.tabs"].waitForExistence(timeout: 5))
  }

  func testLectureGradesPreserveZeroAndCancelledAssessmentEdits() {
    // The UI-test namespace disables all backend transport. Every value below
    // is entered by this test into an isolated guest lecture.
    let app = launch()
    let title = name("QA-Assessment")
    addAndOpenLecture(title, in: app)
    app.segmentedControls["lecture.tabs"].buttons["成績情報"].tap()
    let edit = app.buttons["assessment.edit"]
    scrollTo(edit, in: app); edit.tap()
    let report = app.textFields["assessment.input.report"]
    let exam = app.textFields["assessment.input.test"]
    XCTAssertTrue(report.waitForExistence(timeout: 5))
    report.tap(); report.typeText("0")
    exam.tap(); exam.typeText("70")
    app.buttons["assessment.save"].tap()
    scrollTo(edit, in: app); edit.tap()
    XCTAssertEqual(report.value as? String, "0")
    XCTAssertEqual(exam.value as? String, "70")
    report.tap(); report.typeText(XCUIKeyboardKey.delete.rawValue + "50")
    XCTAssertFalse(app.buttons["assessment.save"].isEnabled, "An assessment total over 100% cannot be saved")
    app.buttons["キャンセル"].tap()
    scrollTo(edit, in: app); edit.tap()
    XCTAssertEqual(report.value as? String, "0", "Cancel must retain the original explicit zero")
    XCTAssertEqual(exam.value as? String, "70")
    app.buttons["キャンセル"].tap()
    app.terminate(); app.launch()
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 30))
    app.tabBars.buttons["時間割"].tap(); app.buttons["timetable.cell.1.1"].tap()
    app.staticTexts[title].firstMatch.tap()
    XCTAssertTrue(app.segmentedControls["lecture.tabs"].waitForExistence(timeout: 5))
    app.segmentedControls["lecture.tabs"].buttons["成績情報"].tap()
    scrollTo(edit, in: app); edit.tap()
    XCTAssertEqual(report.value as? String, "0")
    XCTAssertEqual(exam.value as? String, "70")
  }

  func testLectureMissingGradeDataDoesNotInventCohortsOrTemplateSuggestions() {
    let app = launch()
    addAndOpenLecture(name("QA-NoGrades"), in: app)
    app.segmentedControls["lecture.tabs"].buttons["成績情報"].tap()
    let unavailable = app.staticTexts["grades.unavailable"]
    scrollTo(unavailable, in: app)
    XCTAssertTrue(unavailable.exists)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "grades.cohort").firstMatch.exists)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "grades.chart").firstMatch.exists)
    XCTAssertFalse(app.buttons["suggestion.review"].exists, "A guest lecture without a canonical group cannot fetch name-matched template proposals")
    XCTAssertFalse(app.buttons["grades.reload"].isEnabled)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "Lecture detail distinguishes missing historical data"; shot.lifetime = .keepAlways; add(shot)
    app.segmentedControls["lecture.tabs"].buttons["講義情報"].tap()
    let unknownLimit = app.staticTexts["講義回数・必要出席回数が未登録のため、欠席上限は計算していません。"]
    scrollTo(unknownLimit, in: app)
    XCTAssertTrue(unknownLimit.exists)
  }

  func testQACohortChartCacheErrorAndSelectedOnlyProposalApplication() {
    let app = XCUIApplication()
    app.launchArguments = ["-haskapp-ui-tests", "-haskapp-ui-resource-fixture", "-haskapp-ui-test-namespace", UUID().uuidString]
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 30))
    app.tabBars.buttons["時間割"].tap(); app.buttons["timetable.cell.1.1"].tap()
    app.staticTexts["QA専用 成績・提案"].firstMatch.tap()
    app.segmentedControls["lecture.tabs"].buttons["講義情報"].tap()
    let review = app.buttons["suggestion.review"]; scrollTo(review, in: app); review.tap()
    let apply = app.buttons["suggestion.apply"]
    XCTAssertTrue(apply.waitForExistence(timeout: 5)); XCTAssertFalse(apply.isEnabled)
    let report = app.descendants(matching: .any).matching(identifier: "suggestion.field.grading_report").firstMatch
    scrollTo(report, in: app); XCTAssertFalse(report.isEnabled, "Existing zero must remain protected")
    let exam = app.descendants(matching: .any).matching(identifier: "suggestion.field.grading_test").firstMatch
    scrollTo(exam, in: app); exam.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
    XCTAssertTrue(apply.isEnabled)
    let before = XCTAttachment(screenshot: app.screenshot()); before.name = "QA ONLY selected proposal review"; before.lifetime = .keepAlways; add(before)
    apply.tap(); app.buttons["選択した項目を保存"].firstMatch.tap()
    app.buttons["閉じる"].tap()
    app.segmentedControls["lecture.tabs"].buttons["成績情報"].tap()
    let edit = app.buttons["assessment.edit"]; scrollTo(edit, in: app); edit.tap()
    XCTAssertEqual(app.textFields["assessment.input.report"].value as? String, "0")
    XCTAssertEqual(app.textFields["assessment.input.test"].value as? String, "70")
    XCTAssertTrue(["", "未登録"].contains(app.textFields["assessment.input.quiz"].value as? String ?? ""), "Unchecked field must remain missing")
    app.buttons["キャンセル"].tap()
    let cached = app.descendants(matching: .any).matching(identifier: "grades.cached").firstMatch
    scrollTo(cached, in: app); XCTAssertTrue(cached.exists)
    let error = app.descendants(matching: .any).matching(identifier: "grades.error").firstMatch
    scrollTo(error, in: app); XCTAssertTrue(error.exists)
    let cohort = app.buttons["grades.cohort"]
    let plot = app.descendants(matching: .any).matching(identifier: "grades.chart").firstMatch
    scrollTo(plot, in: app)
    let chart = XCTAttachment(screenshot: app.screenshot()); chart.name = "QA ONLY populated cohort chart and cache error"; chart.lifetime = .keepAlways; add(chart)
    scrollTo(cohort, in: app); cohort.tap()
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "2024 QA")).firstMatch.tap()
    scrollTo(plot, in: app); XCTAssertTrue(plot.exists)
    XCTAssertTrue((cohort.label + (cohort.value as? String ?? "")).contains("2024 QA"))
    let zero = XCTAttachment(screenshot: app.screenshot()); zero.name = "QA ONLY cohort zero and missing buckets"; zero.lifetime = .keepAlways; add(zero)
  }

  func testTaskBoardMovesStatusesAndPersistsWithoutNetwork() {
    let app = launch(); let title = name("Board")
    addTask(title, in: app, deadline: false)
    app.segmentedControls["tasks.layout"].buttons["ボード"].tap()
    app.staticTexts[title].firstMatch.press(forDuration: 1)
    app.buttons["作業中に移動"].tap()
    let working = app.staticTexts["tasks.group.inProgress"]
    XCTAssertTrue(working.waitForExistence(timeout: 5)); XCTAssertTrue(working.label.contains("1件"))
    app.staticTexts[title].firstMatch.press(forDuration: 1)
    app.buttons["完了に移動"].tap()
    let done = app.staticTexts["tasks.group.done"]; scrollTo(done, in: app)
    XCTAssertTrue(done.label.contains("1件"))
    app.terminate(); app.launch(); app.tabBars.buttons["課題"].tap()
    app.segmentedControls["tasks.layout"].buttons["ボード"].tap()
    scrollTo(done, in: app); XCTAssertTrue(done.label.contains("1件"))
    XCTAssertTrue(app.staticTexts[title].firstMatch.exists)
  }

  func testRepresentativeLectureAndGradeAvailabilityScreenshots() {
    // User-facing registration example, no account, personal data, synthetic
    // grade rows or QA-resource fixture. Network remains disabled by launch().
    let app = launch(); addAndOpenLecture("登録例：線形代数学", in: app)
    let lecture = XCTAttachment(screenshot: app.screenshot()); lecture.name = "Representative lecture registration example"; lecture.lifetime = .keepAlways; add(lecture)
    app.segmentedControls["lecture.tabs"].buttons["成績情報"].tap()
    scrollTo(app.staticTexts["grades.unavailable"], in: app)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "grades.chart").firstMatch.exists)
    let grades = XCTAttachment(screenshot: app.screenshot()); grades.name = "Representative grades honest unavailable state"; grades.lifetime = .keepAlways; add(grades)
  }

  func testReadOnlyLivePublicGradeDistributionOnOfficialCourse() {
    // Intentionally normal backend mode: real anonymous GETs to the existing
    // public aggregate table. No QA fixture, sign-in, enrolment, save or post.
    let app = XCUIApplication(); app.launchArguments = ["-haskapp-readonly-grade-verification"]; app.launch()
    if app.buttons["auth.guest"].waitForExistence(timeout: 5) { app.buttons["auth.guest"].tap() }
    XCTAssertTrue(app.staticTexts["端末内のゲスト"].waitForExistence(timeout: 20), "Stop before navigating if an authenticated account is present")
    app.tabBars.buttons["時間割"].tap(); app.buttons["official.open"].tap()
    let subject = app.staticTexts["コンピュータシステム"].firstMatch; scrollTo(subject, in: app); subject.tap(); app.segmentedControls["lecture.tabs"].buttons["成績情報"].tap()
    let cohort = app.buttons["grades.cohort"]; scrollTo(cohort, in: app)
    XCTAssertTrue(cohort.waitForExistence(timeout: 30), "Existing public aggregate must load via the production engine")
    XCTAssertTrue(cohort.label.contains("2024") || (cohort.value as? String ?? "").contains("2024"))
    let chart = app.descendants(matching: .any).matching(identifier: "grades.chart").firstMatch
    scrollTo(chart, in: app); XCTAssertTrue(chart.exists)
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "LIVE PUBLIC aggregate Computer Systems 2024 semester2"; shot.lifetime = .keepAlways; add(shot)
  }

  private func japaneseToday() -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo"); return f.string(from: Date())
  }
  func testMonthCalendarMarkersDayNavigationAndRepeatedTransitions() {
    let app = launch(); let task = name("MonthTask"); addTask(task, in: app)
    app.tabBars.buttons["予定"].tap(); let today = japaneseToday()
    let day = app.buttons["calendar.day." + today]
    XCTAssertTrue(day.waitForExistence(timeout: 5)); XCTAssertTrue(day.label.contains("課題期限1件"))
    app.buttons["予定を追加"].tap(); let event = name("MonthEvent")
    let field = app.textFields["予定名"]; XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText(event); app.buttons["保存"].tap()
    XCTAssertTrue(day.label.contains("予定1件")); XCTAssertTrue(day.label.contains("課題期限1件"))
    day.tap(); scrollTo(app.staticTexts[event], in: app); XCTAssertTrue(app.staticTexts[event].exists)
    scrollTo(app.staticTexts[task], in: app); app.staticTexts[task].tap(); XCTAssertTrue(app.staticTexts["0%"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.firstMatch.tap()
    let previous = app.buttons["calendar.previous"]; scrollTo(previous, in: app)
    let month = app.staticTexts["calendar.month"]; let originalMonth = month.label
    previous.tap(); XCTAssertNotEqual(month.label, originalMonth)
    app.buttons["calendar.next"].tap(); XCTAssertEqual(month.label, originalMonth); app.buttons["calendar.today"].tap()
    XCTAssertTrue(day.label.contains("予定1件"))
    for _ in 0..<3 { app.tabBars.buttons["課題"].tap(); app.tabBars.buttons["予定"].tap(); XCTAssertTrue(day.exists) }
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Native month overview with local tasks and events"; shot.lifetime = .keepAlways; add(shot)
  }
  func testMonthCalendarAtLargestTextKeepsDatesAndTimetableAccessible() {
    let app = launch(); let title = name("LargeMonth"); addTask(title, in: app)
    app.terminate(); app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]; app.launch()
    XCTAssertTrue(app.tabBars.buttons["予定"].waitForExistence(timeout: 30)); app.tabBars.buttons["予定"].tap()
    let day = app.buttons["calendar.day." + japaneseToday()]
    XCTAssertTrue(day.waitForExistence(timeout: 5)); XCTAssertTrue(day.isHittable); XCTAssertTrue(day.label.contains("課題期限1件"))
    day.tap(); XCTAssertTrue(app.buttons["calendar.previous"].isHittable); XCTAssertTrue(app.buttons["calendar.next"].isHittable)
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Accessible month date list at largest text"; shot.lifetime = .keepAlways; add(shot)
    app.tabBars.buttons["時間割"].tap()
    for day in 1...5 { for period in 1...5 { XCTAssertTrue(app.buttons["timetable.cell.\(day).\(period)"].isHittable) } }
  }

  func testReadOnlyLiveAdditionalCohortsOfflineCacheAndReload() {
    let app = XCUIApplication()
    func openSubject(_ subject: String) {
      app.launch()
      if app.buttons["auth.guest"].waitForExistence(timeout: 3) { app.buttons["auth.guest"].tap() }
      XCTAssertTrue(app.staticTexts["端末内のゲスト"].waitForExistence(timeout: 20))
      app.tabBars.buttons["時間割"].tap(); app.buttons["official.open"].tap()
      let title = app.staticTexts[subject].firstMatch; scrollTo(title, in: app); title.tap()
    }
    app.launchArguments = ["-haskapp-readonly-grade-verification"]
    openSubject("信号処理")
    let cohort = app.buttons["grades.cohort"]; scrollTo(cohort, in: app); XCTAssertTrue(cohort.waitForExistence(timeout: 30)); cohort.tap()
    let choices = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "2024"))
    XCTAssertGreaterThanOrEqual(choices.count, 3); choices.element(boundBy: 1).tap()
    let chart = app.descendants(matching: .any).matching(identifier: "grades.chart").firstMatch; scrollTo(chart, in: app); XCTAssertTrue(chart.exists)
    app.terminate(); app.launchArguments += ["-haskapp-readonly-grade-offline"]
    openSubject("信号処理")
    let cached = app.descendants(matching: .any).matching(identifier: "grades.cached").firstMatch
    scrollTo(cached, in: app); XCTAssertTrue(cached.exists)
    let error = app.descendants(matching: .any).matching(identifier: "grades.error").firstMatch; scrollTo(error, in: app); XCTAssertTrue(error.exists)
    scrollTo(chart, in: app); XCTAssertTrue(chart.exists)
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Real public Signal Processing cohort retained during simulated offline transport"; shot.lifetime = .keepAlways; add(shot)
    app.terminate(); app.launchArguments = ["-haskapp-readonly-grade-verification"]
    openSubject("信号処理"); scrollTo(cohort, in: app); XCTAssertTrue(cohort.exists)
    let reload = app.buttons["grades.reload"]; scrollTo(reload, in: app); reload.tap()
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: error); waitForExpectations(timeout: 15)
    scrollTo(chart, in: app); XCTAssertTrue(chart.exists)
  }

  func testMonthCalendarIncludesSelectedOfficialCourse() {
    let app = launch(); app.tabBars.buttons["時間割"].tap(); app.buttons["official.open"].tap()
    let selection = app.buttons["コンピュータシステムを選択"]; scrollTo(selection, in: app); selection.tap(); app.buttons["official.save"].tap()
    if app.alerts.firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["OK"].tap() }
    app.tabBars.buttons["予定"].tap()
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
    let offset = (2 - calendar.component(.weekday, from: Date()) + 7) % 7
    let monday = calendar.date(byAdding: .day, value: offset, to: Date())!
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = calendar.timeZone
    if calendar.component(.month, from: monday) != calendar.component(.month, from: Date()) { app.buttons["calendar.next"].tap() }
    app.buttons["calendar.day." + f.string(from: monday)].tap()
    let course = app.staticTexts["コンピュータシステム"].firstMatch; scrollTo(course, in: app); XCTAssertTrue(course.exists); course.tap()
    XCTAssertTrue(app.staticTexts["大学公式（本人提供PDF）"].waitForExistence(timeout: 5))
  }

  func testMonthCalendarAccessibilityAudit() throws {
    guard #available(iOS 17.0, *) else { throw XCTSkip("XCTest accessibility audit requires iOS 17 or later") }
    let app = launch(); app.tabBars.buttons["予定"].tap()
    XCTAssertTrue(app.buttons["calendar.day." + japaneseToday()].waitForExistence(timeout: 5))
    try app.performAccessibilityAudit(for: [.sufficientElementDescription, .trait, .hitRegion, .textClipped]) { issue in
      print("Calendar accessibility issue: \(issue.compactDescription) \(issue.element?.debugDescription ?? "no element")")
      return false // Report every issue; do not suppress audit failures.
    }
  }

  func testOfficialSearchAddsThenNormalTimetableOpensVisibleTabs() {
    let app = launch(); app.tabBars.buttons["時間割"].tap(); app.buttons["講義を検索"].tap()
    let field = app.searchFields.firstMatch; XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("コンピュータシステム\n")
    XCTAssertTrue(app.buttons["コンピュータシステム"].firstMatch.waitForExistence(timeout: 5))
    let addButton = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "search.official.add.")).firstMatch
    scrollTo(addButton, in: app); XCTAssertTrue(addButton.isHittable); addButton.tap()
    if app.alerts.firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["OK"].tap() }
    let cell = app.buttons["timetable.cell.1.1"]; XCTAssertTrue(cell.waitForExistence(timeout: 10)); XCTAssertTrue(cell.label.contains("コンピュータシステム")); XCTAssertTrue(cell.label.contains("A21")); XCTAssertTrue(app.buttons["timetable.cell.3.3"].label.contains("A21"))
    let gridShot = XCTAttachment(screenshot: app.screenshot()); gridShot.name = "Official classroom in multiple timetable periods"; gridShot.lifetime = .keepAlways; add(gridShot); cell.tap()
    XCTAssertTrue(app.segmentedControls["lecture.tabs"].waitForExistence(timeout: 5))
    app.segmentedControls["lecture.tabs"].buttons["成績情報"].tap()
    XCTAssertTrue(app.staticTexts["評価基準"].waitForExistence(timeout: 5))
    app.segmentedControls["lecture.tabs"].buttons["講義情報"].tap()
    XCTAssertTrue(app.staticTexts["大学公式（本人提供PDF）"].waitForExistence(timeout: 5))
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Normal timetable official detail tabs"; shot.lifetime = .keepAlways; add(shot)
  }
  func testOfficialBulkAddKeepsSelectedCoursesAndRelaunches() {
    let app = launch(); app.tabBars.buttons["時間割"].tap()
    app.buttons["講義を追加"].tap(); let name = app.textFields["講義名"]; name.tap(); name.typeText("既存の授業"); app.buttons["保存"].firstMatch.tap()
    app.buttons["official.open"].tap()
    app.buttons["official.year"].tap(); app.buttons["3年"].firstMatch.tap()
    app.buttons["official.course"].tap(); app.buttons["情報理工学コース"].firstMatch.tap()
    let bulk = app.buttons["official.bulk"]; scrollTo(bulk, in: app); XCTAssertTrue(bulk.isEnabled); bulk.tap()
    app.buttons["既存の選択を残して一括追加"].tap()
    if app.alerts.firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["OK"].tap() }
    XCTAssertTrue(app.buttons["timetable.cell.1.1"].label.contains("既存の授業"))
    XCTAssertTrue(app.buttons["timetable.cell.2.3"].label.contains("データベースとWebインテリジェンス"))
    app.terminate(); app.launch(); app.tabBars.buttons["時間割"].tap()
    XCTAssertTrue(app.buttons["timetable.cell.1.1"].label.contains("既存の授業"))
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Bulk official courses and subject colors"; shot.lifetime = .keepAlways; add(shot)
  }
  func testTutorialCanCloseResumeAndFinishWithoutSharing() {
    let app = launch(); app.tabBars.buttons["設定"].tap(); let open = app.buttons["tutorial.open"]; scrollTo(open, in: app); open.tap()
    XCTAssertTrue(app.staticTexts["tutorial.step"].waitForExistence(timeout: 5)); app.buttons["tutorial.next"].tap()
    app.buttons["閉じる"].firstMatch.tap(); scrollTo(open, in: app); open.tap()
    XCTAssertTrue(app.staticTexts["tutorial.step"].label.contains("所属・学年"))
    for _ in 0..<4 { let next = app.buttons["tutorial.next"]; scrollTo(next, in: app); next.tap() }
    if app.alerts.firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["OK"].tap() }
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 5))
  }

  func testConflictingCourseCannotBeSavedAndOriginalRemains() {
    let app = launch(); app.tabBars.buttons["時間割"].tap()
    app.buttons["講義を追加"].tap(); app.textFields["講義名"].tap(); app.textFields["講義名"].typeText("QA教室A")
    app.textFields["教室"].tap(); app.textFields["教室"].typeText("A13"); app.buttons["保存"].firstMatch.tap()
    let cell = app.buttons["timetable.cell.1.1"]; XCTAssertTrue(cell.waitForExistence(timeout: 5)); XCTAssertTrue(cell.label.contains("A13"))
    app.buttons["講義を追加"].tap(); app.textFields["講義名"].tap(); app.textFields["講義名"].typeText("QA重複候補")
    XCTAssertFalse(app.buttons["保存"].firstMatch.isEnabled)
    let warning = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "同じ時限に")).firstMatch
    scrollTo(warning, in: app); XCTAssertTrue(warning.exists); app.buttons["キャンセル"].firstMatch.tap()
    XCTAssertTrue(cell.label.contains("QA教室A")); XCTAssertFalse(cell.label.contains("QA重複候補"))
    app.terminate(); app.launch(); app.tabBars.buttons["時間割"].tap()
    XCTAssertTrue(app.buttons["timetable.cell.1.1"].label.contains("A13"))
    XCTAssertFalse(app.buttons["timetable.cell.1.1"].label.contains("QA重複候補"))
  }

  func testWeeklyCalendarAndUnscheduledClubEntry() {
    let app = launch(); app.tabBars.buttons["予定"].tap()
    app.segmentedControls["calendar.layout"].buttons["週間"].tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "calendar.week").firstMatch.waitForExistence(timeout: 5))
    app.buttons["calendar.nextWeek"].tap(); app.buttons["calendar.previousWeek"].tap()
    app.tabBars.buttons["設定"].tap(); let entry = app.buttons["campus.open"]; scrollTo(entry, in: app); entry.tap()
    XCTAssertTrue(app.buttons["campus.add"].waitForExistence(timeout: 5)); app.buttons["campus.add"].tap()
    app.textFields["サークル名"].tap(); app.textFields["サークル名"].typeText("QA撮影用サークル")
    app.buttons["保存"].firstMatch.tap(); XCTAssertTrue(app.staticTexts["QA撮影用サークル"].firstMatch.waitForExistence(timeout: 5))
    app.navigationBars.buttons.firstMatch.tap(); app.tabBars.buttons["時間割"].tap()
    for day in 1...5 { for period in 1...5 { XCTAssertFalse(app.buttons["timetable.cell.\(day).\(period)"].label.contains("QA撮影用サークル")) } }
  }

  func testQRPreviewHasImageReaderAndExplicitShareWithoutPosting() {
    let app = launch(); app.tabBars.buttons["時間割"].tap(); app.buttons["講義を追加"].tap()
    app.textFields["講義名"].tap(); app.textFields["講義名"].typeText("QA時間割QR")
    app.buttons["保存"].firstMatch.tap(); app.buttons["timetable.qr"].tap()
    XCTAssertTrue(app.buttons["qr.share"].waitForExistence(timeout: 5))
    let reader = app.buttons["qr.read"]; scrollTo(reader, in: app); XCTAssertTrue(reader.exists)
    // Never opens a real SNS recipient, sends a post, imports a timetable or uses camera access.
  }

  func testDarkSettingsAndTutorialUseReadableSurfaces() {
    let app = launch(); app.tabBars.buttons["設定"].tap()
    let settings = XCTAttachment(screenshot: app.screenshot()); settings.name = "Soft charcoal settings and fields"; settings.lifetime = .keepAlways; add(settings)
    let open = app.buttons["tutorial.open"]; scrollTo(open, in: app); open.tap()
    XCTAssertTrue(app.staticTexts["tutorial.step"].waitForExistence(timeout: 5))
    let tutorial = XCTAttachment(screenshot: app.screenshot()); tutorial.name = "Soft charcoal tutorial sheet"; tutorial.lifetime = .keepAlways; add(tutorial)
  }

  func testTodayShowsFivePeriodsInOrderOnEmptyDay() {
    let app = launch(); app.tabBars.buttons["今日"].tap()
    for period in 1...5 { let label = app.descendants(matching: .any).matching(identifier: "today.period.\(period)").firstMatch; scrollTo(label, in: app); XCTAssertTrue(label.exists) }
    XCTAssertTrue(app.staticTexts["空きコマ"].firstMatch.exists)
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Today periods one through five with empty slots"; shot.lifetime = .keepAlways; add(shot)
  }

  func testFirstTutorialGuestChoicePersistsAfterCompletion() {
    let app = XCUIApplication(); app.launchArguments = ["-haskapp-ui-tests", "-haskapp-ui-tutorial", "-haskapp-ui-test-namespace", UUID().uuidString]; app.launch()
    let guest = app.buttons["ゲストで続ける"]; XCTAssertTrue(guest.waitForExistence(timeout: 30)); guest.tap()
    for _ in 0..<4 { let next = app.buttons["tutorial.next"]; scrollTo(next, in: app); next.tap() }
    if app.alerts.firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["OK"].tap() }
    XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 10)); XCTAssertFalse(app.buttons["auth.guest"].exists)
    app.terminate(); app.launch(); XCTAssertTrue(app.tabBars.buttons["時間割"].waitForExistence(timeout: 10)); XCTAssertFalse(app.staticTexts["tutorial.step"].exists)
  }

}
