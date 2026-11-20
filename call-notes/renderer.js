import {MANUAL_SELECT_FIELDS} from './core.js?v=20261119-ui-parity1';
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
const archiveSearch=$('archive-phone-search');
function visibleItems(){
  if(page==='calendar')return [];
  if(page==='inbox')return window.crmView.inbox(currentItems,filter);
  if(page==='trash')return currentItems.filter(item=>item.trashedAt);
  return window.crmView.archived(currentItems,archiveSearch.value);
}
archiveSearch.addEventListener('input',()=>render(currentItems));
function eligible(i,p){return window.crmView.eligible(i,p);}
function selectedIds(p){return visibleItems().filter(i=>i.selectedItem&&eligible(i,p)).map(i=>i.id);}
let analysisProgress=null,analysisCompletionTimer=0,stopMode=null;
function renderOperationStatus(){
  const status=$('operation-status'),label=$('operation-label'),stop=$('stop');
  const showing=wasRunning||!!analysisCompletionTimer;
  const message={
    syncing:'正在同步记录…',
    'connecting-drive':'正在等待 Google 授权…',
    'applying-drive-sync':'正在应用同步结果…',
    'clearing-trash':'正在清空回收站…',
    importing:'正在导入录音…',
    matching:'正在匹配客户…',
    analysis:'正在分析录音…',
    resummarizing:'正在重新总结…',
    saving:'正在保存草稿…'
  }[operation]||'正在处理…';
  status.hidden=!showing;
  const text=!showing?'':!wasRunning?'分析结束':stopRequested?'本条结束后将停止':message;
  if(label.textContent!==text)label.textContent=text;
  const measured=showing&&Number.isFinite(analysisProgress);
  status.classList.toggle('operation-measured',measured);
  if(measured)status.style.setProperty('--operation-progress',String(analysisProgress));
  else status.style.removeProperty('--operation-progress');
  stop.hidden=!wasRunning||!stopMode||stopRequested;
  stop.textContent=stopMode==='drive'?'取消':'本条结束后停止';
  stop.setAttribute('aria-label',stopMode==='drive'?'取消 Google Drive 操作':'本条结束后停止');
  $('notice').hidden=wasRunning;
}
function selectionInfo(){
  $('queue-panel').dataset.page=page;
  archiveSearch.hidden=page!=='archive';
  const visible=visibleItems(),selected=visible.filter(i=>i.selectedItem),active=page==='inbox';
  for(const name of ['inbox','calendar','archive','trash'])$('nav-'+name).classList.toggle('active',page===name);
  $('queue-panel').hidden=page==='calendar';$('calendar-panel').hidden=page!=='calendar';
  renderOperationStatus();
  if(page==='calendar'){$('stats').hidden=true;return;}
  $('page-title').textContent=(active?filterLabels[filter]:{archive:'已归档',trash:'回收站'}[page])+` · ${visible.length} 条`;
  $('stats').hidden=!active;
  for(const name of Object.keys(filterLabels)){$('filter-'+name).classList.toggle('selected',active&&filter===name);$('filter-'+name).setAttribute('aria-pressed',String(active&&filter===name));}
  $('selection-help').textContent=!wasRunning&&selected.length?`已选 ${selected.length} 项`:'';
  const analysis=selected.filter(i=>eligible(i,'analysis')).length,save=selected.filter(i=>eligible(i,'save')).length;
  const summaries=selected.filter(i=>eligible(i,'resummarize')).length;
  for(const [id,count] of [['process',analysis],['resummarize-selected',summaries],['commit',save]]){
    const button=$(id);
    button.querySelector('.action-count').textContent=count>99?'99+':String(count);
    button.setAttribute('aria-label',button.querySelector('.action-label').textContent+'，已选 '+count+' 条');
  }
  $('resummarize-selected').disabled=wasRunning||!summaries;
  $('primary-actions').hidden=!active;
  $('process').disabled=wasRunning||!analysis;$('commit').disabled=wasRunning||!save;
  $('import').hidden=!active;$('import').disabled=wasRunning;
  $('remove-items').hidden=page==='trash';$('restore-items').hidden=page!=='trash';
  $('clean-archive').hidden=page!=='archive';$('empty-trash').hidden=page!=='trash';
  $('clean-archive').disabled=wasRunning||!visible.some(i=>i.hasSource);$('empty-trash').disabled=wasRunning||!visible.length;
  for(const id of ['remove-items','restore-items'])$(id).disabled=wasRunning||!selected.length;
  $('select-all').disabled=wasRunning||!visible.length||selected.length===visible.length;
  $('select-none').disabled=wasRunning||!selected.length;
}
function shiftDate(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function shiftMonth(date,months){const d=new Date(date+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString().slice(0,10);}
const shortDateFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short'
});
function shortDate(date) {
  return shortDateFormat.format(new Date(date + 'T00:00:00Z'));
}
function calendarTitleDate(date) {
  const group = document.createElement('span');
  group.className = 'calendar-title-date';
  const number = document.createElement('span');
  number.className = 'calendar-title-number';
  const weekday = document.createElement('span');
  weekday.className = 'calendar-title-weekday';
  for (const part of shortDateFormat.formatToParts(new Date(date + 'T00:00:00Z'))) {
    if (part.type === 'weekday') weekday.textContent = part.value;
    else number.append(part.value);
  }
  group.append(number, weekday);
  return group;
}
function scheduleCard(item){
  const node=document.createElement(item.draft?'button':'div');node.className='schedule-card '+item.status;
  const time=document.createElement('time');time.textContent=item.meta.stamp.slice(11);const name=document.createElement('b');name.textContent=window.crmView.displayName(item);const state=document.createElement('span');state.textContent=labels[item.status]||item.status;
  node.append(time,name,state);if(item.draft){node.type='button';node.onclick=action(()=>openDraft(item));node.title='查看通话详情';}return node;
}
function renderCalendar(){
  const host=$('calendar-view');
  const previousRange=host.querySelector('.schedule-grid[data-anchor]');
  const rangeScroll=previousRange?.dataset.anchor===calendarAnchor && previousRange.dataset.mode===calendarMode
    ? previousRange.scrollLeft : null;
  host.replaceChildren();$('calendar-date').value=calendarAnchor;
  for(const button of document.querySelectorAll('[data-calendar-mode]'))button.classList.toggle('selected',button.dataset.calendarMode===calendarMode);
  if(calendarMode==='month'){
    const days=window.crmView.calendarMonth(currentItems,calendarAnchor),month=calendarAnchor.slice(0,7),total=days.filter(d=>d.inMonth).reduce((n,d)=>n+d.count,0);
    $('calendar-title').textContent=calendarAnchor.slice(0,4)+'年'+Number(calendarAnchor.slice(5,7))+'月';$('calendar-total').textContent=`本月共 ${total} 条录音`;
    const grid=document.createElement('div');grid.className='month-grid';for(const w of ['一','二','三','四','五','六','日']){const h=document.createElement('div');h.className='weekday';h.textContent='周'+w;grid.append(h);}
    for(const day of days){const cell=document.createElement('button');cell.type='button';cell.setAttribute('aria-label',day.date+'，'+day.count+' 条录音');cell.className='month-day'+(day.inMonth?'':' outside')+(day.date===calendarAnchor?' selected':'');const head=document.createElement('span');head.className='month-day-head';head.innerHTML=`<b>${Number(day.date.slice(8))}</b><em>${day.count?day.count+'条':''}</em>`;const names=document.createElement('span');names.className='month-names';names.textContent=day.items.slice(0,3).map(window.crmView.displayName).join('\n')+(day.count>3?`\n另 ${day.count-3} 条`:'' );cell.append(head,names);cell.onclick=()=>{calendarAnchor=day.date;calendarMode='1';renderCalendar();};grid.append(cell);}host.append(grid);return;
  }
  const count=Number(calendarMode),days=window.crmView.calendarRange(currentItems,shiftDate(calendarAnchor,1-count),count),total=days.reduce((n,d)=>n+d.count,0);
  const title = $('calendar-title');
  title.replaceChildren(calendarTitleDate(days[0].date));
  if (count > 1) {
    const end = document.createElement('span');
    end.className = 'calendar-title-end';
    const separator = document.createElement('span');
    separator.className = 'calendar-title-separator';
    separator.textContent = ' — ';
    end.append(separator, calendarTitleDate(days.at(-1).date));
    title.append(end);
  }
  $('calendar-total').textContent=`当前范围共 ${total} 条录音`;
  const grid=document.createElement('div');
  grid.className='schedule-grid columns-'+count;
  for(const day of days){
    const column=document.createElement('section');
    column.className='schedule-day';
    if(count>1){
      const date=shortDate(day.date);
      const head=document.createElement('header');
      const label=document.createElement('b');
      label.textContent=date;
      const total=document.createElement('span');
      total.textContent=day.count+' 条';
      head.append(label,total);
      column.append(head);
    }
    if(!day.items.length){
      const empty=document.createElement('p');
      empty.className='schedule-empty';
      empty.textContent='没有录音';
      column.append(empty);
    }
    for(const item of day.items)column.append(scheduleCard(item));
    grid.append(column);
  }
  host.append(grid);
  if(count>1){
    grid.tabIndex=0;
    grid.setAttribute('role','region');
    grid.setAttribute('aria-label',count+' 天通话记录，可横向滚动');
    grid.dataset.anchor=calendarAnchor;
    grid.dataset.mode=calendarMode;
    grid.scrollLeft=rangeScroll ?? grid.scrollWidth;
  }
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
    const [symbol,heading,description]={
      inbox:filter==='all'
        ?['↗','暂无待处理录音','可批量导入录音，单个文件最多 512 MB']
        :['✓','当前筛选没有录音'],
      archive:archiveSearch.value.trim()
        ?['↗','没有匹配的归档记录','试试完整号码或尾号。']
        :['✓','暂无已归档项目'],
      trash:['✓','回收站为空']
    }[page];
    const empty=document.createElement('div');empty.className='empty';
    const icon=document.createElement('div');icon.className='empty-icon';icon.textContent=symbol;icon.setAttribute('aria-hidden','true');
    const title=document.createElement('h3');title.textContent=heading;
    const hint=document.createElement('p');hint.textContent=description;
    empty.append(icon,title);
    if(description)empty.append(hint);
    container.append(empty);
  }
  for(const i of [...visible].reverse()){
    const row=document.createElement('div');row.className=page==='inbox'?'item inbox-row':'item';
    const check=document.createElement('input');check.type='checkbox';check.className='row-check';check.checked=!!i.selectedItem;check.disabled=wasRunning;check.setAttribute('aria-label','选择 '+(i.customer||i.filename));
    check.onchange=action(()=>call('select',[i.id],'items',check.checked));
    const info=document.createElement('div');info.className='info';const title=document.createElement('span');title.className='row-title';title.textContent=i.customer||i.filename;
    const meta=document.createElement('span');meta.className='meta';meta.textContent=i.meta?`${i.meta.stamp} · ${i.meta.phone?i.meta.phone.replace(/(\d{3})\d{4}(\d{4})/,'$1****$2'):'无号码 · 可手动关联'}`:i.filename;
    // Older drafts may still have the model's full review reason in the status message.
    const reviewReason=i.draft?.review_reason;
    let message=reviewReason?String(i.message||'').replace(reviewReason,'请核对草稿'):i.message;
    if(i.draft?.summary){
      message=String(message||'').replace(/^(?:摘要已重新生成，请核对|请核对草稿|草稿已生成，联系结果可保存)(?:；|$)/,'');
    }
    const historical=i.protection?.newestCall===false||String(message||'').includes('仅补历史日志');
    const context=document.createElement('span');context.className='row-context';
    const rowMessage=String(message||'').replace(
      i.protection?.reason||'日志中已有同一时间或更晚的跟进，仅补历史日志',''
    ).replace(/^[；。\s]+|[；。\s]+$/g,'');
    context.textContent=historical
      ?['仅补历史日志',rowMessage==='仅补历史日志'?'':rowMessage].filter(Boolean).join(' · ')
      :message||'';
    const text=document.createElement('span');text.className='row-preview';
    text.textContent=i.draft?.summary||'';
    let compact;
    if(i.draft){
      compact=document.createElement('span');compact.className='row-preview mobile-draft-preview';
      compact.textContent=i.draft.latest_summary||i.draft.summary||'';
      text.classList.add('wide-draft-preview');
    }
    const status=document.createElement('span');status.className='badge '+i.status;status.textContent=labels[i.status]||i.status;
    const heading=document.createElement('span');heading.className='item-heading';
    heading.append(title,status);
    const content=document.createElement('button');content.className='row-content';
    content.type='button';
    content.disabled=wasRunning;
    content.setAttribute('aria-label','查看 '+title.textContent);
    content.onclick=action(()=>openRecordingDetails(i));
    const buttons=document.createElement('div');buttons.className='row-actions';
    const secondary=document.createElement('div');secondary.className='row-more-options';
    if(i.hasTranscript&&i.draft&&page!=='inbox'){
      const b=document.createElement('button');
      b.textContent='查看转写原文';
      b.disabled=wasRunning;
      b.onclick=action(()=>openTranscript(i));
      buttons.append(b);
    }
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
      const b=document.createElement('button');b.textContent=i.recordId?'更换关联':'关联客户';b.disabled=wasRunning;b.onclick=action(async()=>{currentLinkId=i.id;$('link-query').value='';$('link-results').replaceChildren();$('link').showModal();if(i.matchCount>1&&i.meta?.phone)renderCandidates(await call('matches',i.id));});(page==='inbox'||i.draft?secondary:buttons).append(b);
    }
    if(!i.trashedAt&&['error','uncertain','skipped','ambiguous'].includes(i.status)){
      const b=document.createElement('button');b.textContent=i.status==='uncertain'?'核对后恢复':'重新排队';b.disabled=wasRunning;
      b.onclick=action(async()=>{if(i.status==='uncertain'&&!confirm('先在飞书确认该条写入结果，再恢复。程序会比对日志避免重复。确认恢复？'))return;await call('retry',i.id);});(page==='inbox'||buttons.childElementCount?secondary:buttons).append(b);
    }
    if(secondary.childElementCount){
      const menu=document.createElement('details');menu.className='row-more';
      const trigger=document.createElement('summary');
      if(page!=='inbox')trigger.textContent='更多';
      if(wasRunning)trigger.setAttribute('aria-disabled','true');
      trigger.setAttribute('aria-label','更多操作：'+title.textContent);
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
        if(wasRunning){event.preventDefault();return;}
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
    content.append(heading,meta);
    if(context.textContent)content.append(context);
    if(text.textContent)content.append(text);
    if(compact?.textContent)content.append(compact);
    info.append(content);
    if(buttons.childElementCount)info.append(buttons);
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
  const grows=field.matches('textarea.review-notes');
  wrapper.className='clearable-field';
  if(field.type==='date')wrapper.classList.add('review-date-control');
  if(grows)group.classList.add('review-notes-group');
  const button=document.createElement('button');
  button.type='button';
  button.className='field-clear';
  button.textContent='×';
  button.title='清空'+label;
  button.setAttribute('aria-label',button.title);
  const update=()=>{
    button.hidden=field.disabled;
    button.disabled=field.disabled||!field.value;
    if(grows&&field.getClientRects().length){
      field.style.height='auto';
      const borders=field.offsetHeight-field.clientHeight;
      field.style.height=(field.scrollHeight+borders)+'px';
    }
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
const narrowReview=window.matchMedia('(max-width: 700px)');
let reviewStamp='',reviewCustomer='';
function layoutReview(){
  const narrow=narrowReview.matches;
  const title=$('review-title'),time=$('review-time');
  title.textContent=narrow?reviewCustomer:[reviewCustomer,reviewStamp].filter(Boolean).join(' · ');
  time.hidden=!narrow||!reviewStamp;
  time.textContent=reviewStamp;
  showOriginalDetails(!narrow);
}
function showOriginalDetails(show){
  $('review-original-extra').hidden=!show;
  $('review-original-toggle').setAttribute('aria-expanded',String(show));
  if(!show)$('original-log-details').open=false;
}
$('review-original-toggle').onclick=()=>showOriginalDetails($('review-original-extra').hidden);
narrowReview.addEventListener('change',()=>{if($('review').open)layoutReview();});
function showRecordingText(title,text){
  $('transcript-view-title').textContent=title;
  $('transcript-view-text').textContent=text;
  $('transcript-view').showModal();
}
async function openTranscript(item){
  showRecordingText('转写原文',await call('transcript',item.id));
}
function openRecordingDetails(item){
  if(item.draft)return openDraft(item);
  if(item.hasTranscript)return openTranscript(item);
  const status=labels[item.status]||item.status;
  showRecordingText('录音详情',[
    item.filename,
    item.meta?.stamp,
    status,
    item.message
  ].filter(Boolean).join('\n'));
}
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
  $('original-log-details').open=false;
  const latestField=f.elements.latest_summary;
  latestField.value=r.draft.latest_summary||'';
  latestField.disabled=!editable||historical;
  const blankReasons={
    no_progress:'AI 未提炼出有效进展。',
    missing:'AI 漏填了这一项，可通过「重新总结」再生成。',
    too_long:'AI 返回的一句话超过60字，可手动补写或重新总结。',
    invalid:'AI 返回的一句话格式不符，可手动补写或重新总结。'
  };
  const latestHint=historical?'这通录音仅补入跟进日志，飞书最新通话记录保留原值。'
    :'只写有效进展或下一步，最多60字。留空保留飞书原值。';
  const blankReason=latestField.value?'':blankReasons[r.draft.latest_summary_reason]||'这份草稿未记录一句话的生成原因。';
  $('latest-summary-hint').textContent=[latestHint,blankReason].filter(Boolean).join(' ');
  $('review-detailed-log').textContent=r.draft.summary||'暂无跟进日志';
  currentPreserved={};
  for(const k of ['intent','next_date','next_purpose','reminder_date','reminder_note']){const proposed=r.draft[k],fallback=original[k]||'';f.elements[k].value=proposed??fallback;f.elements[k].disabled=!editable;if(proposed==null&&fallback)currentPreserved[k]=fallback;}
  const suggestedNextDate=editable?(r.suggestedNextDate||''):'';
  defaultNextDate=suggestedNextDate||(r.draft.default_follow_up?r.draft.next_date:'');
  if(suggestedNextDate)f.elements.next_date.value=suggestedNextDate;
  followUpHint.hidden=!editable||!defaultNextDate;
  clearControls.forEach(update=>update());
  const offer=!!r.draft.suggested_name&&!String(r.customer||'').trim();$('name-offer').hidden=!offer;f.elements.suggested_name.value=r.draft.suggested_name||'';f.elements.suggested_name.disabled=!editable||!offer;
  f.elements.approveName.checked=r.nameDecisionMade?!!r.nameApproved:true;f.elements.approveName.disabled=!editable||!offer;
  $('name-evidence').textContent='录音依据：'+(r.draft.name_evidence||'');
  $('review-history').hidden=!historical;
  $('write-scope').textContent=!r.recordId?'尚未关联客户：可核对草稿，关联后才允许保存到飞书。':historical?r.protection.reason+'。姓名可补空值，客群、留学报备和是否自有按确认的选项保存。':'保存前会重新核对飞书原值。';
  $('approve').hidden=!editable;$('transcript').textContent=r.transcript;reviewCustomer=r.customer||item.customer||'通话';reviewStamp=item.meta?.stamp||'';layoutReview();$('review').showModal();$('review-title').focus({preventScroll:true});$('review').querySelector('.review-body').scrollTop=0;$('review').scrollTop=0;clearControls.forEach(update=>update());
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
const recordingFiles=$('recording-files');
$('import').onclick=()=>recordingFiles.click();
recordingFiles.onchange=action(async()=>{
  const files=[...recordingFiles.files];
  recordingFiles.value='';
  if(!files.length)return;
  page='inbox';filter='all';
  render(await call('import',files));
  notice('导入完成。已匹配默认勾选；可补选未匹配录音。');
});
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
$('stop').onclick=action(async()=>{
  const mode=stopMode;
  await call('stop');
  stopRequested=mode==='batch'&&wasRunning;
  renderOperationStatus();
});$('commit').onclick=action(()=>call('commit',selectedIds('save')));
$('test').onclick=async()=>{try{alert(await call('test'));}catch(e){alert(e.message);}};$('close-review').onclick=()=>$('review').close();$('close-link').onclick=()=>$('link').close();
$('close-transcript-view').onclick=()=>$('transcript-view').close();
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
window.crm.onQueue(payload=>{
  const items=Array.isArray(payload)?payload:payload.items;
  const finishing=wasRunning&&operation==='analysis'&&!payload.running&&payload.analysisProgress===1;
  wasRunning=!!payload.running;operation=payload.operation;stopMode=payload.stopMode||null;
  if(wasRunning){
    clearTimeout(analysisCompletionTimer);
    analysisCompletionTimer=0;
    analysisProgress=operation==='analysis'?payload.analysisProgress:null;
  }else{
    stopRequested=false;
    if(finishing){
      analysisProgress=1;
      analysisCompletionTimer=setTimeout(()=>{analysisCompletionTimer=0;analysisProgress=null;render(currentItems);},700);
    }
  }
  render(items);
});
(async()=>{try{const s=await fillSettings();wasRunning=s.running;render(s.items);}catch(e){notice(e.message);}})();

window.addEventListener('resize',()=>{if($('review').open)clearControls.forEach(update=>update());});
