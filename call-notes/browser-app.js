import {get,set,batch,openDB,storageError,hashFile,MAX_FILE,path} from './browser-platform.js';
import {PROXY,Queue,Services,httpURL,parseName,fieldText,recordSnapshot,recencyGuard,validateDraft} from './core.js';
const $=id=>document.getElementById(id);
const defaults={proxy:PROXY,audioProvider:'aliyun',audioBase:'https://dashscope.aliyuncs.com/compatible-mode/v1',audioModel:'qwen-audio-3.1-asr-flash',textBase:'https://dashscope.aliyuncs.com/compatible-mode/v1',textModel:'qwen-plus',autoWrite:false};
let settings,queue,keys={audio:'',text:''},busy=false,ready=false,lastError='',backupAt=null;
const listeners=[];
function publish(items=queue?.publicItems()||[]){for(const fn of listeners)fn({items,running:busy||!!queue?.running,operation:queue?.operation});}
function idle(){if(!ready)throw Error(lastError||'正在打开本地数据库，请稍后重试');if(storageError)throw storageError;if(busy||queue.running)throw Error('请等待当前操作结束');}
function checkSettings(raw){const next={audioProvider:raw.audioProvider==='aliyun'?'aliyun':'openai',proxy:PROXY,autoWrite:false};for(const k of ['audioBase','textBase'])next[k]=httpURL(raw[k]);for(const k of ['audioModel','textModel']){next[k]=String(raw[k]||'').trim();if(!next[k]||next[k].length>160)throw Error('请填写有效的模型名称');}if(next.audioModel==='qwen3-asr-flash')next.audioModel='qwen-audio-3.1-asr-flash';return next;}
function chooseFile(accept,multiple=false){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;document.body.append(input);const finish=files=>{input.remove();resolve(files);};input.onchange=()=>finish([...input.files]);input.oncancel=()=>finish([]);input.click();});}
async function withBusy(fn){idle();busy=true;publish();try{return await fn();}finally{busy=false;publish();}}
async function importRecordings(){
  idle();const files=await chooseFile('.wav,.mp3,.m4a,.mp4,.flac,.ogg,.webm,.mpeg,.mpga',true);if(!files.length)return queue.publicItems();
  await withBusy(async()=>{
    for(const file of files){
      try{
        const meta=parseName(file.name);if(file.size>MAX_FILE)throw Error('单个录音最多支持 512 MB');
        const id=await hashFile(file),key='audio/'+id+path.extname(file.name).toLowerCase(),existing=queue.items.find(i=>i.id===id);
        const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&estimate.quota-estimate.usage<file.size*1.1)throw Error('浏览器可用存储不足，请先导出备份并清理已归档录音。');
        // Save recording and queue reference atomically, including restoring an omitted backup recording.
        const item=existing?{...existing,file:key}:{id,file:key,filename:file.name,meta,status:'queued',message:'待匹配客户',selectedAnalysis:false,selectedSave:false,selectedItem:false};
        const items=queue.items.filter(i=>i!==existing&&!(i.status==='invalid'&&i.filename===file.name&&!i.trashedAt));items.push(item);items.sort((a,b)=>(a.meta?.epoch||0)-(b.meta?.epoch||0));
        await batch([{key,value:file},{key:'queue',value:items}]);queue.items=items;publish();
      }catch(e){if(storageError)throw e;queue.items.push({id:crypto.randomUUID(),filename:file.name,status:'invalid',message:e.message});await queue.persist();}
    }
    await queue.prepareMatches();
  });await storageStatus();return queue.publicItems();
}
const handlers={
  state:async()=>{await initialized;if(!ready)throw Error(lastError||'初始化失败');return {settings,hasAudioKey:!!keys.audio,hasTextKey:!!keys.text,items:queue.publicItems(),running:busy||queue.running};},
  settings:async raw=>{idle();const next=checkSettings(raw),nextKeys={...keys};for(const [k,base]of [['audio','audioBase'],['text','textBase']]){if(raw[k+'Key']?.trim())nextKeys[k]=raw[k+'Key'].trim();else if(next[base]!==settings[base])nextKeys[k]='';}await set('settings',next);settings=next;keys=nextKeys;queue.services=new Services(settings,keys);return {settings,hasAudioKey:!!keys.audio,hasTextKey:!!keys.text};},
  'aliyun-setup':async()=>{idle();const base=httpURL(settings.textBase);if(!new URL(base).hostname.endsWith('.aliyuncs.com')||!base.endsWith('/compatible-mode/v1'))throw Error('请先在右侧保存百炼 Base URL');if(!keys.text)throw Error('请先在右侧保存百炼密钥');const next={...settings,audioProvider:'aliyun',audioBase:base,audioModel:'qwen-audio-3.1-asr-flash'};await set('settings',next);settings=next;keys.audio=keys.text;queue.services=new Services(settings,keys);return true;},
  import:importRecordings,
  process:async selected=>{idle();if(!keys.audio||!keys.text)throw Error('请先在连接与设置中输入本次会话的转写和总结密钥');const ids=window.crmView.actionIds(queue.items,selected,'analysis');if(!ids.length)throw Error('请勾选要分析的录音；从备份恢复后请先重新导入原始录音');queue.process(false,ids).catch(showError);publish();return true;},
  stop:()=>{queue.stop=true;return true;},
  commit:async selected=>{idle();const ids=window.crmView.actionIds(queue.items,selected,'save');if(!ids.length)throw Error('请先核对并勾选可保存的草稿');if(!confirm(`将 ${ids.length} 条草稿保存到飞书？\n请勿同时在其他 App 编辑相同客户。写入前会重读日志，但无法消除跨应用同时写入的冲突。`))return false;queue.commitReady(ids).catch(showError);publish();return true;},
  draft:async id=>{idle();const i=queue.items.find(i=>i.id===id);if(!i?.draft)throw Error('草稿不存在');let original=null;if(i.recordId){const records=await queue.resolve(i);if(records.length===1){i.customer=fieldText(records[0].fields?.['姓名']).trim();i.protection=recencyGuard(records[0],i.meta);original=recordSnapshot(records[0]);}}return {draft:i.draft,original,transcript:i.transcript||'',status:i.status,protection:i.protection,customer:i.customer,recordId:i.recordId,nameApproved:i.nameApproved,nameDecisionMade:i.nameDecisionMade};},
  approve:(...args)=>queue.approve(...args),retry:id=>queue.recover(id),select:(...args)=>queue.select(...args),candidates:(...args)=>queue.findCandidates(...args),matches:id=>queue.matchedCandidates(id),bind:(...args)=>queue.bind(...args),'move-items':(...args)=>queue.moveItems(...args),
  'clean-archive-files':async()=>{idle();const n=queue.items.filter(i=>!i.trashedAt&&i.status==='done'&&i.file).length;if(!n||!confirm(`删除浏览器中 ${n} 条已归档录音的副本？\n保留转写、草稿和飞书记录，不会删除原文件夹里的录音。`))return 0;return queue.cleanArchivedFiles();},
  'clear-trash':async()=>{idle();const n=queue.items.filter(i=>i.trashedAt).length;if(!n||!confirm(`永久清空回收站中的 ${n} 项及浏览器录音副本？\n此操作不可撤销，请先导出备份。不会删除原文件夹或飞书中的内容。`))return 0;return queue.clearTrash();},
  test:async()=>{idle();if(!confirm('向现有飞书云函数发送无客户含义的只读查询，检查接口是否正常？'))return '已取消';await queue.services.search('connection-check-no-phone');return '飞书接口返回正常；尚未验证实际客户匹配或写入。';}
};
window.crm={onQueue:fn=>listeners.push(fn),call:async(channel,...args)=>{try{if(!['state','stop'].includes(channel))idle();if(!handlers[channel])throw Error('不支持的操作');return {ok:true,data:await handlers[channel](...args)};}catch(e){return {ok:false,error:e.message};}}};
function showError(e){$('notice').textContent=e.message;if(storageError){ready=false;lastError=e.message;}publish();}
async function storageStatus(){const e=await navigator.storage?.estimate?.(),persistent=await navigator.storage?.persisted?.();$('storage-status').textContent=(e?`此网站所在域已用 ${(e.usage/1024/1024).toFixed(1)} MB。`:'')+(persistent?'已获浏览器持久存储保护。':'建议点击“保护本地存储”。')+'清除网站数据仍会删除记录。'+(backupAt?'最近导出：'+new Date(backupAt).toLocaleString('zh-CN'):'请定期导出备份。');}
async function boot(){
  await openDB();const saved=await get('settings');settings=saved?checkSettings(saved):{...defaults};backupAt=await get('backupAt');
  queue=new Queue('local',new Services(settings,keys),publish,{managedFiles:true});await queue.load();ready=true;await storageStatus();
}
let initialized;
if(!navigator.locks){initialized=Promise.reject(Error('当前浏览器缺少安全标签页锁，请使用新版 Chrome 或 Safari。'));}
else initialized=new Promise((resolve,reject)=>{navigator.locks.request('grace-call-notes-owner',{ifAvailable:true},async lock=>{if(!lock){reject(Error('另一个标签页正在使用通话跟进。请关闭那个页面后，再刷新这里。'));return;}try{await boot();resolve();await new Promise(()=>{});}catch(e){reject(e);}}).catch(reject);});
initialized.catch(e=>{lastError=e.message;$('storage-status').textContent=e.message;$('notice').textContent=e.message;});
window.addEventListener('beforeunload',e=>{if(busy||queue?.running){e.preventDefault();e.returnValue='';}});
$('export-backup').onclick=async()=>{try{await initialized;if(busy||queue?.running)throw Error('请先停止当前批次后导出');const items=structuredClone(queue.items);for(const i of items){delete i.file;delete i.audioCache;i.selectedItem=false;i.selectedAnalysis=false;i.selectedSave=false;}const payload={format:'grace-call-notes-backup',version:1,exportedAt:new Date().toISOString(),settings,items};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='通话跟进备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);backupAt=payload.exportedAt;try{await set('backupAt',backupAt);}catch{}await storageStatus();$('notice').textContent='已发起备份下载，请确认文件已保存。备份含客户信息和转写，请妥善保管；不含录音和密钥。';}catch(e){showError(e);}};
function validateBackup(raw){
  if(raw?.format!=='grace-call-notes-backup'||raw.version!==1||!Array.isArray(raw.items)||raw.items.length>100000)throw Error('不是支持的通话跟进备份文件');
  const statuses=new Set(['queued','processing','ready','review','writing','done','skipped','ambiguous','awaiting_link','error','invalid','uncertain']),ids=new Set();
  return raw.items.map(row=>{
    if(!row||typeof row!=='object'||typeof row.id!=='string'||row.id.length>100||ids.has(row.id)||typeof row.filename!=='string'||!statuses.has(row.status))throw Error('备份记录格式无效或重复');ids.add(row.id);
    if(row.meta){const meta=parseName(row.filename);if(meta.stamp!==row.meta.stamp||meta.epoch!==row.meta.epoch||meta.phone!==row.meta.phone)throw Error('备份通话时间或号码不一致');}
    if(row.status!=='invalid'&&!row.meta)throw Error('备份缺少通话信息');if(row.draft)validateDraft(row.draft);if(['ready','done','review','awaiting_link','uncertain','writing'].includes(row.status)&&!row.draft)throw Error('备份缺少草稿');
    if(row.recordId!=null&&(typeof row.recordId!=='string'||row.recordId.length>200))throw Error('备份客户标识无效');
    const i=JSON.parse(JSON.stringify(row));delete i.file;delete i.audioCache;i.selectedItem=false;i.selectedAnalysis=false;i.selectedSave=false;
    if(i.meta)i.meta=parseName(i.filename);
    if(i.status==='writing'){i.status='uncertain';i.message='备份时写入中断，需在飞书核对后恢复';}if(i.status==='processing'){i.status='error';i.message='备份时处理中断，请重新导入原始录音后重试';}return i;
  });
}
$('import-backup').onclick=async()=>{try{idle();const [file]=await chooseFile('.json');if(!file)return;if(file.size>100*1024*1024)throw Error('备份文件过大');const incoming=validateBackup(JSON.parse(await file.text()));idle();const existingIds=new Set(queue.items.map(i=>i.id)),fresh=incoming.filter(i=>!existingIds.has(i.id));if(!confirm(`从备份合并 ${fresh.length} 条新记录？\n本地已有的同一录音记录保持原样。备份不含录音和密钥；需要分析时请重新导入原始录音。`))return;const items=[...queue.items,...fresh];await set('queue',items);queue.items=items;publish();await storageStatus();$('notice').textContent=`已恢复 ${fresh.length} 条记录。相同录音的本地记录未覆盖；分析前请重新导入原始录音。`;}catch(e){showError(e);}};
$('persist-storage').onclick=async()=>{try{idle();const ok=await navigator.storage?.persist?.();await storageStatus();if(!ok)alert('浏览器尚未授予持久存储保护。可正常使用，请定期导出备份；手动清除网站数据仍会删除记录。');}catch(e){showError(e);}};
await import('./renderer.js');
try{await initialized;document.body.inert=false;}catch{}
