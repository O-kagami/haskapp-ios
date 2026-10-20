const test=require('node:test');const assert=require('node:assert/strict');
const {environment,OWNER,OTHER,lecture,task}=require('./helpers/engine-integration.cjs');
const {loadTs}=require('./helpers/load-ts.cjs');
const {effectiveTimetable,timetableViewKey}=loadTs('src/timetable-view.ts');
const course=require('../data/official-timetable-2026-semester2.json').courses.find(c=>c.openingTerm==='秋'&&c.slots.length>1);
const term='2026年度 2学期（秋ターム）';
const replace={type:'replaceTimetable',payload:{term,ids:[course.id]}};
test('replacement persists the complete prior timetable before showing all selected weekly slots; original records and DB stay intact',async t=>{
 const original=lecture({memo:'keep memo',grading_test:80}),originalTask=task();
 const h=environment(t,{disk:[[ `haskapp_classes_${OWNER}`,JSON.stringify([original])],[`haskapp_tasks_${OWNER}`,JSON.stringify([originalTask])]]});
 let {engine}=await h.boot();const dbBefore=JSON.stringify(h.db);
 let sawDurable=false;engine.subscribe(s=>{if(s.timetableView.terms[term]){assert.ok(h.disk.has(timetableViewKey(OWNER)));sawDurable=true;}});
 await engine.dispatch(replace);assert.equal(sawDurable,true);
 assert.deepEqual(engine.state.lectures,[original]);assert.deepEqual(engine.state.tasks,[originalTask]);
 assert.equal(effectiveTimetable(engine.state.lectures,engine.state.timetableView).length,course.slots.length);
 assert.deepEqual(engine.state.timetableView.undo.rows,[original]);
 assert.equal(JSON.stringify(h.db),dbBefore);assert.equal(h.requests.filter(q=>q.operation!=='select').length,0);
 ({engine}=await h.boot());assert.equal(engine.state.timetableView.terms[term].length,course.slots.length);
 await engine.dispatch({type:'undoTimetable',payload:{}});assert.deepEqual(effectiveTimetable(engine.state.lectures,engine.state.timetableView),[original]);
 h.setOwner(OTHER);await engine.loadAccount();assert.deepEqual(engine.state.timetableView.terms,{});
});
test('invalid or overlapping replacement cannot publish or overwrite the recovery journal',async t=>{
 const h=environment(t);const {engine}=await h.boot();
 await engine.dispatch({type:'replaceTimetable',payload:{term,ids:['unknown']}});
 assert.equal(h.disk.has(timetableViewKey(OWNER)),false);
 const {replacingTimetable,emptyTimetableView}=loadTs('src/timetable-view.ts');
 assert.throws(()=>replacingTimetable(emptyTimetableView(),[],term,[lecture(),lecture({id:'other'})]),/同じターム/);
 assert.deepEqual(engine.state.timetableView.terms,{});
});
test('disk failure retains the old display and source data; a failed replacement cannot appear after restart',async t=>{
 const original=lecture();const h=environment(t,{disk:[[ `haskapp_classes_${OWNER}`,JSON.stringify([original])]]});let {engine}=await h.boot();
 h.hooks.beforeWrite=async(key,value)=>{if(key===timetableViewKey(OWNER)&&value!==null)throw Error('disk full');};
 await engine.dispatch(replace);assert.deepEqual(engine.state.timetableView.terms,{});assert.deepEqual(engine.state.lectures,[original]);
 assert.equal(h.disk.has(timetableViewKey(OWNER)),false);
 h.hooks.beforeWrite=undefined;({engine}=await h.boot());assert.deepEqual(effectiveTimetable(engine.state.lectures,engine.state.timetableView),[original]);
});
test('account switch during durable write cannot publish another owner’s replacement',async t=>{
 const h=environment(t);const {engine}=await h.boot();let switched=false;
 h.hooks.beforeWrite=async key=>{if(key===timetableViewKey(OWNER)&&!switched){switched=true;h.setOwner(OTHER);}};
 await engine.dispatch(replace);assert.deepEqual(engine.state.timetableView.terms,{});
 assert.equal(h.disk.has(timetableViewKey(OWNER)),false);assert.equal(h.disk.has(timetableViewKey(OTHER)),false);
});

test('cancel is non-mutating and rows added later remain visible alongside a replacement',async t=>{
 const h=environment(t);const {engine}=await h.boot();const before=JSON.stringify([...h.disk]);
 // Preview is pure; cancelling never dispatches a replacement action.
 const {replacingTimetable}=loadTs('src/timetable-view.ts');
 replacingTimetable(engine.state.timetableView,[],term,[lecture()]);assert.equal(JSON.stringify([...h.disk]),before);
 await engine.dispatch(replace);
 const later=lecture({id:'later',day_of_the_week:5,period:5});engine.state.lectures.push(later);
 assert.ok(effectiveTimetable(engine.state.lectures,engine.state.timetableView).some(row=>row.id==='later'));
 await engine.dispatch({type:'undoTimetable',payload:{}});
 assert.equal(effectiveTimetable(engine.state.lectures,engine.state.timetableView).length,0);
 await engine.dispatch({type:'undoTimetable',payload:{}});
 assert.ok(effectiveTimetable(engine.state.lectures,engine.state.timetableView).some(row=>row.id==='later'));
});
