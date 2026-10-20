const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('./helpers/load-ts.cjs');
function setup(t,initial={}){
 const disk=new Map(Object.entries(initial)),calls=[],hooks={};
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 t.after(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage});
 const api={
  getAllKeys:async()=>{calls.push(['keys']);if(hooks.keys)await hooks.keys();return [...disk.keys()]},
  multiGet:async keys=>{calls.push(['get',keys]);return keys.map(k=>[k,disk.get(k) ?? null])},
  setItem:async(k,v)=>{calls.push(['set',k,v]);if(hooks.set)await hooks.set(k,v);disk.set(k,v)},
  removeItem:async k=>{calls.push(['remove',k]);if(hooks.remove)await hooks.remove(k);disk.delete(k)}
 };
 const storage=loadTs('src/storage.ts',{'@react-native-async-storage/async-storage':api});
 return {...storage,disk,calls,hooks};
}
test('hydration loads only Haskapp keys and reuses one in-flight initialization',async t=>{
 const {hydrateStorage,calls}=setup(t,{haskapp_tasks_owner:'[]',other_app:'private'});
 const first=hydrateStorage(),second=hydrateStorage();assert.equal(first,second);await Promise.all([first,second]);assert.equal(localStorage.getItem('haskapp_tasks_owner'),'[]');assert.equal(localStorage.getItem('other_app'),null);assert.equal(calls.filter(c=>c[0]==='keys').length,1);
});
test('a repeated hydration does not replace pending in-memory edits with stale disk data',async t=>{
 const {hydrateStorage,flushStorage,hooks}=setup(t,{haskapp_value:'old'});await hydrateStorage();let release;hooks.set=()=>new Promise(r=>{release=r});localStorage.setItem('haskapp_value','new');await hydrateStorage();assert.equal(localStorage.getItem('haskapp_value'),'new');release();await flushStorage();
});
test('failed durable writes surface and retry on the next flush',async t=>{
 const {hydrateStorage,flushStorage,disk,hooks}=setup(t);await hydrateStorage();hooks.set=async()=>{throw Error('disk full')};localStorage.setItem('haskapp_tasks_owner','pending data');await assert.rejects(flushStorage(),/disk full/);assert.equal(localStorage.getItem('haskapp_tasks_owner'),'pending data');assert.equal(disk.has('haskapp_tasks_owner'),false);hooks.set=undefined;await flushStorage();assert.equal(disk.get('haskapp_tasks_owner'),'pending data');
});
test('failed removals retry without resurrecting deleted in-memory data',async t=>{
 const {hydrateStorage,flushStorage,disk,hooks}=setup(t,{haskapp_old:'value'});await hydrateStorage();hooks.remove=async()=>{throw Error('busy')};localStorage.removeItem('haskapp_old');await assert.rejects(flushStorage(),/busy/);assert.equal(localStorage.getItem('haskapp_old'),null);assert.equal(disk.get('haskapp_old'),'value');hooks.remove=undefined;await flushStorage();assert.equal(disk.has('haskapp_old'),false);
});
test('a newer successful value supersedes failure of an older queued value',async t=>{
 const {hydrateStorage,flushStorage,disk,hooks}=setup(t);await hydrateStorage();hooks.set=async(_,value)=>{if(value==='old')throw Error('transient')};localStorage.setItem('haskapp_value','old');localStorage.setItem('haskapp_value','latest');await flushStorage();assert.equal(disk.get('haskapp_value'),'latest');
});
test('flush waits for writes enqueued while an earlier write is still running',async t=>{
 const {hydrateStorage,flushStorage,disk,hooks}=setup(t);await hydrateStorage();let release;hooks.set=async(key)=>{if(key==='haskapp_first')await new Promise(r=>{release=r})};localStorage.setItem('haskapp_first','one');const flushed=flushStorage();await Promise.resolve();localStorage.setItem('haskapp_second','two');release();await flushed;assert.equal(disk.get('haskapp_second'),'two');
});
test('hydration can recover from a read failure without installing a partial adapter',async t=>{
 const {hydrateStorage,hooks}=setup(t,{haskapp_ok:'value'});const before=globalThis.localStorage;hooks.keys=async()=>{throw Error('locked')};await assert.rejects(hydrateStorage(),/locked/);assert.equal(globalThis.localStorage,before);hooks.keys=undefined;await hydrateStorage();assert.equal(localStorage.getItem('haskapp_ok'),'value');
});
test('account-scoped writes and deletes remain distinct and ordered',async t=>{
 const {hydrateStorage,flushStorage,disk}=setup(t);await hydrateStorage();localStorage.setItem('haskapp_tasks_first','first');localStorage.setItem('haskapp_tasks_second','second');localStorage.removeItem('haskapp_tasks_first');localStorage.setItem('haskapp_tasks_first','replacement');await flushStorage();assert.equal(disk.get('haskapp_tasks_first'),'replacement');assert.equal(disk.get('haskapp_tasks_second'),'second');
});

test('unscoped profile compatibility keys remain in memory and never overwrite another session on disk',async t=>{
 const {hydrateStorage,flushStorage,disk,calls}=setup(t,{haskapp_faculty_name:'previous account'});await hydrateStorage();assert.equal(localStorage.getItem('haskapp_faculty_name'),null);localStorage.setItem('haskapp_faculty_name','current guest');localStorage.setItem('haskapp_share_templates','false');await flushStorage();assert.equal(localStorage.getItem('haskapp_faculty_name'),'current guest');assert.equal(disk.get('haskapp_faculty_name'),'previous account');assert.equal(calls.filter(c=>['set','remove'].includes(c[0])).length,0);
});
