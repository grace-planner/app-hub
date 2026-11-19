import {get,set,batch,openDB,storageError,hashFile,MAX_FILE,path,wave,cloudTest,setAliyunAudio} from './browser-platform.js?v=20261119-cloud-test';
import {makeCloudSync} from './cloud-sync.js?v=20261119-cloud-test';
import {forgetAuthorization,readAuthorization,rememberAuthorization} from './cloud-authorization.js?v=20261119-cloud-test';
import {PROXY,Queue,Services,httpURL,aliyunAudioBase,parseName,fieldText,displayedGroupSuggestion,recordSnapshot,suggestedFollowUp,recencyGuard,validateDraft} from './core.js?v=20261119-cloud-test';
const $=id=>document.getElementById(id);
const defaults={proxy:PROXY,audioProvider:'aliyun',audioBase:'https://dashscope.aliyuncs.com/api/v1',audioModel:'qwen-audio-3.1-asr-flash',textBase:'https://dashscope.aliyuncs.com/compatible-mode/v1',textModel:'qwen-plus',autoWrite:false};
let settings,queue,keys={audio:'',text:''},busyOperation=null,ready=false,lastError='',backupAt=null;
const listeners=[];
function publish(items=queue?.publicItems()||[]){for(const fn of listeners)fn({items,running:!!busyOperation||!!queue?.running,operation:queue?.running?queue.operation:busyOperation});}
function idle(){if(!ready)throw Error(lastError||'正在打开本地数据库，请稍后重试');if(storageError)throw storageError;if(!!busyOperation||queue.running)throw Error('请等待当前操作结束');}
function checkSettings(raw){const next={audioProvider:raw.audioProvider==='aliyun'?'aliyun':'openai',proxy:PROXY,autoWrite:false};for(const k of ['audioBase','textBase'])next[k]=httpURL(raw[k]);for(const k of ['audioModel','textModel']){next[k]=String(raw[k]||'').trim();if(!next[k]||next[k].length>160)throw Error('请填写有效的模型名称');}if(next.audioModel==='qwen3-asr-flash')next.audioModel='qwen-audio-3.1-asr-flash';if(next.audioProvider==='aliyun')next.audioBase=aliyunAudioBase(next.audioBase);return next;}
function chooseFile(accept,multiple=false){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;document.body.append(input);const finish=files=>{input.remove();resolve(files);};input.onchange=()=>finish([...input.files]);input.oncancel=()=>finish([]);input.click();});}
async function withBusy(operation,fn){idle();busyOperation=operation;publish();try{return await fn();}finally{busyOperation=null;publish();}}
let cloud=null;
function syncStatus(message){$('sync-status').textContent=message;}
function setCloudConnection(client,remembered=false){
  cloud=client;
  setAliyunAudio(client?id=>{
    if(!queue.items.some(item=>item.id===id&&item.cloudSync?.endpoint===client.endpoint))throw Error('此录音使用另一个云同步地址');
    return client.download(id);
  }:null);
  $('sync-endpoint').readOnly=!!client;
  $('sync-token').disabled=!!client;
  $('sync-remember').checked=remembered;
  $('sync-remember').disabled=!!client;
  $('sync-connect').disabled=!!client;
  $('sync-now').disabled=!client;
  $('sync-disconnect').hidden=!client;
  $('sync-disconnect').textContent=remembered?'取消此浏览器授权':'断开连接';
  $('sync-sample').disabled=!client;
}
async function syncCloudQueue(client){
  const result=await client.sync(queue.items,get);
  if(JSON.stringify(result.items)!==JSON.stringify(queue.items)){
    await set('queue',result.items);
    queue.items=result.items;
  }
  return result.conflicts||result.pending
    ? `同步结束。冲突 ${result.conflicts} 条，待重试 ${result.pending} 条，本机记录已保留。`
    : '云端同步完成。';
}
async function syncConnectedCloud(){
  try{
    const status=await syncCloudQueue(cloud);
    syncStatus(($('sync-remember').checked?'此浏览器已授权，可自动连接。':'')+status);
  }catch(error){
    if(error.status!==401)throw error;
    setCloudConnection(null);
    await forgetAuthorization();
    syncStatus('云同步密钥已失效，请重新授权。');
  }
}
function syncCloud(){
  return withBusy('syncing',syncConnectedCloud);
}
$('sync-connect').onclick=async()=>{
  if(cloud)return;
  try{
    await withBusy('syncing',async()=>{
      const token=$('sync-token').value.trim();
      const remember=$('sync-remember').checked;
      const client=makeCloudSync($('sync-endpoint').value,token);
      const status=await syncCloudQueue(client);
      let remembered=false;
      let preferenceMessage='';
      try{
        if(remember){
          await rememberAuthorization(client.endpoint,token);
          remembered=true;
          preferenceMessage='此浏览器已授权，可自动连接。';
        }else await forgetAuthorization();
      }catch{
        preferenceMessage=remember?'浏览器未能记住授权，本次连接可继续使用。':'未能清除先前的浏览器授权。';
      }
      setCloudConnection(client,remembered);
      $('sync-token').value='';
      syncStatus(preferenceMessage+status);
    });
  }catch(error){syncStatus(error.message);}
};
$('sync-disconnect').onclick=()=>{
  withBusy('syncing',async()=>{
    await forgetAuthorization();
    setCloudConnection(null);
    syncStatus('已断开云端，重新连接时请填写同步密钥。');
  }).catch(error=>syncStatus('未能取消授权：'+error.message));
};
$('sync-now').onclick=()=>syncCloud().catch(error=>syncStatus(error.message));
async function restoreCloud(){
  let saved;
  try{
    saved=await readAuthorization();
  }catch{
    syncStatus('无法读取此浏览器的授权，请重新连接。');
    return;
  }
  if(!saved||cloud)return;
  try{
    if(saved.endpoint!==new URL($('sync-endpoint').value).origin)throw Error('请重新授权当前同步地址');
    setCloudConnection(makeCloudSync(saved.endpoint,saved.token),true);
    syncStatus('正在连接阿里云…');
    await syncConnectedCloud();
  }catch(error){
    syncStatus('暂时无法同步：'+error.message);
  }
}
if(cloudTest)setInterval(()=>{
  if(!cloud||!ready||busyOperation||queue.running||document.querySelector('dialog[open]'))return;
  syncCloud().catch(error=>syncStatus(error.message));
},30_000);


