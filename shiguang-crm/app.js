'use strict';

const $ = id => document.getElementById(id);
const zone = 'Asia/Shanghai';
const proxyUrl = "https://feishu-le-proxy-wyyuhgxhep.cn-hangzhou.fcapp.run";
const intents = ['A','B','C','D','E','F','G','已报名','续费'];
const leadViews = {all:'全部线索',today:'今日待联系',week:'本周待联系',enrolled:'已报名',assignedToday:'今日分配',assignedMonth:'本月分配',strong:'近日强意向'};
const dateKey = date => new Intl.DateTimeFormat('sv-SE', {timeZone:zone}).format(date);
const today = dateKey(new Date());
function day(offset) {
  const date = new Date(today + 'T12:00:00+08:00');
  date.setUTCDate(date.getUTCDate() + offset);
  return dateKey(date);
}
const weekEnd = day(6 - (new Date(today + 'T00:00:00Z').getUTCDay()+6)%7);
const leadChoices = [
  ['意向','intent',intents],
  ['留学报备','studyReport',['是','否']],
  ['是否自有','owner',['是','否','曾哥','他人']],
  ['客群','audience',['小学生','初中生','高中生','大学生','成人']],
];
const leadFields = {
  name:'姓名', phone:'号码/微信', info:'具体信息',
  studyReport:'留学报备', owner:'是否自有/曾哥/他人', audience:'客群',
  intent:'意向', due:'下次跟进日期', purpose:'下次跟进目的',
  signup:'报名时间', reminder:'特殊提醒时间', reminderNote:'特殊提醒事项',
};
const studentViews = {all:'全部学员', today:'今日待联系', week:'本周待联系', month:'本月待联系', signedToday:'今日签约', signedMonth:'本月签约'};
const studentFields = {
  name:'学员姓名', phone:'乙方电话', guardian:'监护人姓名', guardianPhone:'监护人电话',
  contract:'合同类型', course:'课程方案', amount:'金额', arranged:'已排课程',
  study:'留学是否签约', signed:'签约日期', specialDate:'特殊提醒时间', specialNote:'特殊提醒事项', due:'提醒时间', purpose:'提醒备注', info:'备注',
};
let moduleId='leads';
let views=leadViews;
let loadVersion=0;
let ready=false;
let scopedLeads={};
let modalEntry;
const studentMode=()=>moduleId==='students';
const dateFields = new Set(['due','signup','reminder','assigned','signed','specialDate']);
function textValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(textValue).join('');
  if (typeof value === 'object') return textValue(value.text ?? value.value);
  return String(value);
}
function normalizeIntent(value) {
  const intent=textValue(value).trim();
  return /^已�+名$/.test(intent) ? '已报名' : intent;
}
function readDate(value) {
  if (!value) return '';
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? '' : dateKey(date);
}
function parseLogs(rawLog,latest) {
  return rawLog ? rawLog.split(/\n(?=\[\d{4}[/-])/).map(entry => {
    const match = entry.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    return match ? {date:match[1],text:match[2]} : {date:'',text:entry};
  }) : latest ? [{date:'最新通话记录',text:latest}] : [];
}
function lastLoggedDate(logs) {
  return logs.reduce((latest,{date})=>{
    const match=date.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s|$)/);
    if (!match) return latest;
    const key=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
    return key>latest ? key : latest;
  },'');
}
function fromFeishu({record_id, fields:f}, readStudent) {
  const fields = Object.fromEntries(Object.entries(readStudent?studentFields:leadFields).map(([name, column]) =>
    [name, dateFields.has(name) ? readDate(f[column]) : textValue(f[column])]));
  if (readStudent) return {
    ...fields, id:record_id, name:fields.name, phone:fields.phone,
    hasSpecialFields:Object.hasOwn(f,'特殊提醒时间') || Object.hasOwn(f,'特殊提醒事项'),
    signed:readDate(f['签约日期']), signedTime:Number(f['签约日期'])||0, updated:readDate(f['最后更新日期']), intent:'',
  };
  const rawLog = textValue(f['跟进日志']);
  const latest = textValue(f['最新通话记录']);
  const logs=parseLogs(rawLog,latest);
  const updated=readDate(f['最后更新时间']);
  const lastFollowUp=readDate(f['最后跟进时间']) || lastLoggedDate(logs) || (latest ? updated : '');
  return {
    ...fields, id:record_id, name:fields.name, intent:normalizeIntent(fields.intent),
    phone:textValue(f['号码/微信']), info:textValue(f['具体信息']),
    assigned:readDate(f['分配时间']), assignedTime:Number(f['分配时间'])||0, updated, lastFollowUp, logs, rawLog, latest,
  };
}
async function request(action, params={}) {
  const response = await fetch(proxyUrl, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...params}), signal:AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error('接口响应 HTTP '+response.status);
  const outer = await response.json();
  const result = typeof outer.body === 'string' ? JSON.parse(outer.body) : outer;
  if (result.code !== 0) throw new Error('飞书接口错误 '+(result.code ?? '未知'));
  return result.data;
}
function containsReplacement(value) {
  if (typeof value==='string') return value.includes('�');
  return value!==null && typeof value==='object' && Object.values(value).some(containsReplacement);
}

