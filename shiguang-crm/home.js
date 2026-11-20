'use strict';

const sourceNames = {leads:'分配数据',students:'学员台账'};
let focusDate=today;
let span='month';
let calendarMode='followup';
let calendarState={};
let calendarVersion=0;
let searchVersion=0;
let openItems=[];
let results=[];
const monthPreviewCount=3;
const expandedMonthDays=new Set();


function shiftDate(date, delta) {
  const value=new Date(date+'T12:00:00Z');
  value.setUTCDate(value.getUTCDate()+delta);
  return value.toISOString().slice(0,10);
}

function monthShift(date, delta) {
  const value=new Date(date.slice(0,7)+'-01T12:00:00Z');
  value.setUTCMonth(value.getUTCMonth()+delta);
  return value.toISOString().slice(0,10);
}

function weekDay(date) {
  return (new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
}

function phoneKey(value) {
  const text=String(value).trim();
  if (!/^\+?[\d\s()-]+$/.test(text)) return '';
  const digits=text.replace(/\D/g,'');
  return digits.length===13 && digits.startsWith('86') ? digits.slice(2) : digits;
}

function calendarEvents() {
  if (calendarMode!=='followup') {
    const contracts=calendarMode==='contracts';
    const source=contracts?'students':'leads';
    const field=contracts?'signed':'assigned';
    return (calendarState[source]?.records ?? [])
      .filter(record=>record[field])
      .map(record=>({date:record[field],kind:contracts?'签约':'分配',source,record,name:record.name}));
  }
  const names=new Map();
  for (const source of ['students','leads']) {
    for (const record of calendarState[source]?.records ?? []) {
      const phone=phoneKey(record.phone);
      if (phone.length<7 || !record.name || record.name.startsWith('未命名')) continue;
      if (!names.has(phone)) names.set(phone,new Set());
      names.get(phone).add(record.name);
    }
  }
  const events=[];
  for (const source of Object.keys(sourceNames)) {
    for (const record of calendarState[source]?.records ?? []) {
      const aliases=names.get(phoneKey(record.phone));
      const name=aliases?.size===1 ? [...aliases][0] : record.name;
      const add=(field,kind,note)=>{ if (record[field]) events.push({date:record[field],field,kind,note,source,record,name}); };
      if (source==='leads') {
        if (record.intent!=='已报名') add('due','待联系',record.purpose);
        add('reminder','特殊提醒',record.reminderNote);
      } else {
        add('due','台账提醒',record.purpose);
        if (record.specialDate!==record.due || record.specialNote!==record.purpose) {
          add('specialDate','特殊提醒',record.specialNote);
        }
      }
    }
  }
  return events;
}

function renderCalendar() {
  const followup=calendarMode==='followup';
  const contracts=calendarMode==='contracts';
  document.querySelectorAll('[data-calendar-mode]').forEach(button=>
    button.setAttribute('aria-pressed',String(button.dataset.calendarMode===calendarMode)));
  $('source').closest('.calendar-filters').hidden=!followup;
  document.querySelectorAll('[data-span]').forEach(button=>
    button.setAttribute('aria-pressed',String(button.dataset.span===span)));
  const month=span==='month';
  const first=focusDate.slice(0,7)+'-01';
  const until=monthShift(first,1);
  const start=month ? shiftDate(first,-weekDay(first)) : focusDate;
  let length=Number(span);
  if (month) {
    const days=Math.round((Date.parse(until)-Date.parse(first))/86400000);
    length=Math.ceil((weekDay(first)+days)/7)*7;
  }
  const end=shiftDate(start,length-1);
  $('period').textContent=month ? first.slice(0,7).replace('-',' 年 ')+' 月'
    : start+(length>1?' 至 '+end:'');
  const events=calendarEvents();
  const source=followup?$('source').value:'';
  const kind=followup?$('kind').value:'';
  const byDate=new Map();
  openItems=[];
  for (const item of events) {
    if (item.date<start || item.date>end || (source && item.source!==source) || (kind && item.kind!==kind)) continue;
    if (!byDate.has(item.date)) byDate.set(item.date,[]);
    byDate.get(item.date).push(item);
  }
  const days=Array.from({length},(_,index)=>{
    const date=shiftDate(start,index);
    const slots=byDate.get(date) || [];
    const extra=month ? Math.max(0,slots.length-monthPreviewCount) : 0;
    const expanded=extra>0 && expandedMonthDays.has(calendarMode+':'+date);
    return '<div class="calendar-day'+(date===today?' current':'')+(month && (date<first||date>=until)?' outside':'')+
      (expanded?' month-expanded':'')+'" data-day="'+date+'">'+
      '<div class="day-label"><time datetime="'+date+'"'+(date===today?' aria-current="date"':'')+'>'+Number(date.slice(-2))+'</time><span>周'+
      '一二三四五六日'[weekDay(date)]+'</span></div><div class="appointments" id="appointments-'+date+'">'+
      slots.map((item,itemIndex)=>{
        const idx=openItems.push(item)-1;
        const name=item.name||'未命名';
        const ledgerReminder=followup && item.source==='students';
        const owned=item.source==='leads' && ['是','自有'].includes(item.record.owner);
        const nameLabel=owned
          ? '<span class="appointment-owned-label"><span class="appointment-owned-name">'+escape(name)+
            '</span><span class="appointment-owned-dot" aria-label="自有" role="img"></span></span>'
          : escape(name);
        return '<button class="appointment'+(ledgerReminder?' ledger-reminder':'')+(item.kind==='特殊提醒'?' special':'')+
          (month && itemIndex>=monthPreviewCount?' month-extra':'')+'" data-event="'+idx+
          '" draggable="'+(followup && span!=='1')+'" data-intent="'+escape(item.record.intent)+
          '" data-contract="'+escape(contracts||ledgerReminder?item.record.contract:'')+'" title="'+escape(name+(owned?'（自有）':''))+'">'+nameLabel+'</button>';
      }).join('')+'</div>'+(extra ?
        '<button type="button" class="month-more" aria-expanded="'+expanded+'" aria-controls="appointments-'+date+
          '" data-month-extra="'+extra+'">'+(expanded?'收起':'还有 '+extra+' 条')+'</button>' : '')+'</div>';
  }).join('');
  const relevantSources=followup?Object.keys(sourceNames):[contracts?'students':'leads'];
  const pending=relevantSources.some(id=>!calendarState[id]);
  const failed=relevantSources.filter(id=>calendarState[id]?.error);
  const banner=failed.length ? '<div class="calendar-status">'+failed.map(id=>sourceNames[id]).join('、')+
    '读取失败 <button class="action" id="retry-calendar">重试</button></div>' : '';
  $('calendar-body').innerHTML=banner+(pending && !events.length ? loadingPanel(followup?'正在读取双表日历':contracts?'正在读取签约日历':'正在读取分配日历') :
    (pending?'<p class="calendar-status">正在读取其余事项…</p>':'')+
    '<div class="calendar-grid span-'+span+'">'+days+'</div>');
  syncMonthToggle();
}

function syncMonthToggle() {
  const buttons=[...$('calendar-body').querySelectorAll('.month-more')];
  const toggle=$('toggle-month-days');
  toggle.hidden=!buttons.length;
  const allExpanded=buttons.length>0 && buttons.every(button=>button.getAttribute('aria-expanded')==='true');
  toggle.textContent=allExpanded?'全部收起':'全部展开';
  return {buttons,allExpanded};
}

function setMonthDayExpanded(button, expanded) {
  const cell=button.closest('.calendar-day');
  const key=calendarMode+':'+cell.dataset.day;
  cell.classList.toggle('month-expanded',expanded);
  if (expanded) expandedMonthDays.add(key);
  else expandedMonthDays.delete(key);
  button.setAttribute('aria-expanded',String(expanded));
  button.textContent=expanded?'收起':'还有 '+button.dataset.monthExtra+' 条';
}

async function loadCalendar(refresh=false) {
  const version=++calendarVersion;
  renderCalendar();
  $('refresh-calendar').disabled=true;
  await Promise.all(Object.keys(sourceNames).map(async source=>{
    let state;
    try { state={records:await readCachedRecords(source==='students',refresh)}; }
    catch { state={records:calendarState[source]?.records,error:true}; }
    if (version===calendarVersion) {
      calendarState[source]=state;
      renderCalendar();
    }
  }));
  if (version===calendarVersion) $('refresh-calendar').disabled=false;
}

function showHome() {
  if (saving) return;
  $('home').hidden=false;
  $('module-page').hidden=true;
  $('home-link').setAttribute('aria-current','page');
  document.querySelectorAll('[data-module]').forEach(button=>button.setAttribute('aria-pressed','false'));
  document.body.dataset.page='home';
  document.body.dataset.view='list';
}

function openHomeRecord(item) {
  if (!item || saving) return;
  modalEntry={...item};
  renderRecordDialog();
  $('record-dialog').showModal();
}

function renderRecordDialog() {
  const {source,record}=modalEntry;
  const target=$('dialog-record');
  fillDetail(target,record,source);
  const badge=document.createElement('span');
  badge.className='record-source';
  badge.dataset.source=source;
  badge.textContent=source==='students'?'织网':'寻迹';
  target.querySelector('.lead-contact-actions').prepend(badge);
  // The module page can retain its own selection while the dialog is open.
  for (const node of $('dialog-record').querySelectorAll('[id]')) {
    node.id='dialog-'+node.id;
  }
}

$('record-dialog').addEventListener('cancel',event=>{
  if (saving) event.preventDefault();
});
$('record-dialog').addEventListener('close',()=>{
  modalEntry=undefined;
  $('dialog-record').replaceChildren();
  $('dialog-notice').hidden=true;
});

async function loadQuote(refresh=false) {
  const button=$('quote-refresh');
  button.disabled=true;
  try {
    let cached;
    try { cached=JSON.parse(localStorage.getItem('shiguang-quote')); } catch {}
    if (!refresh && cached?.date===today && cached.text) { $('quote').textContent=cached.text; return; }
    const response=await fetch('https://v1.hitokoto.cn/?c=b&c=d&c=k',{signal:AbortSignal.timeout(7000),cache:'no-store'});
    if (!response.ok) throw new Error('quote');
    const data=await response.json();
    if (!data.hitokoto) throw new Error('quote');
    const author=[data.from_who,data.from].filter(Boolean).join(' · ');
    const text='「'+data.hitokoto+'」'+(author?' —— '+author:'');
    $('quote').textContent=text;
    try { localStorage.setItem('shiguang-quote',JSON.stringify({date:today,text})); } catch {}
  } catch {
    if (refresh) notify('暂时无法获取新名言');
  } finally { button.disabled=false; }
}

$('global-search').addEventListener('submit',async event=>{
  event.preventDefault();
  const input=$('caller').value.trim();
  if (!input) return;
  const version=++searchVersion;
  const panel=$('search-results');
  panel.hidden=false;
  panel.innerHTML=loadingPanel('正在搜索分配数据和学员台账');
  try {
    const data=await readFeishuItems('combined_search',{q:phoneKey(input)||input});
    if (version!==searchVersion) return;
    if (!Array.isArray(data?.items)) throw new Error('搜索结果格式异常');
    results=data.items.map(item=>{
      const source=item._source==='dist'?'leads':'students';
      return {source,record:fromFeishu(item,source==='students')};
    });
    panel.innerHTML=results.map(({source,record},index)=>
      '<button class="search-result" data-result="'+index+'"><strong>'+escape(record.name||'未命名')+
      '</strong><span>'+escape(record.phone||'无号码')+'</span><small>'+sourceNames[source]+'</small></button>'
    ).join('') || '<p class="empty">两张表都没有找到匹配记录</p>';
  } catch {
    if (version===searchVersion) panel.innerHTML='<p class="empty">搜索失败，请再点一次搜索</p>';
  }
});

document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if (!button) return;
  if (button.id==='home-link') showHome();
  if (button.id==='close-record' && !saving) $('record-dialog').close();
  if (button.id==='toggle-month-days') {
    const {buttons,allExpanded}=syncMonthToggle();
    buttons.forEach(item=>setMonthDayExpanded(item,!allExpanded));
    syncMonthToggle();
  }
  if (button.dataset.monthExtra) {
    setMonthDayExpanded(button,button.getAttribute('aria-expanded')!=='true');
    syncMonthToggle();
  }
  if (button.dataset.event!==undefined) openHomeRecord(openItems[Number(button.dataset.event)]);
  if (button.dataset.result!==undefined) openHomeRecord(results[Number(button.dataset.result)]);
  if (button.id==='quote-refresh') loadQuote(true);
  if (button.id==='retry-calendar' || button.id==='refresh-calendar') loadCalendar(true);
  if (button.dataset.calendarMode) { calendarMode=button.dataset.calendarMode; renderCalendar(); }
  if (button.dataset.span) { span=button.dataset.span; renderCalendar(); }
  if (button.id==='cal-today') { focusDate=today; renderCalendar(); }
  if (button.id==='previous' || button.id==='next') {
    const delta=button.id==='previous'?-1:1;
    focusDate=span==='month'?monthShift(focusDate,delta):shiftDate(focusDate,delta*Number(span));
    renderCalendar();
  }
});
$('source').addEventListener('change',renderCalendar);
$('kind').addEventListener('change',renderCalendar);
document.addEventListener('crm-record-saved',event=>{
  const {source,record}=event.detail;
  const cached=recordCache.get(source==='students');
  if (cached) calendarState[source]={records:cached};
  results=results.map(item=>item.source===source && item.record.id===record.id ? {...item,record} : item);
  renderCalendar();
});
loadQuote();
loadCalendar();