$('cloud-test-tools').hidden=!cloudTest;
$('cloud-test-entry').hidden=cloudTest;
if(cloudTest){
  document.title='通话跟进 · 云同步测试';
  document.body.classList.add('cloud-test');
  document.querySelector('main header h1').textContent='云同步测试';
  document.querySelector('main header p').textContent='连接后生成模拟录音，再用另一个浏览器查看。';
}
$('sync-sample').onclick=()=>withBusy('syncing',async()=>{
  if(!cloudTest||!cloud)throw Error('请先连接阿里云同步');
  const pcm=new Uint8Array(32000);
  crypto.getRandomValues(pcm.subarray(0,16));
  const audio=new Blob([wave(pcm)],{type:'audio/wav'});
  const id=await hashFile(audio);
  const [date,time]=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'
  }).format(new Date()).split(' ');
  const filename='同步样本'+id.slice(0,6)+'_'+date.replaceAll('-','')+'_'+time.replaceAll(':','')+'.wav';
  const file='audio/'+id+'.wav';
  const item={
    id,file,filename,meta:parseName(filename),status:'awaiting_link',
    transcript:'这是一条模拟转写。',
    draft:{summary:'这是用于跨浏览器验收的模拟草稿。',meaningful:true,needs_review:false},
    cloudSync:{endpoint:cloud.endpoint,revision:0,baseline:''}
  };
  const items=[...queue.items,item];
  await batch([{key:file,value:audio},{key:'queue',value:items}]);
  queue.items=items;
  await syncConnectedCloud();
}).catch(error=>syncStatus(error.message));

const testActions=new Set(['state','draft','approve','select','move-items']);