async function readFeishuItems(action,params) {
  const data=await request(action,params);
  const items=data?.items;
  if (!Array.isArray(items) || !items.some(item=>containsReplacement(item.fields))) return data;
  const retry=await request(action,params).catch(()=>null);
  if (!Array.isArray(retry?.items)) return data;
  const identity=item=>JSON.stringify([item._source,item.record_id]);
  const retryFields=new Map(retry.items.map(item=>[identity(item),item.fields]));
  return {...data,items:items.map(item=>{
    const clean=retryFields.get(identity(item));
    if (!clean || !containsReplacement(item.fields)) return item;
    const fields={...item.fields};
    for (const [key,value] of Object.entries(fields)) {
      if (containsReplacement(value) && Object.hasOwn(clean,key) && !containsReplacement(clean[key])) {
        fields[key]=clean[key];
      }
    }
    return {...item,fields};
  })};
}
async function fetchRecords(readStudent = studentMode()) {
  const data = await readFeishuItems(readStudent ? 'student_all' : 'all');
  if (!Array.isArray(data?.items) || data.has_more || data.total > data.items.length) {
    throw new Error('接口未返回完整的线索列表');
  }
  return data.items.map(item=>fromFeishu(item,readStudent));
}
async function readLatestLeadLog(record) {
  const query=[record.phone,record.name].map(value=>value?.trim()||'')
    .find(value=>value && !containsReplacement(value));
  if (!query) return (await fetchRecords(false)).find(item=>item.id===record.id)?.rawLog;
  const data=await request('search',{q:query});
  const item=data?.items?.find(item=>item.record_id===record.id);
  if (!item?.fields) return (await fetchRecords(false)).find(item=>item.id===record.id)?.rawLog;
  const log=textValue(item.fields['跟进日志']);
  if (!containsReplacement(log)) return log;
  const retry=await request('search',{q:query});
  const fresh=retry?.items?.find(item=>item.record_id===record.id);
  return fresh?.fields ? textValue(fresh.fields['跟进日志']) : log;
}

const recordCache=new Map();
const recordReads=new Map();

function readCachedRecords(readStudent, refresh=false) {
  if (recordReads.has(readStudent)) return recordReads.get(readStudent);
  if (!refresh && recordCache.has(readStudent)) return Promise.resolve(recordCache.get(readStudent));
  const pending=fetchRecords(readStudent).then(loaded=>{
    recordCache.set(readStudent,loaded);
    return loaded;
  }).finally(()=>recordReads.delete(readStudent));
  recordReads.set(readStudent,pending);
  return pending;
}

