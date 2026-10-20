import ExpoModulesCore
import SwiftUI

public class HaskappNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HaskappNative")
    Function("isReadOnlyOffline") { ProcessInfo.processInfo.arguments.contains("-haskapp-readonly-grade-offline") }
    Function("isReadOnlyVerification") { ProcessInfo.processInfo.arguments.contains("-haskapp-readonly-grade-verification") }
    Function("isUITest") { ProcessInfo.processInfo.arguments.contains("-haskapp-ui-tests") }
    Function("uiTestNamespace") { () -> String? in
      let arguments = ProcessInfo.processInfo.arguments
      guard arguments.contains("-haskapp-ui-tests"),
            let index = arguments.firstIndex(of: "-haskapp-ui-test-namespace"),
            arguments.indices.contains(index + 1),
            let namespace = UUID(uuidString: arguments[index + 1]) else { return nil }
      return namespace.uuidString.lowercased()
    }
    View(HaskappNativeView.self) {
      Events("onAction")
      Prop("snapshot") { (view: HaskappNativeView, value: String) in if let fixture = view.fixture { fixture.receive(value) } else { view.store.receive(value) } }
    }
  }
}
class HaskappNativeView: ExpoView {
  let onAction = EventDispatcher()
  let store = PlannerStore()
  var fixture: PlannerUITestFixture?
  private var host: UIHostingController<PlannerRoot>!
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    fixture = PlannerUITestFixture.make(store: store)
    store.send = { [weak self] action in
      if let fixture = self?.fixture { fixture.action(action) } else { self?.onAction(["action":action]) }
    }
    host = UIHostingController(rootView: PlannerRoot(store: store))
    PlannerPalette.configureNativeSurfaces()
    backgroundColor = PlannerPalette.backgroundUIColor
    host.view.backgroundColor = PlannerPalette.backgroundUIColor
    addSubview(host.view)
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, host.parent == nil {
      var responder: UIResponder? = self
      while let r = responder { if let controller = r as? UIViewController { controller.addChild(host); host.didMove(toParent:controller); break }; responder=r.next }
    } else if window == nil, host.parent != nil {host.willMove(toParent:nil);host.removeFromParent()}
  }
  override func layoutSubviews() { super.layoutSubviews(); host.view.frame = bounds }
}
