const test = require('node:test');
const assert = require('node:assert/strict');
const { patchAppDelegate } = require('../plugins/with-scene-lifecycle');

const template = `import Expo
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?
  func launch() {
    let factory = ExpoReactNativeFactory(delegate: delegate)
    reactNativeFactory = factory
    #if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
    #endif
  }
}`;

test('scene plugin adopts the Expo scene factory and removes double-start window code', () => {
  const result = patchAppDelegate(template);
  assert.match(result, /ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
  assert.match(result, /reactNativeFactory = factory/);
  assert.doesNotMatch(result, /UIWindow\(frame:|factory\.startReactNative/);
  assert.equal(patchAppDelegate(result), result);
  assert.equal(patchAppDelegate(template.replaceAll('\n', '\r\n')).includes('factory.startReactNative'), false);
});

test('scene plugin fails loudly when a future SDK template cannot be patched safely', () => {
  assert.throws(() => patchAppDelegate('class AppDelegate: OtherDelegate {}'), /requires the generated Swift/);
  assert.throws(() => patchAppDelegate(template.replace('reactNativeFactory = factory', '')), /could not locate/);
  assert.throws(() => patchAppDelegate(template.replace('#if os(iOS) || os(tvOS)', '#if os(iOS)')), /could not safely remove/);
});
