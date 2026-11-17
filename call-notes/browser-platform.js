// Browser-only persistence. No recording, queue or key is uploaded for storage.
export const MAX_FILE=512*1024*1024;
let connection;
export let storageError=null;
export async function openDB(){
  if(connection)return connection;
  connection=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('grace-call-notes-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('data');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(Error('无法打开浏览器本地数据库，请使用普通浏览窗口并允许网站存储。'));
    request.onblocked=()=>reject(Error('本地数据库被其他标签页占用，请关闭旧标签页后重试。'));
  });return connection;
}
export async function get(key){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction('data').objectStore('data').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function set(key,value){return batch([{key,value}]);}
export async function batch(changes){
  const db=await openDB();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite'),store=tx.objectStore('data');for(const c of changes)c.remove?store.delete(c.key):store.put(c.value,c.key);tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||Error('本地存储事务中断'));});}
  catch(e){storageError=Error('浏览器保存失败（可能空间不足）。已停止操作，请先导出备份，再释放磁盘空间并重新打开页面。');throw storageError;}
}
export const path={basename:s=>String(s).split(/[\\/]/).pop(),extname:s=>String(s).match(/\.[^.\\/]+$/)?.[0]||'',join:(...s)=>s.join('/')};
const temporary=new Map();
export const fs={
  mkdir:async()=>{},
  stat:async key=>{const f=await get(key);if(!(f instanceof Blob))throw Error('未找到录音，请重新导入原始文件以恢复关联。');return {size:f.size};},
  readFile:async(key,encoding)=>{if(key==='local/queue.json'){const s=await get('queue');if(s===undefined){const e=Error('empty');e.code='ENOENT';throw e;}return JSON.stringify(s);}const blob=await get(key);if(!(blob instanceof Blob))throw Error('未找到录音，请重新导入原始文件。');return new Uint8Array(await blob.arrayBuffer());},
  writeFile:async(key,s)=>temporary.set(key,JSON.parse(s)),
  rename:async(from,to)=>{await set('queue',temporary.get(from));temporary.delete(from);},
  rm:async key=>batch([{key,remove:true}])
};
export async function hashFile(key){const f=key instanceof Blob?key:await get(key);if(!(f instanceof Blob))throw Error('录音不在此浏览器中，请重新导入同一份原始录音。');if(f.size>MAX_FILE)throw Error('单个录音最多支持 512 MB');const digest=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function readPCM(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),str=(p,n)=>String.fromCharCode(...bytes.subarray(p,p+n));
  if(bytes.length<44||str(0,4)!=='RIFF'||str(8,4)!=='WAVE')throw Error('需要有效的 WAV 文件');
  let fmt,pcm;
  for(let n=12;n+8<=bytes.length;){const id=str(n,4),size=v.getUint32(n+4,true),start=n+8;if(start+size>bytes.length)throw Error('WAV 文件不完整');
    if(id==='fmt '){if(size<16)throw Error('WAV 格式无效');let code=v.getUint16(start,true);const channels=v.getUint16(start+2,true),rate=v.getUint32(start+4,true),align=v.getUint16(start+12,true),bits=v.getUint16(start+14,true);
      if(code===65534){if(size<40||v.getUint16(start+16,true)<22)throw Error('WAV 扩展头不完整');const tail=[0,0,16,0,128,0,0,170,0,56,155,113];if(!tail.every((b,i)=>bytes[start+28+i]===b))throw Error('不支持的 WAV 扩展编码');code=v.getUint32(start+24,true);}
      fmt={code,channels,rate,align,bits};if(v.getUint32(start+8,true)!==rate*align)throw Error('WAV 帧格式无效');}
    if(id==='data')pcm=bytes.subarray(start,start+size);n=start+size+size%2;
  }
  if(!fmt||!pcm?.length)throw Error('WAV 文件没有有效音轨');const {code,channels,rate,align,bits}=fmt;
  if(![1,3].includes(code)||channels<1||channels>32||rate<4000||rate>384000||align!==channels*bits/8||![8,16,24,32,64].includes(bits)||(code===3&&![32,64].includes(bits))||(code===1&&bits===64)||pcm.length%align)throw Error('此 WAV 编码需浏览器转换');
  if(code===1&&channels===1&&rate===16000&&bits===16)return pcm;
  const data=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength),count=pcm.length/align;
  const sample=frame=>{let sum=0;for(let c=0;c<channels;c++){const n=Math.min(count-1,Math.max(0,frame))*align+c*bits/8;let a;if(code===3)a=bits===32?data.getFloat32(n,true):data.getFloat64(n,true);else if(bits===8)a=(data.getUint8(n)-128)/128;else if(bits===16)a=data.getInt16(n,true)/32768;else if(bits===32)a=data.getInt32(n,true)/2147483648;else{let x=data.getUint8(n)|data.getUint8(n+1)<<8|data.getUint8(n+2)<<16;if(x&0x800000)x-=0x1000000;a=x/8388608;}sum+=Number.isFinite(a)?Math.max(-1,Math.min(1,a)):0;}return sum/channels;};
  return resample(count,rate,sample);
}
function resample(count,rate,sample){const len=Math.max(1,Math.floor(count*16000/rate));if(len*2>MAX_FILE)throw Error('解码后的音频过大，请先将录音拆分。');const output=new Uint8Array(len*2),v=new DataView(output.buffer);for(let n=0;n<len;n++){const p=n*rate/16000,lo=Math.floor(p),f=p-lo,a=sample(lo)*(1-f)+sample(lo+1)*f;v.setInt16(n*2,Math.max(-32768,Math.min(32767,Math.round(a*32768))),true);}return output;}
export async function normalizedPCM(key){
  const file=await get(key);if(!(file instanceof Blob))throw Error('未找到录音，请重新导入原文件。');if(file.size>MAX_FILE)throw Error('单个录音最多支持 512 MB');const bytes=new Uint8Array(await file.arrayBuffer());
  try{return readPCM(bytes);}catch{}
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)throw Error('当前浏览器不支持音频解码，请使用新版 Chrome 或 Safari。');
  const ctx=new Audio();
  try{const decoded=await ctx.decodeAudioData(bytes.buffer);const tracks=Array.from({length:decoded.numberOfChannels},(_,c)=>decoded.getChannelData(c));return resample(decoded.length,decoded.sampleRate,n=>{n=Math.min(decoded.length-1,n);let sum=0;for(const t of tracks)sum+=t[n];return sum/tracks.length;});}
  catch(e){if(e.message.includes('过大'))throw e;throw Error('浏览器无法解码这份录音，请转换为 WAV 或 MP3 后重试；M4A 的支持取决于实际编码。');}
  finally{await ctx.close();}
}
export function wave(pcm){const bytes=new Uint8Array(44+pcm.length),v=new DataView(bytes.buffer),str=(p,s)=>{for(let n=0;n<s.length;n++)bytes[p+n]=s.charCodeAt(n);};str(0,'RIFF');v.setUint32(4,36+pcm.length,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,pcm.length,true);bytes.set(pcm,44);return bytes;}
export function* chunks(pcm){let start=0,index=0;while(start<pcm.length){const end=Math.min(start+210*32000,pcm.length);yield {index:index++,start:start/32000,end:end/32000,bytes:wave(pcm.subarray(start,end))};if(end===pcm.length)break;start=end-2*32000;}}
export function mergeText(parts){let result='';for(const value of parts){const next=value.trim();if(!next)continue;if(!result){result=next;continue;}let overlap=0;for(let n=Math.min(result.length,next.length,120);n>=4;n--)if(result.endsWith(next.slice(0,n))){overlap=n;break;}result+='\n'+next.slice(overlap);}return result.trim();}