function cacheUpdatedRecord(readStudent, updated) {
  const cached=recordCache.get(readStudent);
  if (cached) recordCache.set(readStudent,cached.map(record=>record.id===updated.id ? updated : record));
}
let records = [];
let saving = false;
let filter = 'all';
let selected;
let drafts = new Map();
const justLogged=new Set();
let timer;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
function matches(record, view) {
  if (view==='all') return true;
  if (view==='signedToday') return record.signed===today;
  if (view==='signedMonth') return record.signed?.startsWith(today.slice(0,7));
  if (view==='month') return record.due?.startsWith(today.slice(0,7));
  if (studentMode()) return Boolean(record.due) && (view==='today' ? record.due===today : record.due>=day(-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)) && record.due<=weekEnd);
  if (view==='assignedToday') return record.assigned===today;
  if (view==='assignedMonth') return record.assigned?.startsWith(today.slice(0,7));
  if (view in leadScopes) return scopedLeads[view]?.has(record.id) ?? false;
  if (view==='enrolled') return record.intent==='已报名';
  return false;
}
function status(record) {
  if (record.intent==='已报名') return ['已报名','done'];
  if (!record.due) return ['未安排',''];
  if (record.due<today) return ['已逾期','danger'];
  if (record.due===today) return ['今日到期','active'];
  return [record.due.slice(5).replace('-','/'),''];
}
function options(values, value) {
  return values.map(item => '<option'+(item===value?' selected':'')+'>'+escape(item)+'</option>').join('');
}
const leadScopes={today:'today',week:'week',strong:'strong_intent'};
function metric(view) {
  if (!studentMode() && view in leadScopes && !scopedLeads[view]) return '—';
  const items=records.filter(record=>matches(record,view));
  if (!view.startsWith('signed')) return items.length;
  const amount=items.reduce((sum,record)=>sum+(Number(record.amount)||0),0);
  return '¥'+new Intl.NumberFormat('zh-CN').format(amount)+'<small> · '+items.length+' 笔</small>';
}
const extraLeadFields=['studyReport','owner','audience'];
const leadDateFilters=['lastFollowUp','assigned','due','reminder'];
const advancedFilterIds=[
  ...extraLeadFields.map(name=>'filter-'+name),
  ...leadDateFilters.flatMap(name=>[name+'-from',name+'-to']),
];