let draggedItem;
let dropTarget;

function setDropTarget(cell) {
  dropTarget?.classList.remove('calendar-drop-target');
  dropTarget=cell;
  dropTarget?.classList.add('calendar-drop-target');
}

function clearCalendarDrag() {
  draggedItem=undefined;
  setDropTarget(undefined);
  $('calendar-body').querySelector('.appointment.is-dragging')?.classList.remove('is-dragging');
}

async function moveCalendarItem(item, date) {
  if (!item || saving || item.date===date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const isStudent=item.source==='students';
  const column=(isStudent?studentFields:leadFields)[item.field];
  if (!column) return;
  saving=true;
  try {
    await request(isStudent?'student_update':'update',{
      recordId:item.record.id,
      fields:{[column]:Date.parse(date+'T23:59:00+08:00')},
    });
    const updated={...item.record,[item.field]:date};
    cacheUpdatedRecord(isStudent,updated);
    if (item.field==='due' && !isStudent) {
      leadScopeCache=undefined;
      leadScopeRead=undefined;
    }
    const draft=drafts.get(item.source+':'+item.record.id);
    if (draft?.[item.field]===item.date) delete draft[item.field];
    document.dispatchEvent(new CustomEvent('crm-record-saved',{detail:{source:item.source,record:updated}}));
    notify(item.kind+'已改到 '+date);
  } catch (error) {
    notify('改期未确认，日历保留原日期：'+error.message);
  } finally {
    saving=false;
  }
}

const calendarBody=$('calendar-body');
calendarBody.addEventListener('dragstart',event=>{
  const button=event.target.closest('.appointment');
  if (!button) return;
  if (saving || $('refresh-calendar').disabled || calendarMode!=='followup' || span==='1') { event.preventDefault(); return; }
  draggedItem=openItems[Number(button.dataset.event)];
  if (!draggedItem) { event.preventDefault(); return; }
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain','calendar-appointment');
  button.classList.add('is-dragging');
});
calendarBody.addEventListener('dragover',event=>{
  const cell=event.target.closest('[data-day]');
  if (!draggedItem || !cell) return;
  event.preventDefault();
  const valid=cell.dataset.day!==draggedItem.date;
  setDropTarget(valid?cell:undefined);
  event.dataTransfer.dropEffect=valid?'move':'none';
});
calendarBody.addEventListener('dragleave',event=>{
  if (dropTarget && !dropTarget.contains(event.relatedTarget)) setDropTarget(undefined);
});
calendarBody.addEventListener('drop',event=>{
  const cell=event.target.closest('[data-day]');
  if (!draggedItem || !cell) return;
  event.preventDefault();
  const item=draggedItem;
  clearCalendarDrag();
  moveCalendarItem(item,cell.dataset.day);
});
calendarBody.addEventListener('dragend',clearCalendarDrag);
