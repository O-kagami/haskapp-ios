const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('./helpers/load-ts.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function mount(){
 const hydration=deferred(),initialization=deferred(),initialURL=deferred(),calls=[],messages=[],listeners={},removed=[];
 let effect;
 const fakeEngine={subscribe(){},initialize(){calls.push('initialize');return initialization.promise},foreground(){},dispatch(action){calls.push(action);return Promise.resolve()},notify(message){messages.push(message)}};
 const {default:App}=loadTs('App.tsx',{
  'react-native-url-polyfill/auto':{},
  react:{__esModule:true,default:{},useEffect(callback){effect=callback},useState(){return [undefined,()=>{}]}},
  'react-native':{AppState:{addEventListener:(type,callback)=>{listeners.state=callback;return {remove(){removed.push('state')}}}},Linking:{addEventListener:(type,callback)=>{listeners.url=callback;return {remove(){removed.push('url')}}},getInitialURL:()=>initialURL.promise},View:'View',Text:'Text',ActivityIndicator:'ActivityIndicator'},
  'expo-modules-core':{requireNativeViewManager:()=> 'NativePlanner'},
  './src/storage':{hydrateStorage:()=>hydration.promise,flushStorage:async()=>{}},'./src/engine':{engine:fakeEngine},
 });
 App();const unmount=effect();return {hydration,initialization,initialURL,calls,messages,listeners,removed,unmount};
}
test('cold and runtime auth links wait until hydration and engine initialization complete',async()=>{
 const h=mount();h.initialURL.resolve('haskapp://auth/callback?code=cold');h.listeners.url({url:'haskapp://auth/callback?code=runtime'});await tick();assert.equal(h.calls.length,0);h.hydration.resolve();await tick();assert.deepEqual(h.calls,['initialize']);h.initialization.resolve();await tick();assert.deepEqual(h.calls.slice(1).map(action=>action.type),['authCallback','authCallback']);assert.deepEqual(new Set(h.calls.slice(1).map(action=>action.payload.url)),new Set(['haskapp://auth/callback?code=cold','haskapp://auth/callback?code=runtime']));h.unmount();assert.deepEqual(h.removed,['state','url']);
});
test('unmount cancels pending link handling and removes both native listeners',async()=>{
 const h=mount();h.listeners.url({url:'haskapp://auth/callback?code=late'});h.unmount();h.initialURL.resolve('haskapp://auth/callback?code=cold');h.hydration.resolve();h.initialization.resolve();await tick();assert.equal(h.calls.filter(call=>typeof call==='object').length,0);assert.deepEqual(h.removed,['state','url']);assert.equal(h.messages.length,0);
});
test('failed hydration never sends auth codes to an uninitialized engine',async()=>{
 const h=mount();h.initialURL.resolve('haskapp://auth/callback?code=cold');h.hydration.reject(Error('disk unavailable'));await tick();assert.equal(h.calls.length,0);assert.equal(h.messages.length,1);h.unmount();
});