function syncDateClearButtons() {
  document.querySelectorAll('[data-clear-date]').forEach(button=>{
    button.hidden=!$(button.dataset.clearDate).value;
  });
}
function resetListFilters() {
  advancedFilterIds.forEach(id=>$(id).value='');
  $('search').value='';
  $('intent-filter').value='全部意向';
  syncDateClearButtons();
}
function buildLeadFilters() {
  const values=Object.fromEntries(extraLeadFields.map(name=>[name,$('filter-'+name).value]));
  const ranges=leadDateFilters.map(name=>({name,from:$(name+'-from').value,to:$(name+'-to').value}))
    .filter(({from,to})=>from||to);
  const datesInvalid=ranges.some(({from,to})=>from && to && from>to);
  $('filter-date-error').hidden=!datesInvalid;
  const active=Object.values(values).filter(Boolean).length+ranges.length;
  $('active-filters').textContent=active ? String(active) : '';
  $('active-filters').hidden=!active;
  return record=>!datesInvalid && Object.entries(values).every(([name,value])=>!value||record[name]===value) &&
    ranges.every(({name,from,to})=>record[name] && (!from||record[name]>=from) && (!to||record[name]<=to));
}
function refreshFilteredList() {
  syncDateClearButtons();
  fillList();
  $('list').scrollTop=0;
}
function recordRow(record, isStudent) {
  const [statusLabel,tone]=status(record);
  const name=record.name||(isStudent?'未命名学员':'未命名线索');
  const badge=(kind,value,label=value)=>value ?
    '<span class="lead-list-badge '+kind+'" data-value="'+escape(value)+'">'+escape(label)+'</span>' : '';
  const badges=isStudent
    ? badge('contract',record.contract)+badge('study',record.study,'留学签约 · '+record.study)
    : badge('audience',record.audience)+badge('intent',record.intent);
  const fields=isStudent
    ? [['签约',record.signed],['下次提醒',record.due]]
    : [['分配',record.assigned],['下次跟进',record.due]];
  const dates=fields.map(([label,date])=>'<span class="lead-list-date">'+label+' '+(date ?
    '<time datetime="'+escape(date)+'">'+escape(date)+'</time>' : '—')+'</span>').join('');
  const amount=String(record.amount ?? '').trim();
  const amountLabel=isStudent && amount && Number.isFinite(Number(amount)) ?
    '<span class="lead-list-amount">¥'+new Intl.NumberFormat('zh-CN').format(Number(amount))+'</span>' : '';
  const statusBadge=tone==='danger'||tone==='active' ?
    '<span class="pill '+tone+'">'+escape(statusLabel)+'</span>' : '';
  return '<button class="row lead-row" data-record="'+escape(record.id)+'" aria-current="'+(record.id===selected)+'">'+
    '<span class="lead-row-heading"><strong>'+escape(name)+'</strong>'+badges+'</span>'+
    '<span class="lead-row-dates">'+amountLabel+dates+statusBadge+'</span>'+
    '<span class="lead-row-preview">'+escape(record.purpose||record.info)+'</span></button>';
}
function fillList() {
  if (!ready) return;
  $('stats').innerHTML = Object.entries(views).filter(([id])=>id!=='all').map(([id,label]) =>
    '<button class="stat" data-filter="'+id+'" aria-pressed="'+(id===filter)+'"><b>'+
    metric(id)+'</b>'+label+'</button>').join('');
  document.querySelectorAll('nav [data-filter]').forEach(button =>
    button.setAttribute('aria-pressed',button.dataset.filter===filter));
  const query = $('search').value.trim().toLowerCase();
  const intent = $('intent-filter').value;
  const advanced=studentMode()?()=>true:buildLeadFilters();
  const subset = records.filter(record => matches(record,filter) && advanced(record) &&
    (studentMode()||intent==='全部意向'||record.intent===intent) &&
    [record.name,record.phone,record.info].some(value=>value.toLowerCase().includes(query)))
    .sort((a,b)=>studentMode() ? b.signedTime-a.signedTime : b.assignedTime-a.assignedTime);
  const previous=selected;
  if (!subset.some(record=>record.id===selected)) selected=subset[0]?.id;
  if (selected!==previous) fillDetail();
  $('queue-title').textContent=views[filter];
  $('reset-list-scope').hidden=filter==='all';
  $('result-count').textContent=subset.length+' 条';
  $('list').innerHTML=subset.map(record=>recordRow(record,studentMode())).join('') || (!studentMode() && filter in leadScopes && !scopedLeads[filter]
    ? (scopedLeads[filter]===null
      ? '<p class="empty">待联系数据读取失败 <button id="retry-scope" class="action">重试</button></p>'
      : loadingPanel('正在读取'+views[filter]))
    : '<p class="empty">没有符合条件的记录</p>');
}
function callLink(phone) {
  const number=phone.replace(/[\s-]/g,'');
  return /^\+?\d{7,}$/.test(number)
    ? '<a class="action" href="tel:'+escape(number)+'">拨打</a>' : '';
}
function field(label,name,value,type='text') {
  return '<label>'+label+'<input name="'+name+'" type="'+type+'"'+(type==='number'?' step="any"':'')+' value="'+escape(value)+'"></label>';
}
function clearableField(label,name,value,type='text') {
  const control=type==='textarea'?textarea(label,name,value):field(label,name,value,type);
  return '<div class="clearable-field">'+control+
    '<button type="button" class="field-clear" data-clear-field="'+name+'" aria-label="清除'+label+'"'+
    (value?'':' hidden')+'>×</button></div>';
}
function leadChoice(label,name,values,value) {
  const choices=[...new Set([...values,value].filter(Boolean))];
  return '<fieldset class="lead-choice choice-'+name+'"><legend>'+label+'</legend><div class="choice-options">'+
    choices.map(choice=>'<label><input type="radio" name="'+name+'" value="'+escape(choice)+'"'+
      (choice===(value||'')?' checked':'')+'><span>'+escape(name==='owner'&&choice==='是'?'自有':choice)+'</span></label>').join('')+
    '</div></fieldset>';
}
function textarea(label,name,value,rows=2) {
  return '<label>'+label+'<textarea name="'+name+'" rows="'+rows+'">'+escape(value)+'</textarea></label>';
}
function detailHeader(edit) {
  return '<header class="lead-banner">'+
    '<div class="lead-identity"><h2 tabindex="-1" id="detail-title">'+
    '<input aria-label="姓名" name="name" value="'+escape(edit.name)+'" placeholder="姓名"></h2>'+
    '<div class="lead-contact"><input aria-label="号码 / 微信" name="phone" type="text" inputmode="tel" value="'+
    escape(edit.phone)+'" placeholder="号码 / 微信"></div><span class="lead-contact-actions"><span class="lead-dial">'+callLink(edit.phone||'')+'</span></span></div>'+
    '<button type="button" class="back" id="back" aria-label="返回列表">‹</button></header>';
}
function saveBar(label) {
  return '<div class="save-bar"><button class="primary">'+label+'</button></div>';
}
function fillDetail(target=$('detail'), record=records.find(item=>item.id===selected), source=moduleId) {
  if (!record) { target.innerHTML='<p class="empty">当前列表没有可查看的记录</p>'; return; }
  const edit={...record,...drafts.get(source+':'+record.id)};
  if (source==='students') { fillStudent(target,record,edit); return; }
  const logs=record.rawLog ? parseLogs(record.rawLog,'') : [];
  const logItems=logs.slice(0,3).map(({date,text})=>
    '<li>'+(date?'<time>'+escape(date)+'</time>':'')+'<p>'+escape(text)+'</p></li>');
  const latestLogPreview=justLogged.has(record.id) && logItems.length
    ? '<ol class="recent-logs latest-log-preview">'+logItems[0]+'</ol>' : '';
  target.innerHTML='<form class="edit detail-form lead-form">'+
    detailHeader(edit)+'<div class="detail-body"><div class="lead-column">'+
    '<section class="edit-section lead-facts">'+
    textarea('具体信息','info',edit.info,3)+
    '<div class="grid lead-date-pair"><div class="record-readonly"><span>分配时间</span><p>'+
    escape(record.assigned||'—')+'</p></div>'+field('报名日期','signup',edit.signup,'date')+'</div></section>'+
    '<section class="edit-section lead-choices" aria-label="客户分类">'+leadChoices.map(([label,name,values])=>
      leadChoice(label,name,values,edit[name])).join('')+'</section></div>'+
    '<div class="lead-column"><section class="edit-section lead-latest"><div class="record-readonly">'+
    '<span>最新通话记录</span><p>'+escape(record.latest||'暂无通话记录')+'</p></div></section>'+
    '<section class="edit-section lead-log"><details class="log-history"><summary>跟进日志 <small>'+logItems.length+' 条</small></summary>'+
    (logItems.length?'<ol class="recent-logs">'+logItems.join('')+'</ol>':'<p class="quiet">暂无跟进日志</p>')+
    '</details>'+latestLogPreview+
    '<span class="quiet">本次跟进记录</span><div class="log-composer">'+
    '<textarea name="note" aria-label="本次跟进记录" rows="3" placeholder="记录跟进内容…">'+escape(edit.note)+'</textarea>'+
    '<button type="submit" value="send-log" aria-label="发送跟进记录" title="发送跟进记录">'+
    '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>'+
    '</button></div></section>'+
    '<section class="edit-section lead-dates"><h3>跟进安排</h3><div class="schedule-grid">'+
    clearableField('下次跟进日期','due',edit.due,'date')+clearableField('跟进目的','purpose',edit.purpose)+
    clearableField('特殊提醒时间','reminder',edit.reminder,'date')+clearableField('特殊提醒事项','reminderNote',edit.reminderNote)+
    '</div></section></div>'+saveBar('保存跟进')+'</div></form>';
}
function fillStudent(target,record,edit) {
  const details=[
    ['监护人姓名','guardian'],['监护人电话','guardianPhone','tel'],
    ['合同类型','contract'],['金额','amount','number'],
  ];
  target.innerHTML='<form class="edit detail-form">'+detailHeader(edit)+
    '<div class="detail-body"><section class="edit-section"><h3>台账资料</h3><div class="grid">'+
    details.map(([label,name,type])=>field(label,name,edit[name],type)).join('')+
    leadChoice('留学是否签约','study',['是','否'],['是','否'].includes(edit.study)?edit.study:'')+
    clearableField('签约日期','signed',edit.signed,'date')+'</div>'+
    '<div class="grid">'+textarea('课程方案','course',edit.course)+textarea('已排课程','arranged',edit.arranged)+'</div>'+
    '</section><section class="edit-section"><h3>提醒与备注</h3><div class="schedule-grid">'+
    clearableField('提醒时间','due',edit.due,'date')+clearableField('提醒备注','purpose',edit.purpose)+
    (record.hasSpecialFields ? clearableField('特殊提醒日期','specialDate',edit.specialDate,'date')+
      field('特殊提醒事项','specialNote',edit.specialNote) : '')+'</div>'+
    clearableField('备注','info',edit.info,'textarea')+'</section>'+saveBar('保存台账')+'</div></form>';
}
function notify(message) {
  const notice=$('record-dialog').open ? $('dialog-notice') : $('notice');
  notice.textContent=message;
  notice.hidden=false;
  clearTimeout(timer);
  timer=setTimeout(()=>notice.hidden=true,3000);
}
function showList() {
  document.body.dataset.view='list';
  document.querySelector('.row[aria-current=true]')?.focus();
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if (!button || (saving && !button.dataset.clearField)) return;
  if (button.dataset.module) switchModule(button.dataset.module);
  if (button.dataset.filter) {
    if (!studentMode()) {
      resetListFilters();
      $('lead-filters').open=false;
    }
    filter=button.dataset.filter;
    document.body.dataset.view='list';
    fillList();
    $('list').scrollTop=0;
    if (button.dataset.filter in leadScopes && scopedLeads[filter]===null) loadLeadScopes(loadVersion,true);
    document.querySelector('.stat[data-filter="'+filter+'"]')?.focus({preventScroll:true});
  }
  if (button.dataset.clearDate) {
    const input=$(button.dataset.clearDate);
    input.value='';
    refreshFilteredList();
    input.focus({preventScroll:true});
  }
  if (button.dataset.clearField) {
    const input=button.closest('.clearable-field').querySelector('input,textarea');
    input.value='';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.focus({preventScroll:true});
  }
  if (button.dataset.record) {
    const record=records.find(item=>item.id===button.dataset.record);
    if (!record) return;
    selected=record.id;
    $('list').querySelector('[aria-current="true"]')?.setAttribute('aria-current','false');
    button.setAttribute('aria-current','true');
    fillDetail();
    if (matchMedia('(max-width:760px)').matches) {
      openHomeRecord({source:moduleId,record});
    } else {
      $('detail').scrollTop=0;
      $('detail-title')?.focus({preventScroll:true});
    }
  }
  if (button.id==='back') showList();
  if (button.id==='retry-scope') loadLeadScopes(loadVersion,true);
  if (button.id==='refresh-module') connect(true);

});
document.addEventListener('input',event=>{
  const form=event.target.closest('form.edit');
  if (!form) return;
  const clear=event.target.closest('.clearable-field')?.querySelector('.field-clear');
  if (clear) clear.hidden=!event.target.value;
  if (event.target.name==='phone') form.querySelector('.lead-dial').innerHTML=callLink(event.target.value);
  const entry=form.closest('dialog') ? modalEntry : null;
  drafts.set((entry?.source ?? moduleId)+':'+(entry?.record.id ?? selected),Object.fromEntries(new FormData(form)));
});
document.addEventListener('submit',async event=>{
  if (!event.target.matches('form.edit')) return;
  event.preventDefault();
  const entry=event.target.closest('dialog') ? modalEntry : null;
  if (saving || (!entry && !ready)) { notify('请等待飞书连接完成后再保存'); return; }
  const {note='',...fields}=Object.fromEntries(new FormData(event.target));
  const source=entry?.source ?? moduleId;
  const isStudent=source==='students';
  const id=entry?.record.id ?? selected;
  const current=entry?.record ?? records.find(record=>record.id===id);
  const writableFields=isStudent?studentFields:leadFields;
  const sendOnly=event.submitter?.value==='send-log';
  if (sendOnly && !note.trim()) { notify('请输入本次跟进记录'); return; }
  const changes=sendOnly ? [] : Object.keys(fields).filter(name=>Object.hasOwn(writableFields,name) && current[name]!==fields[name]);
  if (!note.trim() && !changes.length) {
    if (entry) $('record-dialog').close();
    else notify('没有需要保存的变更');
    return;
  }
  const patch=Object.fromEntries(changes.map(name=>[
    writableFields[name], dateFields.has(name)
      ? (fields[name] ? Date.parse(fields[name]+'T23:59:00+08:00') : null)
      : (fields[name] ? (name==='amount' ? Number(fields[name]) : fields[name]) : null),
  ]));
  saving=true;
  const form=event.target;
  const controls=[...form.elements].filter(control=>!control.disabled && (!sendOnly||control.type==='submit'));
  controls.forEach(control=>control.disabled=true);
  if (sendOnly) notify('正在发送跟进记录…');
  try {
    if (!isStudent && note.trim()) {
      const rawLog=await readLatestLeadLog(current);
      if (rawLog===undefined) throw new Error('飞书中找不到这条线索');
      if (containsReplacement(rawLog)) throw new Error('历史日志读取不完整，请稍后重试');
      const now=new Date();
      const time=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
      const logLine='['+dateKey(now).replaceAll('-','/')+' '+time+'] '+note.trim();
      patch['跟进日志']=logLine+(rawLog?'\n'+rawLog:'');
    }
    await request(isStudent?'student_update':'update',{recordId:id,fields:patch});
    const newLog=patch['跟进日志'];
    const updated={...current,...Object.fromEntries(changes.map(name=>[name,fields[name]]))};
    if (Object.hasOwn(patch,'跟进日志')) {
      justLogged.add(id);
      updated.rawLog=newLog||'';
      updated.logs=parseLogs(updated.rawLog,current.latest);
      updated.lastFollowUp=lastLoggedDate(updated.logs)||current.lastFollowUp;
    }
    const draftKey=source+':'+id;
    const savedDraft=drafts.get(draftKey);
    drafts.delete(draftKey);
    if (sendOnly) {
      const liveFields=form.isConnected ? Object.fromEntries(new FormData(form)) : (savedDraft??{...fields,note});
      const pending=Object.fromEntries(Object.entries(liveFields).filter(([name,value])=>
        name==='note' ? Boolean(value && value!==note) : Object.hasOwn(writableFields,name) && value!==current[name]));
      if (Object.keys(pending).length) drafts.set(draftKey,pending);
    }
    cacheUpdatedRecord(isStudent,updated);
    if (entry) {
      entry.record=updated;
      if (modalEntry===entry && sendOnly) renderRecordDialog();
    }
    if (source===moduleId && ready) {
      records=records.map(record=>record.id===id ? updated : record);
      fillList();
      if (selected===id) fillDetail();
    }
    document.dispatchEvent(new CustomEvent('crm-record-saved',{detail:{source,record:updated}}));
    if (!isStudent && changes.some(name=>name==='due' || name==='intent')) {
      leadScopeRead=undefined;
      leadScopeCache=undefined;
      if (moduleId==='leads' && ready) loadLeadScopes(loadVersion,true);
    }
    if (entry && !sendOnly) $('record-dialog').close();
    else notify(sendOnly?'跟进记录已发送':'跟进已保存到飞书');
  } catch (error) {
    notify('保存未确认：'+error.message);
  } finally {
    saving=false;
    controls.forEach(control=>control.disabled=false);

  }
});
$('date').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'long',day:'numeric',weekday:'long'}).format(new Date());
$('intent-filter').innerHTML=options(['全部意向',...intents],'全部意向');
$('search').addEventListener('input',refreshFilteredList);
$('intent-filter').addEventListener('change',refreshFilteredList);
for (const [,name,values] of leadChoices.slice(1)) {
  $('filter-'+name).innerHTML='<option value="">全部</option>'+values.map(value=>
    '<option value="'+escape(value)+'">'+escape(name==='owner'&&value==='是'?'自有':value)+'</option>').join('');
}
advancedFilterIds.forEach(id=>$(id).addEventListener('change',refreshFilteredList));
leadDateFilters.forEach(name=>['from','to'].forEach(bound=>$(name+'-'+bound).addEventListener('input',syncDateClearButtons)));
$('reset-filters').addEventListener('click',()=>{
  resetListFilters();
  refreshFilteredList();
});
let leadScopeRead;
let leadScopeCache;
async function loadLeadScopes(version, refresh=false) {
  if (studentMode()) return;
  if (!leadScopeRead && (refresh || !leadScopeCache)) {
    const pending=Promise.all(Object.entries(leadScopes).map(async ([view,action])=>{
      try {
        const data=await request(action);
        if (!Array.isArray(data?.items) || data.has_more || data.total>data.items.length) throw new Error('Incomplete scope');
        return [view,new Set(data.items.map(item=>item.record_id))];
      } catch { return [view,null]; }
    })).then(entries=>Object.fromEntries(entries));
    leadScopeRead=pending;
    pending.then(scopes=>{
      if (leadScopeRead===pending) { leadScopeCache=scopes; leadScopeRead=undefined; }
    });
  }
  const scopes=leadScopeRead ? await leadScopeRead : leadScopeCache;
  if (version!==loadVersion) return;
  scopedLeads=scopes;
  fillList();
}
async function connect(refresh=false) {
  const version=++loadVersion;
  const readStudent=studentMode();
  const previous=selected;
  const button=$('refresh-module');
  button.disabled=true;
  if (refresh && ready) $('connection').textContent='正在更新…';
  try {
    const loaded=await readCachedRecords(readStudent,refresh);
    if (version!==loadVersion) return;
    records=loaded;
    ready=true;
    selected=previous;
    const extraIntents=records.map(record=>record.intent).filter(intent=>intent && !intent.includes('�'));
    const currentIntent=$('intent-filter').value;
    $('intent-filter').innerHTML=options([...new Set(['全部意向',...intents,...extraIntents])],currentIntent);
    $('connection').textContent='已连接飞书';
    fillList();
    fillDetail();
    if (!readStudent) loadLeadScopes(version,refresh);
  } catch (error) {
    if (version!==loadVersion) return;
    if (ready) { $('connection').textContent='更新失败'; notify('更新失败，正在显示上次读取的数据'); return; }
    $('connection').textContent='连接失败';
    $('detail').innerHTML='<p class="empty">重新连接后可查看详情</p>';
    document.body.dataset.view='list';
    $('list').innerHTML='<p class="empty">'+escape(error.message)+' <button id="retry" class="action">重试</button></p>';
  } finally {
    if (version===loadVersion) button.disabled=false;
  }
}
function switchModule(id) {
  document.body.dataset.page='module';
  $('home').hidden=true;
  $('module-page').hidden=false;
  $('home-link').removeAttribute('aria-current');
  document.querySelectorAll('[data-module]').forEach(button=>
    button.setAttribute('aria-pressed',button.dataset.module===id));
  if (moduleId===id && ready) {
    const cached=recordCache.get(studentMode());
    if (cached && records!==cached) {
      records=cached;
      fillList();
      fillDetail();
    }
    if (!studentMode() && !leadScopeCache) loadLeadScopes(loadVersion);
    return;
  }
  moduleId=id;
  ready=false;
  records=[];
  scopedLeads=id==='leads' ? leadScopeCache ?? {} : {};
  selected=undefined;
  filter='all';
  views=studentMode()?studentViews:leadViews;
  document.body.dataset.view='list';
  $('title').textContent=studentMode()?'学员台账':'分配数据';
  $('views').innerHTML=Object.entries(views).map(([id,label])=>
    '<button data-filter="'+id+'" aria-pressed="'+(id==='all')+'">'+label+'</button>').join('');
  $('queue-title').textContent=views.all;
  $('reset-list-scope').hidden=true;
  $('search').value='';
  $('search').placeholder=studentMode()?'搜索学员、号码或备注':'搜索姓名、号码或备注';
  $('intent-filter').hidden=studentMode();
  $('lead-filters').hidden=studentMode();
  $('result-count').textContent='';
  $('stats').innerHTML='';
  $('detail').innerHTML=loadingPanel('正在准备记录详情');
  $('connection').textContent='正在连接飞书…';
  $('list').innerHTML=loadingPanel('正在读取飞书记录');
  connect();
}
$('list').addEventListener('click',event=>{
  if (event.target.id==='retry') connect(true);
});
function loadingPanel(label) {
  return '<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span>'+
    '<strong>'+label+'</strong><div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div></div>';
}
