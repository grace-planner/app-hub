import {callOutcome} from './core.js?v=20261120-call-outcome';
'use strict';
const $=id=>document.getElementById(id);
let defaultNextDate='';
let currentItems=[],currentDraftId=null,currentLinkId=null,currentPreserved={},page='inbox',filter='all',wasRunning=false,calendarMode='1',calendarAnchor=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
const labels={queued:'待分析',processing:'处理中',ready:'待保存',review:'需核对',writing:'保存中',done:'已归档',skipped:'未分析',ambiguous:'匹配有歧义',awaiting_link:'待关联客户',error:'失败',invalid:'文件不支持',uncertain:'需确认结果'};
async function call(c,...args){const r=await window.crm.call(c,...args);if(!r.ok)throw Error(r.error);return r.data;}
function notice(t){$('notice').textContent=t||'';}
function action(fn){return async()=>{try{notice('');await fn();}catch(e){notice(e.message);}};}
const filterLabels={all:'全部待办',analysis:'待分析',ready:'待保存',attention:'待核对／异常'};
function visibleItems(){if(page==='calendar')return[];return page==='inbox'?window.crmView.inbox(currentItems,filter):currentItems.filter(i=>page==='trash'?!!i.trashedAt:!i.trashedAt&&i.status==='done');}
function eligible(i,p){return window.crmView.eligible(i,p);}
function selectedIds(p){return visibleItems().filter(i=>i.selectedItem&&eligible(i,p)).map(i=>i.id);}
function selectionInfo(){
  const visible=visibleItems(),selected=visible.filter(i=>i.selectedItem),active=page==='inbox';
  for(const name of ['inbox','calendar','archive','trash'])$('nav-'+name).classList.toggle('active',page===name);
  $('queue-panel').hidden=page==='calendar';$('calendar-panel').hidden=page!=='calendar';
  if(page==='calendar'){$('stats').hidden=true;return;}
  $('page-title').textContent=(active?filterLabels[filter]:{archive:'已归档',trash:'回收站'}[page])+` · ${visible.length} 条`;
  $('stats').hidden=!active;
  for(const name of Object.keys(filterLabels)){$('filter-'+name).classList.toggle('selected',active&&filter===name);$('filter-'+name).setAttribute('aria-pressed',String(active&&filter===name));}
  $('mode').textContent={inbox:'统一勾选，选择分析、保存或移除',archive:'可清理录音引用，保留已归档文字结果',trash:'可恢复或永久清空；原始录音和飞书记录保持不变'}[page];
  $('selection-help').textContent=wasRunning?'正在处理，请等当前操作结束。':`当前页面已选 ${selected.length} 项。`+(active?'分析处理可分析的录音；保存仅处理已核对并关联客户的草稿。':'移除和恢复仅影响本浏览器列表。');
  const analysis=selected.filter(i=>eligible(i,'analysis')).length,save=selected.filter(i=>eligible(i,'save')).length;
  $('process').textContent=`分析选中录音（${analysis}条）`;$('commit').textContent=`保存选中草稿（${save}条）`;
  for(const id of ['process','commit','stop'])$(id).hidden=!active;
  $('process').disabled=wasRunning||!analysis;$('commit').disabled=wasRunning||!save;$('stop').disabled=!wasRunning;
  $('import').hidden=!active;$('import').disabled=wasRunning;
  $('remove-items').hidden=page==='trash';$('restore-items').hidden=page!=='trash';
  $('clean-archive').hidden=page!=='archive';$('empty-trash').hidden=page!=='trash';
  $('clean-archive').disabled=wasRunning||!visible.some(i=>i.hasSource);$('empty-trash').disabled=wasRunning||!visible.length;
  for(const id of ['remove-items','restore-items'])$(id).disabled=wasRunning||!selected.length;
  for(const id of ['select-all','select-none'])$(id).disabled=wasRunning||!visible.length;
}
function shiftDate(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function shiftMonth(date,months){const d=new Date(date+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString().slice(0,10);}
function shortDate(date){return new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',month:'numeric',day:'numeric',weekday:'short'}).format(new Date(date+'T00:00:00Z'));}
function scheduleCard(item){
  const node=document.createElement(item.draft?'button':'div');node.className='schedule-card '+item.status;
  const time=document.createElement('time');time.textContent=item.meta.stamp.slice(11);const name=document.createElement('b');name.textContent=window.crmView.displayName(item);const state=document.createElement('span');state.textContent=labels[item.status]||item.status;
  node.append(time,name,state);if(item.draft){node.type='button';node.onclick=action(()=>openDraft(item));node.title='查看通话详情';}return node;
}
function renderCalendar(){
  const host=$('calendar-view');host.replaceChildren();$('calendar-date').value=calendarAnchor;
  for(const button of document.querySelectorAll('[data-calendar-mode]'))button.classList.toggle('selected',button.dataset.calendarMode===calendarMode);
  if(calendarMode==='month'){
    const days=window.crmView.calendarMonth(currentItems,calendarAnchor),month=calendarAnchor.slice(0,7),total=days.filter(d=>d.inMonth).reduce((n,d)=>n+d.count,0);
    $('calendar-title').textContent=calendarAnchor.slice(0,4)+'年'+Number(calendarAnchor.slice(5,7))+'月';$('calendar-total').textContent=`本月共 ${total} 条录音`;
    const grid=document.createElement('div');grid.className='month-grid';for(const w of ['一','二','三','四','五','六','日']){const h=document.createElement('div');h.className='weekday';h.textContent='周'+w;grid.append(h);}
    for(const day of days){const cell=document.createElement('button');cell.type='button';cell.className='month-day'+(day.inMonth?'':' outside')+(day.date===calendarAnchor?' selected':'');const head=document.createElement('span');head.className='month-day-head';head.innerHTML=`<b>${Number(day.date.slice(8))}</b><em>${day.count?day.count+'条':''}</em>`;const names=document.createElement('span');names.className='month-names';names.textContent=day.items.slice(0,3).map(window.crmView.displayName).join('\n')+(day.count>3?`\n另 ${day.count-3} 条`:'' );cell.append(head,names);cell.onclick=()=>{calendarAnchor=day.date;calendarMode='1';renderCalendar();};grid.append(cell);}host.append(grid);return;
  }
  const count=Number(calendarMode),days=window.crmView.calendarRange(currentItems,calendarAnchor,count),total=days.reduce((n,d)=>n+d.count,0);$('calendar-title').textContent=count===1?shortDate(calendarAnchor):`${shortDate(days[0].date)} — ${shortDate(days.at(-1).date)}`;$('calendar-total').textContent=`当前范围共 ${total} 条录音`;
  const grid=document.createElement('div');grid.className='schedule-grid columns-'+count;for(const day of days){const column=document.createElement('section');column.className='schedule-day';const head=document.createElement('header');head.innerHTML=`<b>${shortDate(day.date)}</b><span>${day.count} 条</span>`;column.append(head);if(!day.items.length){const empty=document.createElement('p');empty.className='schedule-empty';empty.textContent='没有录音';column.append(empty);}for(const item of day.items)column.append(scheduleCard(item));grid.append(column);}host.append(grid);
}
function render(items){
  currentItems=items;selectionInfo();
  $('count-all').textContent=window.crmView.inbox(items).length;
  for(const [name,id] of [['analysis','count-analysis'],['ready','count-ready'],['attention','count-review']])$(id).textContent=window.crmView.inbox(items,name).length;
  if(page==='calendar'){renderCalendar();return;}
  const container=$('queue');container.replaceChildren();
  const visible=visibleItems();
  if(!visible.length){const empty=document.createElement('div');empty.className='empty';empty.textContent={inbox:filter==='all'?'没有待处理录音，可以批量导入。':'当前筛选没有录音。',archive:'暂无已归档项目。',trash:'回收站为空。'}[page];container.append(empty);}
  for(const i of [...visible].reverse()){
    const row=document.createElement('div');row.className='item';
    const check=document.createElement('input');check.type='checkbox';check.className='row-check';check.checked=!!i.selectedItem;check.disabled=wasRunning;check.setAttribute('aria-label','选择 '+(i.customer||i.filename));
    check.onchange=action(()=>call('select',[i.id],'items',check.checked));
    const info=document.createElement('div');info.className='info';const title=document.createElement('h3');title.textContent=i.customer||i.filename;
    const meta=document.createElement('div');meta.className='meta';meta.textContent=i.meta?`${i.meta.stamp} · ${i.meta.phone?i.meta.phone.replace(/(\d{3})\d{4}(\d{4})/,'$1****$2'):'无号码 · 可手动关联'}`:i.filename;
    const text=document.createElement('p');text.textContent=i.message+(i.draft?.summary?'\n'+i.draft.summary:'');info.append(title,meta,text);
    const status=document.createElement('span');status.className='badge '+i.status;status.textContent=labels[i.status]||i.status;
    const buttons=document.createElement('div');buttons.className='row-actions';
    if(i.draft){const b=document.createElement('button');b.textContent='查看';b.disabled=wasRunning;b.onclick=action(()=>openDraft(i));buttons.append(b);}
    if(i.draft&&!i.trashedAt&&['ready','review','awaiting_link'].includes(i.status)){
      const b=document.createElement('button');b.textContent='重新生成摘要';b.disabled=wasRunning;
      b.onclick=action(async()=>{if(!confirm('用当前转写重新生成摘要（不重新转写、不写飞书），继续吗？'))return;await call('regenerate-summary',i.id);notice('摘要已重新生成');});
      buttons.append(b);
    }
    if(!i.trashedAt&&i.meta&&i.status!=='done'&&i.status!=='uncertain'){
      const b=document.createElement('button');b.textContent=i.recordId?'更换关联':'关联客户';b.disabled=wasRunning;b.onclick=action(async()=>{currentLinkId=i.id;$('link-query').value='';$('link-results').replaceChildren();$('link').showModal();if(i.matchCount>1&&i.meta?.phone)renderCandidates(await call('matches',i.id));});buttons.append(b);
    }
    if(!i.trashedAt&&['error','uncertain','skipped','ambiguous'].includes(i.status)){
      const b=document.createElement('button');b.textContent=i.status==='uncertain'?'核对后恢复':'重新排队';b.disabled=wasRunning;
      b.onclick=action(async()=>{if(i.status==='uncertain'&&!confirm('先在飞书确认该条写入结果，再恢复。程序会比对日志避免重复。确认恢复？'))return;await call('retry',i.id);});buttons.append(b);
    }
    row.append(check,info,status,buttons);container.append(row);
  }
}
async function fillSettings(){
  const state=await call('state');const f=$('settings-form');for(const [k,v]of Object.entries(state.settings))if(f.elements[k])f.elements[k].value=v;
  f.elements.aliyunKey.value='';$('aliyun-key-state').textContent=state.hasAliyunKey?'同一把密钥已供转写和总结使用':'本次会话尚未输入密钥';
  return state;
}
async function openDraft(item){
  const r=await call('draft',item.id);currentDraftId=item.id;const f=$('review-form'),editable=!item.trashedAt&&['review','ready','awaiting_link'].includes(r.status),historical=r.protection?.newestCall===false;
  const original=r.original||{},empty='当前未填写';
  $('original-intent').textContent=original.intent||empty;$('original-latest').textContent=original.latest_summary||empty;$('original-logs').textContent=original.recent_logs?.length?original.recent_logs.map(v=>`[${v.stamp}] ${v.text}`).join('\n\n'):'暂无标准时间格式的跟进日志';$('original-next-date').textContent=original.next_date||empty;$('original-next-purpose').textContent=original.next_purpose||empty;$('original-reminder-date').textContent=original.reminder_date||empty;$('original-reminder-note').textContent=original.reminder_note||empty;
  currentPreserved={};f.elements.summary.value=r.draft.summary||'';
  const callDate=item.meta?.date;
  const previousDate=original.next_date;
  const purposeExpired=Boolean(callDate&&/^\d{4}-\d{2}-\d{2}$/.test(previousDate||'')&&callDate>previousDate);
  for(const key of ['intent','next_date','next_purpose','reminder_date','reminder_note']){
    const proposed=r.draft[key];
    const fallback=key==='next_purpose'&&purposeExpired?'':original[key]||'';
    f.elements[key].value=proposed??fallback;
    f.elements[key].disabled=!editable;
    if(proposed==null&&fallback)currentPreserved[key]=fallback;
  }
  const latestField=f.elements.latest_summary;
  latestField.value=r.draft.latest_summary??(!r.nameDecisionMade&&editable?callOutcome(r.draft.summary):'');
  latestField.disabled=!editable||historical;
  latestField.placeholder=historical?'仅补历史日志':'';
  $('latest-summary-hint').textContent=historical?'这通录音仅补入跟进日志，飞书最新通话记录保留原值。':'最多60字。留空保留飞书原值。';
  const suggestedNextDate=editable?r.suggestedNextDate||'':'';
  defaultNextDate=suggestedNextDate||(r.draft.default_follow_up?r.draft.next_date:'');
  if(suggestedNextDate)f.elements.next_date.value=suggestedNextDate;
  f.elements.summary.disabled=!editable;
  const offer=!!r.draft.suggested_name&&!String(r.customer||'').trim();$('name-offer').hidden=!offer;f.elements.suggested_name.value=r.draft.suggested_name||'';f.elements.suggested_name.disabled=!editable||!offer;
  f.elements.approveName.checked=r.nameDecisionMade?!!r.nameApproved:true;f.elements.approveName.disabled=!editable||!offer;
  $('name-evidence').textContent='录音依据：'+(r.draft.name_evidence||'');
  $('write-scope').textContent=!r.recordId?'尚未关联客户：可核对草稿，关联后才允许保存到飞书。':historical?r.protection.reason+'。保存时只使用通话摘要追加历史日志；意向、跟进安排和提醒不会覆盖飞书中的较新内容。已确认的姓名建议只在姓名仍为空时补充。':'保存前会重新比较更新时间；已有姓名保持不变。';
  $('approve').hidden=!editable;$('transcript').textContent=r.transcript;$('review-title').textContent=(r.customer||'通话')+' · '+item.meta.stamp;$('review').showModal();
}
for(const name of ['inbox','calendar','archive','trash'])$('nav-'+name).onclick=()=>{page=name;if(name==='inbox')filter='all';notice('');render(currentItems);};
for(const button of document.querySelectorAll('[data-calendar-mode]'))button.onclick=()=>{calendarMode=button.dataset.calendarMode;renderCalendar();};
$('calendar-date').onchange=()=>{if($('calendar-date').value){calendarAnchor=$('calendar-date').value;renderCalendar();}};
$('calendar-today').onclick=()=>{calendarAnchor=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());renderCalendar();};
$('calendar-prev').onclick=()=>{calendarAnchor=calendarMode==='month'?shiftMonth(calendarAnchor,-1):shiftDate(calendarAnchor,-Number(calendarMode));renderCalendar();};
$('calendar-next').onclick=()=>{calendarAnchor=calendarMode==='month'?shiftMonth(calendarAnchor,1):shiftDate(calendarAnchor,Number(calendarMode));renderCalendar();};
for(const name of Object.keys(filterLabels))$('filter-'+name).onclick=()=>{page='inbox';filter=name;notice('');render(currentItems);};
for(const [id,selected]of [['select-all',true],['select-none',false]])$(id).onclick=action(()=>call('select',visibleItems().map(i=>i.id),'items',selected));
$('remove-items').onclick=action(async()=>{const ids=visibleItems().filter(i=>i.selectedItem).map(i=>i.id);if(ids.length){await call('move-items',ids,false);notice(`已移除 ${ids.length} 项，可在回收站恢复。`);}});
$('restore-items').onclick=action(async()=>{const ids=visibleItems().filter(i=>i.selectedItem).map(i=>i.id);if(ids.length){await call('move-items',ids,true);notice(`已恢复 ${ids.length} 项；已归档项目回到已归档，其余回到待处理。`);}});
$('clean-archive').onclick=action(async()=>{const n=await call('clean-archive-files');if(n)notice(`已清理 ${n} 条归档录音；归档文字结果仍保留。`);});
$('empty-trash').onclick=action(async()=>{const n=await call('clear-trash');if(n)notice(`已永久清空回收站中的 ${n} 项。`);});
$('open-settings').onclick=action(async()=>{await fillSettings();$('settings').showModal();});
$('diagnose-aliyun').onclick=async()=>{const f=$('settings-form'),box=$('aliyun-diagnostic');if(!confirm('将向百炼发送阿里云官方测试语音和一个最短文本，真实检查两个模型。可能产生极少量费用，继续吗？'))return;try{box.hidden=false;box.textContent='正在进行真实最小模型检查…';await call('settings',{...Object.fromEntries(new FormData(f).entries()),autoWrite:false});const r=await call('diagnose-aliyun'),line=(name,v)=>`${name}：${v.message}${v.status?`（HTTP ${v.status}）`:''}${v.detail?`\n百炼返回：${v.detail}`:''}\n地址：${v.url}`,keyLine=r.key?`本次发送密钥指纹：长度 ${r.key.length}，SHA-256 前16位 ${r.key.sha256||'不可用'}\n（仅用于比对，不显示或保存密钥）\n\n`:'';box.textContent=keyLine+line('录音转写',r.audio)+'\n\n'+line('跟进总结',r.text);await fillSettings();}catch(e){box.hidden=false;box.textContent=e.message;}};
$('close-settings').onclick=()=>{$('settings').close();$('settings-form').elements.aliyunKey.value='';};
$('settings-form').onsubmit=async e=>{e.preventDefault();try{await call('settings',{...Object.fromEntries(new FormData(e.target).entries()),autoWrite:false});$('settings').close();await fillSettings();notice('设置已保存');}catch(err){alert(err.message);}};
$('import').onclick=action(async()=>{page='inbox';filter='all';notice('正在导入并匹配号码，不调用 AI…');render(await call('import'));notice('导入完成。已匹配默认勾选；可补选未匹配录音。');});
$('process').onclick=action(async()=>{await call('process',selectedIds('analysis'));notice('正在分析选中的录音；不会自动写入飞书。');});
$('stop').onclick=action(async()=>{await call('stop');notice('将在当前一条处理完后停止');});$('commit').onclick=action(()=>call('commit',selectedIds('save')));
$('test').onclick=async()=>{try{alert(await call('test'));}catch(e){alert(e.message);}};$('close-review').onclick=()=>$('review').close();$('close-link').onclick=()=>$('link').close();
$('review-form').onsubmit=async e=>{e.preventDefault();try{const f=e.target,v=Object.fromEntries(new FormData(f).entries()),approveName=!$('name-offer').hidden&&f.elements.approveName.checked;delete v.approveName;for(const [k,original]of Object.entries(currentPreserved))if(v[k]===original)v[k]=null;for(const k of Object.keys(v))if(!v[k])v[k]=null;v.default_follow_up=!!defaultNextDate&&v.next_date===defaultNextDate;await call('approve',currentDraftId,v,approveName);$('review').close();render(currentItems);}catch(err){alert(err.message);}};
function renderCandidates(records){const container=$('link-results');container.replaceChildren();if(!records.length){container.textContent='没有找到，请换用完整姓名或号码查询。';return;}for(const r of records){const row=document.createElement('div');row.className='candidate';const label=document.createElement('span');label.textContent=[r.name,r.phone&&('号码/微信：'+r.phone),r.details&&('具体信息：'+r.details),r.intent&&('意向：'+r.intent),r.latest&&('最新通话：'+r.latest)].filter(Boolean).join('\n');const b=document.createElement('button');b.textContent='关联此客户';b.onclick=async()=>{try{await call('bind',currentLinkId,r.id);$('link').close();notice('已关联。请查看草稿、确认后勾选保存。');}catch(err){alert(err.message);}};row.append(label,b);container.append(row);}}
$('link-form').onsubmit=async e=>{e.preventDefault();try{
  renderCandidates(await call('candidates',currentLinkId,$('link-query').value));
}catch(err){alert(err.message);}};
window.crm.onQueue(payload=>{const items=Array.isArray(payload)?payload:payload.items;wasRunning=!!payload.running;render(items);});
(async()=>{try{const s=await fillSettings();wasRunning=s.running;render(s.items);}catch(e){notice(e.message);}})();