async function importRecordings(){
  idle();const files=await chooseFile('.wav,.mp3,.m4a,.mp4,.flac,.ogg,.webm,.mpeg,.mpga',true);if(!files.length)return queue.publicItems();
  await withBusy('importing',async()=>{
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
  state:async()=>{await initialized;if(!ready)throw Error(lastError||'初始化失败');return {settings,hasAliyunKey:!!keys.audio&&keys.audio===keys.text,items:queue.publicItems(),running:!!busyOperation||queue.running};},
  settings:async raw=>{idle();const next=checkSettings(raw),value=String(raw.aliyunKey||'').trim(),addressChanged=next.audioBase!==settings.audioBase||next.textBase!==settings.textBase;let nextKeys={...keys};if(value)nextKeys={audio:value,text:value};else if(addressChanged)nextKeys={audio:'',text:''};await set('settings',next);settings=next;keys=nextKeys;queue.services=new Services(settings,keys);return {settings,hasAliyunKey:!!keys.audio&&keys.audio===keys.text};},
  'diagnose-aliyun':async()=>{idle();return queue.services.diagnoseAliyun();},
  import:importRecordings,
  resummarize:async id=>{
    if(!keys.text)throw Error('请先在连接与设置中填写本次会话的百炼 Key');
    await withBusy('resummarizing',()=>queue.resummarize(id));
  },
  'resummarize-selected':async (selected,filter)=>{
    if(!keys.text)throw Error('请先在连接与设置中填写本次会话的百炼 Key');
    const view=window.crmView;
    const ids=view.actionIds(view.inbox(queue.items,filter),selected,'resummarize');
    if(!ids.length)throw Error('请勾选有转写原文的录音');
    return withBusy('resummarizing',()=>queue.resummarizeSelected(ids));
  },
  process:async selected=>{idle();if(!keys.audio||!keys.text)throw Error('请先在连接与设置中输入本次会话的转写和总结密钥');const ids=window.crmView.actionIds(queue.items,selected,'analysis');if(!ids.length)throw Error('请勾选要分析的录音；从备份恢复后请先重新导入原始录音');queue.process(false,ids).catch(showError);publish();return true;},
  stop:()=>{queue.stop=true;return true;},
  commit:async selected=>{idle();const ids=window.crmView.actionIds(queue.items,selected,'save');if(!ids.length)throw Error('请先核对并勾选可保存的草稿');if(!confirm(`将 ${ids.length} 条草稿保存到飞书？\n请勿同时在其他 App 编辑相同客户。写入前会重读日志，但无法消除跨应用同时写入的冲突。`))return false;queue.commitReady(ids).catch(showError);publish();return true;},
  draft:async id=>{idle();const i=queue.items.find(i=>i.id===id);if(!i?.draft)throw Error('草稿不存在');let original=null;if(i.recordId){const records=await queue.resolve(i);if(records.length===1){i.customer=fieldText(records[0].fields?.['姓名']).trim();i.protection=recencyGuard(records[0],i.meta);original=recordSnapshot(records[0]);}}return {draft:i.draft,original,manualSelections:i.manualSelections,group:displayedGroupSuggestion(i.draft,i.transcript),groupChoice:Object.hasOwn(i,'groupChoice')?i.groupChoice:i.groupApproved||undefined,suggestedNextDate:i.nameDecisionMade?'':suggestedFollowUp(i.meta,i.draft,original,i.protection),transcript:i.transcript||'',status:i.status,protection:i.protection,customer:i.customer,recordId:i.recordId,nameApproved:i.nameApproved,nameDecisionMade:i.nameDecisionMade};},
  approve:(...args)=>queue.approve(...args),retry:id=>queue.recover(id),select:(...args)=>queue.select(...args),candidates:(...args)=>queue.findCandidates(...args),matches:id=>queue.matchedCandidates(id),bind:(...args)=>queue.bind(...args),'move-items':(...args)=>queue.moveItems(...args),
  'clean-archive-files':async()=>{idle();const n=queue.items.filter(i=>!i.trashedAt&&i.status==='done'&&i.file).length;if(!n||!confirm(`删除浏览器中 ${n} 条已归档录音的副本？\n保留转写、草稿和飞书记录，不会删除原文件夹里的录音。`))return 0;return queue.cleanArchivedFiles();},
  'clear-trash':async()=>{idle();const n=queue.items.filter(i=>i.trashedAt).length;if(!n||!confirm(`永久清空回收站中的 ${n} 项及浏览器录音副本？\n此操作不可撤销，请先导出备份。不会删除原文件夹或飞书中的内容。`))return 0;return queue.clearTrash();},
  test:async()=>{idle();if(!confirm('向现有飞书云函数发送无客户含义的只读查询，检查接口是否正常？'))return '已取消';await queue.services.search('connection-check-no-phone');return '飞书接口返回正常；尚未验证实际客户匹配或写入。';}
};
window.crm={onQueue:fn=>listeners.push(fn),call:async(channel,...args)=>{try{if(!['state','stop'].includes(channel))idle();if(cloudTest&&!testActions.has(channel))throw Error('云同步测试只处理模拟草稿');if(!handlers[channel])throw Error('不支持的操作');return {ok:true,data:await handlers[channel](...args)};}catch(e){return {ok:false,error:e.message};}}};
function showError(e){$('notice').textContent=e.message;if(storageError){ready=false;lastError=e.message;}publish();}
async function storageStatus(){const e=await navigator.storage?.estimate?.(),persistent=await navigator.storage?.persisted?.();$('storage-status').textContent=(e?`此网站所在域已用 ${(e.usage/1024/1024).toFixed(1)} MB。`:'')+(persistent?'已获浏览器持久存储保护。':'建议点击“保护本地存储”。')+'清除网站数据仍会删除记录。'+(backupAt?'最近导出：'+new Date(backupAt).toLocaleString('zh-CN'):'请定期导出备份。');}
async function boot(){
  await openDB();const saved=await get('settings');settings=saved?checkSettings(saved):{...defaults};backupAt=await get('backupAt');
  queue=new Queue('local',new Services(settings,keys),publish,{managedFiles:true});await queue.load();ready=true;await storageStatus();
}
let initialized;
if(!navigator.locks){initialized=Promise.reject(Error('当前浏览器缺少安全标签页锁，请使用新版 Chrome 或 Safari。'));}
else initialized=new Promise((resolve,reject)=>{navigator.locks.request(cloudTest?'grace-call-notes-public-cloud-test-owner':'grace-call-notes-owner',{ifAvailable:true},async lock=>{if(!lock){reject(Error('另一个标签页正在使用通话跟进。请关闭那个页面后，再刷新这里。'));return;}try{await boot();resolve();await new Promise(()=>{});}catch(e){reject(e);}}).catch(reject);});
initialized.catch(e=>{lastError=e.message;$('storage-status').textContent=e.message;$('notice').textContent=e.message;});
function storageFeedback(message=''){
  const feedback=$('storage-feedback');
  feedback.textContent=message;
  feedback.hidden=!message;
}
function reportStorageError(error){
  storageFeedback(error.message);
  showError(error);
}
window.addEventListener('beforeunload',e=>{if(!!busyOperation||queue?.running){e.preventDefault();e.returnValue='';}});
$('export-backup').onclick=async()=>{storageFeedback();try{await initialized;if(!!busyOperation||queue?.running)throw Error('请先停止当前批次后导出');const items=structuredClone(queue.items);for(const i of items){delete i.file;delete i.audioCache;i.selectedItem=false;i.selectedAnalysis=false;i.selectedSave=false;}const payload={format:'grace-call-notes-backup',version:1,exportedAt:new Date().toISOString(),settings,items};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='通话跟进备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);backupAt=payload.exportedAt;try{await set('backupAt',backupAt);}catch{}await storageStatus();storageFeedback('已发起备份下载，请确认文件已保存。备份含客户信息和转写，请妥善保管；不含录音和密钥。');}catch(e){reportStorageError(e);}};
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
$('import-backup').onclick=async()=>{if(cloudTest)return;storageFeedback();try{idle();const [file]=await chooseFile('.json');if(!file)return;if(file.size>100*1024*1024)throw Error('备份文件过大');const incoming=validateBackup(JSON.parse(await file.text()));idle();const existingIds=new Set(queue.items.map(i=>i.id)),fresh=incoming.filter(i=>!existingIds.has(i.id));if(!confirm(`从备份合并 ${fresh.length} 条新记录？\n本地已有的同一录音记录保持原样。备份不含录音和密钥；需要分析时请重新导入原始录音。`))return;const items=[...queue.items,...fresh];await set('queue',items);queue.items=items;publish();await storageStatus();storageFeedback(`已恢复 ${fresh.length} 条记录。相同录音的本地记录未覆盖；分析前请重新导入原始录音。`);}catch(e){reportStorageError(e);}};
$('persist-storage').onclick=async()=>{storageFeedback();try{idle();const ok=await navigator.storage?.persist?.();await storageStatus();storageFeedback(ok?'已开启本地存储保护。':'浏览器尚未授予存储保护。请定期导出备份。');}catch(e){reportStorageError(e);}};
await import('./renderer.js?v=20261118-web-release1');
try{await initialized;if(cloudTest)void withBusy('syncing',restoreCloud).catch(error=>syncStatus(error.message));document.body.inert=false;}catch{}
