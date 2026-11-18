import {MANUAL_SELECT_FIELDS} from './core.js?v=20261118-web-release1';
const $=id=>document.getElementById(id);
let currentItems=[],currentDraftId=null,currentLinkId=null,currentPreserved={},page='inbox',filter='all',wasRunning=false,calendarMode='1',calendarAnchor=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
let currentManualValues=null,operation=null,stopRequested=false;
for(const [key,{options}] of Object.entries(MANUAL_SELECT_FIELDS)){
  const select=$('review-form').elements[key];
  for(const value of options)select.add(new Option(value,value));
}
const labels={queued:'待分析',processing:'处理中',ready:'待保存',review:'需核对',writing:'保存中',done:'已归档',skipped:'未分析',ambiguous:'匹配有歧义',awaiting_link:'待关联客户',error:'失败',invalid:'文件不支持',uncertain:'需确认结果'};
async function call(c,...args){const r=await window.crm.call(c,...args);if(!r.ok)throw Error(r.error);return r.data;}
function notice(t){$('notice').textContent=t||'';}
function action(fn){return async()=>{try{notice('');await fn();}catch(e){notice(e.message);}};}
document.addEventListener('click',event=>{
  for(const menu of document.querySelectorAll('.row-more[open]')){
    if(!menu.contains(event.target))menu.open=false;
  }
});
const filterLabels={all:'全部待办',analysis:'待分析',ready:'待保存',attention:'待核对／异常'};
function visibleItems(){if(page==='calendar')return[];return page==='inbox'?window.crmView.inbox(currentItems,filter):currentItems.filter(i=>page==='trash'?!!i.trashedAt:!i.trashedAt&&i.status==='done');}
function eligible(i,p){return window.crmView.eligible(i,p);}
function selectedIds(p){return visibleItems().filter(i=>i.selectedItem&&eligible(i,p)).map(i=>i.id);}
function renderOperationStatus(){
  const status=$('operation-status');
  const message={
    importing:'正在导入录音…',
    matching:'正在匹配客户…',
    analysis:'正在分析选中的录音…',
    resummarizing:'正在用已有转写重新总结…',
    saving:'正在保存选中的草稿到飞书…'
  }[operation]||'正在处理…';
  status.hidden=!wasRunning;
  const text=wasRunning?(stopRequested?'将在当前一条处理完后停止':message):'';
  if(status.textContent!==text)status.textContent=text;
  $('notice').hidden=wasRunning;
}
function selectionInfo(){
  const visible=visibleItems(),selected=visible.filter(i=>i.selectedItem),active=page==='inbox';
  for(const name of ['inbox','calendar','archive','trash'])$('nav-'+name).classList.toggle('active',page===name);
  $('queue-panel').hidden=page==='calendar';$('calendar-panel').hidden=page!=='calendar';
  renderOperationStatus();
  if(page==='calendar'){$('stats').hidden=true;return;}
  $('page-title').textContent=(active?filterLabels[filter]:{archive:'已归档',trash:'回收站'}[page])+` · ${visible.length} 条`;
  $('stats').hidden=!active;
  for(const name of Object.keys(filterLabels)){$('filter-'+name).classList.toggle('selected',active&&filter===name);$('filter-'+name).setAttribute('aria-pressed',String(active&&filter===name));}
  $('mode').textContent={inbox:'统一勾选，选择分析、保存或移除',archive:'可清理录音引用，保留已归档文字结果',trash:'可恢复或永久清空；原始录音和飞书记录保持不变'}[page];
  $('selection-help').textContent=wasRunning?'':`当前页面已选 ${selected.length} 项。`+(active?'分析处理可分析的录音；保存仅处理已核对并关联客户的草稿。':'移除和恢复仅影响本浏览器列表。');
  const analysis=selected.filter(i=>eligible(i,'analysis')).length,save=selected.filter(i=>eligible(i,'save')).length;
  const summaries=selected.filter(i=>eligible(i,'resummarize')).length;
  $('process').textContent=`分析选中录音（${analysis}条）`;$('commit').textContent=`保存选中草稿（${save}条）`;
  $('resummarize-selected').textContent=`重新总结选中（${summaries}条）`;
  $('resummarize-selected').disabled=wasRunning||!summaries;
  $('primary-actions').hidden=!active;
  $('stop').hidden=!active;
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
  const grid=document.createElement('div');grid.className='schedule-grid columns-'+count;for(const day of days){const column=document.createElement('section');column.className='schedule-day';if(count>1){const head=document.createElement('header');head.innerHTML=`<b>${shortDate(day.date)}</b><span>${day.count} 条</span>`;column.append(head);}if(!day.items.length){const empty=document.createElement('p');empty.className='schedule-empty';empty.textContent='没有录音';column.append(empty);}for(const item of day.items)column.append(scheduleCard(item));grid.append(column);}host.append(grid);
}
function render(items){
  currentItems=items;selectionInfo();
  for(const [name,id] of [['all','count-all'],['analysis','count-analysis'],['ready','count-ready'],['attention','count-review']]){
    const count=window.crmView.inbox(items,name).length;
    $(id).textContent=count;
    $('filter-'+name).classList.toggle('zero',count===0);
  }
  if(page==='calendar'){renderCalendar();return;}
  const container=$('queue');container.replaceChildren();
  const visible=visibleItems();
  if(!visible.length){
    const [symbol,heading,description,detail]={
      inbox:filter==='all'
        ?['↗','暂无待处理录音','点击「批量导入录音」，可一次选择多个文件。','百炼模式支持长录音自动分段 · 单个文件最多 512 MB']
        :['✓','当前筛选没有录音','可切换筛选，或导入新的录音。'],
      archive:['✓','暂无已归档项目','保存到飞书的录音会显示在这里。'],
      trash:['✓','回收站为空','移除的录音可在这里恢复。']
    }[page];
    const empty=document.createElement('div');empty.className='empty';
    const icon=document.createElement('div');icon.className='empty-icon';icon.textContent=symbol;icon.setAttribute('aria-hidden','true');
    const title=document.createElement('h3');title.textContent=heading;
    const hint=document.createElement('p');hint.textContent=description;
    empty.append(icon,title,hint);
    if(detail){const small=document.createElement('small');small.textContent=detail;empty.append(small);}
    container.append(empty);
  }
  for(const i of [...visible].reverse()){
    const row=document.createElement('div');row.className='item';
    const check=document.createElement('input');check.type='checkbox';check.className='row-check';check.checked=!!i.selectedItem;check.disabled=wasRunning;check.setAttribute('aria-label','选择 '+(i.customer||i.filename));
    check.onchange=action(()=>call('select',[i.id],'items',check.checked));
    const info=document.createElement('div');info.className='info';const title=document.createElement('h3');title.textContent=i.customer||i.filename;
    const meta=document.createElement('div');meta.className='meta';meta.textContent=i.meta?`${i.meta.stamp} · ${i.meta.phone?i.meta.phone.replace(/(\d{3})\d{4}(\d{4})/,'$1****$2'):'无号码 · 可手动关联'}`:i.filename;
    // Older drafts may still have the model's full review reason in the status message.
    const reviewReason=i.draft?.review_reason;
    let message=reviewReason?String(i.message||'').replace(reviewReason,'请核对草稿'):i.message;
    if(i.draft?.summary){
      message=String(message||'').replace(/^(?:摘要已重新生成，请核对|请核对草稿|草稿已生成，联系结果可保存)(?:；|$)/,'');
    }
    const text=document.createElement('p');
    text.textContent=[message,i.draft?.summary].filter(Boolean).join('\n');
    const status=document.createElement('span');status.className='badge '+i.status;status.textContent=labels[i.status]||i.status;
    const heading=document.createElement('div');heading.className='item-heading';
    heading.append(title,status);
    const header=document.createElement('div');header.className='item-header';
    const buttons=document.createElement('div');buttons.className='row-actions';
    const secondary=document.createElement('div');secondary.className='row-more-options';
    if(i.draft){const b=document.createElement('button');b.textContent='查看';b.disabled=wasRunning;b.onclick=action(()=>openDraft(i));buttons.append(b);}
    if(eligible(i,'resummarize')){
      const button=document.createElement('button');
      button.textContent='重新总结';
      button.disabled=wasRunning;
      button.onclick=action(async()=>{
        const replacement=i.draft?'成功后将替换当前草稿的通话摘要。':'成功后将生成一份草稿。';
        if(!confirm('使用现有转写文字调用一次总结模型，可能产生少量费用。'+replacement+'继续吗？'))return;
        await call('resummarize',i.id);
        notice('已重新总结，请核对新摘要。');
      });
      secondary.append(button);
    }
    if(!i.trashedAt&&i.meta&&i.status!=='done'&&i.status!=='uncertain'){
      const b=document.createElement('button');b.textContent=i.recordId?'更换关联':'关联客户';b.disabled=wasRunning;b.onclick=action(async()=>{currentLinkId=i.id;$('link-query').value='';$('link-results').replaceChildren();$('link').showModal();if(i.matchCount>1&&i.meta?.phone)renderCandidates(await call('matches',i.id));});(i.draft?secondary:buttons).append(b);
    }
    if(!i.trashedAt&&['error','uncertain','skipped','ambiguous'].includes(i.status)){
      const b=document.createElement('button');b.textContent=i.status==='uncertain'?'核对后恢复':'重新排队';b.disabled=wasRunning;
      b.onclick=action(async()=>{if(i.status==='uncertain'&&!confirm('先在飞书确认该条写入结果，再恢复。程序会比对日志避免重复。确认恢复？'))return;await call('retry',i.id);});(buttons.childElementCount?secondary:buttons).append(b);
    }
    if(secondary.childElementCount){
      const menu=document.createElement('details');menu.className='row-more';
      const trigger=document.createElement('summary');trigger.textContent='更多';
      trigger.setAttribute('aria-label','更多操作：'+title.textContent);
      trigger.title='更多操作';
      let openedByHover=false;
      trigger.addEventListener('pointerenter',event=>{
        if(event.pointerType!=='mouse'||menu.open||wasRunning)return;
        menu.open=true;
        openedByHover=true;
      });
      menu.addEventListener('pointerleave',event=>{
        if(event.pointerType!=='mouse'||!openedByHover)return;
        openedByHover=false;
        if(!secondary.contains(document.activeElement))menu.open=false;
      });
      trigger.addEventListener('click',event=>{
        if(openedByHover&&menu.open){
          event.preventDefault();
          openedByHover=false;
        }
      });
      menu.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&menu.open){
          event.stopPropagation();
          openedByHover=false;
          menu.open=false;
          trigger.focus();
        }
      });
      secondary.addEventListener('click',event=>{
        if(event.target.closest('button')){
          openedByHover=false;
          menu.open=false;
          if(!$('link').open&&!$('review').open)trigger.focus();
        }
      });
      menu.append(trigger,secondary);
      buttons.append(menu);
    }
    header.append(heading);
    if(buttons.childElementCount)header.append(buttons);
    info.append(header,meta);
    if(text.textContent)info.append(text);
    row.append(check,info);
    container.append(row);
  }
}
async function fillSettings(){
  const state=await call('state');const f=$('settings-form');for(const [k,v]of Object.entries(state.settings))if(f.elements[k])f.elements[k].value=v;
  f.elements.aliyunKey.value='';$('aliyun-key-state').textContent=state.hasAliyunKey?'同一把密钥已供转写和总结使用':'本次会话尚未输入密钥';
  return state;
}
let defaultNextDate='';
const followUpHint=document.createElement('small');
followUpHint.textContent='默认建议：通话后一个月，可修改或清空。';
followUpHint.hidden=true;
const clearableFields={
  summary:'通话摘要',
  next_date:'下次跟进日期',
  next_purpose:'下次跟进目的',
  reminder_date:'特殊提醒日期',
  reminder_note:'特殊提醒事项'
};
const clearControls=Object.entries(clearableFields).map(([name,label])=>{
  const field=$('review-form').elements.namedItem(name);
  const fieldLabel=field.closest('label');
  const group=document.createElement('div');
  group.className='clearable-group';
  fieldLabel.before(group);
  field.id='review-field-'+name;
  fieldLabel.htmlFor=field.id;
  const wrapper=document.createElement('div');
  wrapper.className='clearable-field';
  const button=document.createElement('button');
  button.type='button';
  button.className='field-clear';
  button.textContent='×';
  button.title='清空'+label;
  button.setAttribute('aria-label',button.title);
  const update=()=>{
    button.hidden=field.disabled;
    button.disabled=field.disabled||!field.value;
  };
  button.onclick=()=>{
    field.value='';
    field.focus();
    update();
  };
  field.addEventListener('input',update);
  field.addEventListener('change',update);
  wrapper.append(field,button);
  group.append(fieldLabel,wrapper);
  if(name==='next_date')group.append(followUpHint);
  update();
  return update;
});
async function openDraft(item){
  const r=await call('draft',item.id);currentDraftId=item.id;const f=$('review-form'),editable=!item.trashedAt&&['review','ready','awaiting_link'].includes(r.status),historical=r.protection?.newestCall===false;
  const original=r.original||{};
  $('original-intent').textContent=original.intent||'';$('original-latest').textContent=original.latest_summary||'';$('original-logs').textContent=original.recent_logs?.length?original.recent_logs.map(v=>`[${v.stamp}] ${v.text}`).join('\n\n'):(original.hasUnformattedLog?'暂无标准时间格式的跟进日志':'');$('original-next-date').textContent=original.next_date||'';$('original-next-purpose').textContent=original.next_purpose||'';$('original-reminder-date').textContent=original.reminder_date||'';$('original-reminder-note').textContent=original.reminder_note||'';
  $('original-group').textContent=r.original?(original.group||(original.groupEmpty?'':'已填写')):'未读取到飞书客群';
  currentManualValues=original.manualValues||null;
  for(const key of Object.keys(MANUAL_SELECT_FIELDS)){
    const current=currentManualValues?.[key];
    const saved=r.manualSelections?.[key];
    const select=f.elements[key];
    const group=key==='customer_group';
    if(!group)$('original-'+key).textContent=current===undefined?'未读取':current||'';
    select.disabled=!editable||current===undefined||(group&&!original.groupEmpty&&!current);
    const fallback=group?(original.groupEmpty?(r.groupChoice!==undefined?r.groupChoice:r.group?.value):current):'';
    const value=saved?.original===current?saved?.value:fallback;
    select.value=[...select.options].some(option=>option.value===value)?value:'';
    select.options[0].textContent=group?'':current||'';
    select.options[0].setAttribute('aria-label',select.options[0].textContent||'留空');
  }
  currentPreserved={};f.elements.summary.value=r.draft.summary||'';
  for(const k of ['intent','next_date','next_purpose','reminder_date','reminder_note']){const proposed=r.draft[k],fallback=original[k]||'';f.elements[k].value=proposed??fallback;f.elements[k].disabled=!editable;if(proposed==null&&fallback)currentPreserved[k]=fallback;}
  f.elements.summary.disabled=!editable;
  const suggestedNextDate=editable?(r.suggestedNextDate||''):'';
  defaultNextDate=suggestedNextDate||(r.draft.default_follow_up?r.draft.next_date:'');
  if(suggestedNextDate)f.elements.next_date.value=suggestedNextDate;
  followUpHint.hidden=!editable||!defaultNextDate;
  clearControls.forEach(update=>update());
  const offer=!!r.draft.suggested_name&&!String(r.customer||'').trim();$('name-offer').hidden=!offer;f.elements.suggested_name.value=r.draft.suggested_name||'';f.elements.suggested_name.disabled=!editable||!offer;
  f.elements.approveName.checked=r.nameDecisionMade?!!r.nameApproved:true;f.elements.approveName.disabled=!editable||!offer;
  $('name-evidence').textContent='录音依据：'+(r.draft.name_evidence||'');
  $('write-scope').textContent=!r.recordId?'尚未关联客户：可核对草稿，关联后才允许保存到飞书。':historical?r.protection.reason+'。姓名可补空值，客群、留学报备和是否自有按确认的选项保存。':'保存前会重新核对飞书原值。';
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
$('diagnose-aliyun').onclick=async()=>{const f=$('settings-form'),box=$('aliyun-diagnostic');if(!confirm('将向百炼发送阿里云官方测试语音和一个最短文本，真实检查两个模型。可能产生极少量费用，继续吗？'))return;try{box.hidden=false;box.textContent='正在进行真实最小模型检查…';await call('settings',{...Object.fromEntries(new FormData(f).entries()),autoWrite:false});const r=await call('diagnose-aliyun'),line=(name,v)=>`${name}：${v.message}${v.status?`（HTTP ${v.status}）`:''}\n地址：${v.url}`;box.textContent=line('录音转写',r.audio)+'\n\n'+line('跟进总结',r.text);await fillSettings();}catch(e){box.hidden=false;box.textContent=e.message;}};
$('close-settings').onclick=()=>{$('settings').close();$('settings-form').elements.aliyunKey.value='';};
$('settings-form').onsubmit=async e=>{e.preventDefault();try{await call('settings',{...Object.fromEntries(new FormData(e.target).entries()),autoWrite:false});$('settings').close();await fillSettings();notice('设置已保存');}catch(err){alert(err.message);}};
$('import').onclick=action(async()=>{page='inbox';filter='all';render(await call('import'));notice('导入完成。已匹配默认勾选；可补选未匹配录音。');});
$('process').onclick=action(()=>call('process',selectedIds('analysis')));
$('resummarize-selected').onclick=action(async()=>{
  const ids=selectedIds('resummarize');
  if(!ids.length)return;
  if(!confirm(`使用已有转写重新总结 ${ids.length} 条录音？每条调用一次总结模型，可能产生费用。成功后更新草稿摘要。`))return;
  const {completed,failed,unprocessed,firstError}=await call('resummarize-selected',ids,filter);
  notice([
    `重新总结完成 ${completed} 条`,
    failed&&`失败 ${failed} 条：${firstError}`,
    unprocessed&&`未处理 ${unprocessed} 条`
  ].filter(Boolean).join('；'));
});
$('stop').onclick=action(async()=>{await call('stop');stopRequested=wasRunning;renderOperationStatus();});$('commit').onclick=action(()=>call('commit',selectedIds('save')));
$('test').onclick=async()=>{try{alert(await call('test'));}catch(e){alert(e.message);}};$('close-review').onclick=()=>$('review').close();$('close-link').onclick=()=>$('link').close();
$('review-form').onsubmit=async e=>{
  e.preventDefault();
  try{
    const f=e.target,v=Object.fromEntries(new FormData(f).entries());
    const approveName=!$('name-offer').hidden&&f.elements.approveName.checked;
    delete v.approveName;
    const manualSelections={};
    for(const key of Object.keys(MANUAL_SELECT_FIELDS)){
      const original=currentManualValues?.[key];
      if(v[key]&&original!==undefined&&v[key]!==original)manualSelections[key]={value:v[key],original};
      delete v[key];
    }
    for(const [k,original] of Object.entries(currentPreserved))if(v[k]===original)v[k]=null;
    for(const k of Object.keys(v))if(!v[k])v[k]=null;
    v.default_follow_up=!!defaultNextDate&&v.next_date===defaultNextDate;
    await call('approve',currentDraftId,v,approveName,null,manualSelections);
    $('review').close();
    render(currentItems);
  }catch(err){alert(err.message);}
};
function renderCandidates(records){const container=$('link-results');container.replaceChildren();if(!records.length){container.textContent='没有找到，请换用完整姓名或号码查询。';return;}for(const r of records){const row=document.createElement('div');row.className='candidate';const label=document.createElement('span');label.textContent=[r.name,r.phone&&('号码/微信：'+r.phone),r.details&&('具体信息：'+r.details),r.intent&&('意向：'+r.intent),r.latest&&('最新通话：'+r.latest)].filter(Boolean).join('\n');const b=document.createElement('button');b.textContent='关联此客户';b.onclick=async()=>{try{await call('bind',currentLinkId,r.id);$('link').close();notice('已关联。请查看草稿、确认后勾选保存。');}catch(err){alert(err.message);}};row.append(label,b);container.append(row);}}
$('link-form').onsubmit=async e=>{e.preventDefault();try{
  renderCandidates(await call('candidates',currentLinkId,$('link-query').value));
}catch(err){alert(err.message);}};
window.crm.onQueue(payload=>{const items=Array.isArray(payload)?payload:payload.items;wasRunning=!!payload.running;operation=payload.operation;if(!wasRunning)stopRequested=false;render(items);});
(async()=>{try{const s=await fillSettings();wasRunning=s.running;render(s.items);}catch(e){notice(e.message);}})();
