const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function privateBackend(identity,rows={private_profile_settings:[],personal_timetable_entries:[]}){
 const calls=[],hooks={};
 const from=table=>{
  const q={table,op:'select',filters:[],payload:null,one:false};const b={
   select(){return b},order(){return b},eq(k,v){q.filters.push([k,v]);return b},is(k,v){return b.eq(k,v)},filter(k,op,v){return b.eq(k,JSON.parse('['+v.slice(1,-1)+']'))},
   insert(v){q.op='insert';q.payload=clone(v);return b},update(v){q.op='update';q.payload=clone(v);return b},delete(){q.op='delete';return b},single(){q.one=true;return b},maybeSingle(){q.one=true;return b},
   then(resolve,reject){return Promise.resolve().then(async()=>{
    calls.push(clone(q));if(hooks.before)await hooks.before(q);const u=identity();
    if(!u||u.is_anonymous)return {data:null,error:{code:'42501'}};
    const data=rows[table]??(rows[table]=[]);let matched=data.filter(r=>r.owner_id===u.id&&q.filters.every(([k,v])=>JSON.stringify(r[k]??null)===JSON.stringify(v??null)));
    if(q.op==='insert'){
     if(q.payload.owner_id!==u.id)return {data:null,error:{code:'42501'}};
     const key=table==='private_profile_settings'?'owner_id':'id';if(data.some(r=>r[key]===q.payload[key]))return {data:null,error:{code:'23505'}};
     matched=[clone(q.payload)];data.push(...matched);
    }
    if(q.op==='update'){if(Object.keys(q.payload).some(k=>['owner_id','id','created_at'].includes(k)))return {data:null,error:{code:'42501'}};matched.forEach(r=>Object.assign(r,q.payload));}
    if(q.op==='delete')rows[table]=data.filter(r=>!matched.includes(r));
    if(hooks.after)await hooks.after(q);return {data:clone(q.one?matched[0]??null:matched),error:null};
   }).then(resolve,reject)}
  };return b;
 };
 return {from,rows,calls,hooks};
}
module.exports={privateBackend};
