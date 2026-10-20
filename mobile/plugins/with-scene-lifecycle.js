const {withInfoPlist,withAppDelegate}=require('@expo/config-plugins');
function patchAppDelegate(source){
 const classPattern=/class AppDelegate:\s*ExpoAppDelegate\s*\{/;
 const alreadyAdopted=/class AppDelegate:\s*ExpoAppDelegate\s*,\s*ExpoReactNativeFactoryProvider\s*\{/.test(source);
 if(!alreadyAdopted && !classPattern.test(source))throw new Error('Scene lifecycle plugin requires the generated Swift Expo AppDelegate. Inspect the SDK template before upgrading.');
 if(!/reactNativeFactory\s*=\s*factory/.test(source))throw new Error('Scene lifecycle plugin could not locate the Expo React Native factory.');
 const adopted=source.replace(classPattern,'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
 const patched=adopted.replace(/#if os\(iOS\) \|\| os\(tvOS\)\r?\n\s*window = UIWindow\(frame: UIScreen.main.bounds\)[\s\S]*?#endif/, '// ExpoAppSceneDelegate creates the scene window and starts React Native.');
 if(/window\s*=\s*UIWindow\(frame:/.test(patched) || /factory\.startReactNative\(/.test(patched))throw new Error('Scene lifecycle plugin could not safely remove the old window startup block.');
 return patched;
}
module.exports=function withSceneLifecycle(config){
 config=withInfoPlist(config,c=>{c.modResults.UIApplicationSceneManifest={UIApplicationSupportsMultipleScenes:false,UISceneConfigurations:{UIWindowSceneSessionRoleApplication:[{UISceneConfigurationName:'Default Configuration',UISceneDelegateClassName:'EXExpoAppSceneDelegate'}]}};return c});
 return withAppDelegate(config,c=>{
  if(c.modResults.language!=='swift')throw new Error('Haskapp requires the Swift Expo AppDelegate.');
  c.modResults.contents=patchAppDelegate(c.modResults.contents);
  return c;
 });
};
module.exports.patchAppDelegate=patchAppDelegate;
