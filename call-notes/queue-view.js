'use strict';
(function(root){
  function group(item){
    if(item.trashedAt||item.status==='done')return null;
    if(['queued','skipped','processing'].includes(item.status))return 'analysis';
    if(['ready','writing'].includes(item.status))return 'ready';
    return 'attention';
  }
  function inbox(items,filter='all'){return items.filter(i=>group(i)&&(filter==='all'||group(i)===filter));}
  function eligible(item,action){
    if(item.trashedAt)return false;
    if(action==='resummarize')return !!(item.hasTranscript||item.transcript?.trim())&&!['done','uncertain','invalid','processing','writing'].includes(item.status);
    return action==='analysis'?(item.hasSource||!!item.file)&&!['done','uncertain','invalid','processing','writing'].includes(item.status):item.status==='ready'&&!!item.recordId;
  }
  function actionIds(items,ids,action){
    if(!Array.isArray(ids))throw Error('请在当前列表勾选项目后操作');
    const wanted=new Set(ids);
    return items.filter(i=>wanted.has(i.id)&&i.selectedItem&&eligible(i,action)).map(i=>i.id);
  }
  function displayName(item){
    const value=String(item.customer||item.meta?.sourceLabel||item.filename||'未命名录音').replace(/\.[^.]+$/,'');
    return /^(?:\+?86)?1[3-9]\d{9}$/.test(value)?value.replace(/^(?:\+?86)?(\d{3})\d{4}(\d{4})$/,'$1****$2'):value;
  }
  function dateValue(date){const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)throw Error('日期格式无效');return Date.UTC(+m[1],+m[2]-1,+m[3]);}
  function dateKey(ms){return new Date(ms).toISOString().slice(0,10);}
  function calendarItems(items){return items.filter(i=>!i.trashedAt&&i.meta?.date&&Number.isFinite(i.meta?.epoch));}
  function calendarRange(items,start,count){
    const rows=calendarItems(items),base=dateValue(start);
    return Array.from({length:count},(_,n)=>{const date=dateKey(base+n*86400000),dayItems=rows.filter(i=>i.meta.date===date).sort((a,b)=>a.meta.epoch-b.meta.epoch);return {date,count:dayItems.length,items:dayItems};});
  }
  function calendarMonth(items,anchor){
    const base=dateValue(anchor),d=new Date(base),first=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1),weekday=(new Date(first).getUTCDay()+6)%7,start=first-weekday*86400000,month=d.getUTCMonth();
    return calendarRange(items,dateKey(start),42).map(day=>({...day,inMonth:new Date(dateValue(day.date)).getUTCMonth()===month}));
  }
  const api={group,inbox,eligible,actionIds,displayName,calendarItems,calendarRange,calendarMonth};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.crmView=api;
})(typeof window==='object'?window:globalThis);
