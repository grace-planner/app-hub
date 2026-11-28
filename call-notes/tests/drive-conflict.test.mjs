import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {makeDriveTextSync} from '../google-drive-text.js';

const account = 'test-account';
const id = 'a'.repeat(64);
const original = {id, filename:'test.m4a', meta:{date:'2026-11-20'}, status:'done', transcript:'测试', draft:{summary:'已有记录'}};
const hash = async blob => createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');

async function mockDrive(onUpload=()=>{}){
  const files = [{id:'folder', mimeType:'application/vnd.google-apps.folder', appProperties:{kind:'folder'}}];
  const texts = new Map();
  const writes = [];
  async function add(record, parent){
    const text = JSON.stringify(record);
    const version = await hash(new Blob([parent || '', '\n', text]));
    save({parents:['folder'], appProperties:{record:id, version, parent}},text);
    return version;
  }
  function save(meta,text){
    const file = {id:'file'+files.length,...meta};
    files.push(file);
    texts.set(file.id,text);
    return file.id;
  }
  async function fetcher(input,{method='GET',body}){
    const url = new URL(input);
    if (url.pathname.endsWith('/about')) return Response.json({user:{permissionId:account}});
    if (url.pathname.startsWith('/upload/')){
      const [meta,text] = (await body.text()).split('\r\n\r\n').slice(1)
        .map(part=>part.split('\r\n--')[0]);
      writes.push(JSON.parse(meta).appProperties);
      const id = save(JSON.parse(meta),text);
      onUpload();
      return Response.json({id});
    }
    if (url.pathname.endsWith('/files') && method==='GET') return Response.json({files:files.filter(file=>!file.trashed)});
    if (url.pathname.endsWith('/files') && method==='POST'){
      const marker = JSON.parse(body);
      writes.push(marker.appProperties);
      return Response.json({id:save(marker,'')});
    }
    const file = files.find(row=>url.pathname.endsWith('/'+row.id));
    if (file && method==='PATCH'){
      file.trashed=JSON.parse(body).trashed;
      return Response.json({id:file.id});
    }
    assert.ok(file);
    return new Response(texts.get(file.id));
  }
  return {add,writes,connect:writer=>makeDriveTextSync('mock',hash,fetcher,undefined,writer)};
}
const local = (record,version,baseline) => ({...record,driveText:{account,version,baseline:JSON.stringify(baseline)}});

test('aligns identical local and cloud content even when the versions differ',async()=>{
  const drive=await mockDrive();
  const initial=await drive.add(original);
  const intermediate=await drive.add({...original, draft:{summary:'中间版本'}},initial);
  const updated={...original,draft:{summary:'最终版本',next_date:'2026-11-26'}};
  const head=await drive.add(updated,intermediate);
  const current=local({...updated,draft:{next_date:'2026-11-26',summary:'最终版本'}},initial,original);
  const client=await drive.connect();
  const result=await client.sync([current]);
  assert.equal(result.conflicts,0);
  assert.equal(result.items[0].driveText.version,head);
  assert.equal(drive.writes.length,0);
});

test('choosing a local follow-up date carries it to a second browser',async()=>{
  const drive=await mockDrive();
  const initial=await drive.add(original);
  const head=await drive.add({...original,draft:{...original.draft,latest_summary:'已保存'}},initial);
  const current=local({...original,draft:{...original.draft,next_date:'2026-11-26'}},initial,original);
  const client=await drive.connect();
  const report=await client.sync([current]);
  assert.equal(report.conflicts,1);
  const next=await client.resolveConflict(report.conflictDetails[0],current,'local');
  const second=await drive.connect();
  const result=await second.sync([]);
  assert.equal(drive.writes[0].parent,head);
  assert.equal(result.conflicts,0);
  assert.equal(result.items[0].draft.next_date,'2026-11-26');
  assert.equal(result.items[0].driveText.version,next.driveText.version);
});

test('choosing one of two cloud versions resolves both branches without deleting prior files',async()=>{
  const drive=await mockDrive();
  const initial=await drive.add(original);
  const head=await drive.add({...original,trashedAt:'2026-11-21'},initial);
  const other=await drive.add({...original,status:'review'},initial);
  const current=local(original,initial,original);
  const client=await drive.connect();
  const report=await client.sync([current]);
  const next=await client.resolveConflict(report.conflictDetails[0],current,head);
  assert.equal(next.trashedAt,'2026-11-21');
  assert.deepEqual(new Set([drive.writes[0].parent,drive.writes[0].merge0]),new Set([head,other]));
  const second=await drive.connect();
  const result=await second.sync([current]);
  assert.equal(result.conflicts,0);
  assert.equal(result.items[0].trashedAt,next.trashedAt);
  await client.clearTrash([next]);
  assert.equal((await second.sync([next])).items.length,0);
});

test('a local edit or an additional cloud branch invalidates a reviewed choice',async()=>{
  const drive=await mockDrive();
  const initial=await drive.add(original);
  const cloud={...original,status:'review'};
  const head=await drive.add(cloud,initial);
  const current=local({...original,trashedAt:'2026-11-21'},initial,original);
  const client=await drive.connect();
  const {conflictDetails:[report]}=await client.sync([current]);
  await assert.rejects(client.resolveConflict(report,{...current,trashedAt:null},head),/已更新/);
  await drive.add({...cloud,draft:{summary:'另一台设备有更新'}},head);
  await assert.rejects(client.resolveConflict(report,current,head),/已更新/);
  assert.deepEqual(drive.writes,[]);
});

test('combines two cloud versions that have identical content',async()=>{
  const drive=await mockDrive();
  const initial=await drive.add(original);
  const first=await drive.add({...original,draft:{summary:'第一条历史'}},initial);
  const second=await drive.add({...original,draft:{summary:'第二条历史'}},initial);
  await drive.add(original,first);
  await drive.add(original,second);
  const client=await drive.connect();
  const synced=await client.sync([]);
  assert.equal(synced.conflicts,0);
  assert.equal(synced.uploaded,1);
  assert.equal((await client.sync(synced.items)).conflicts,0);
  assert.equal(drive.writes.length,1);
});

test('resumes an interrupted own upload but preserves other browser conflicts',async()=>{
  for(const writer of ['this-browser','another-browser',undefined]){
    const controller = new AbortController();
    const drive = await mockDrive(()=>controller.abort());
    const previous = {...original,status:'review'};
    const approved = local({...original,status:'ready'},await drive.add(previous),previous);
    await assert.rejects((await drive.connect(writer)).sync([approved],controller.signal),{name:'AbortError'});
    const current = {...approved,status:'done',trashedAt:'2026-11-28'};
    const client = await drive.connect('this-browser');
    const result = await client.sync([current]);
    assert.equal(result.conflicts,writer==='this-browser'?0:1);
    assert.equal(result.items[0].trashedAt,current.trashedAt);
    if(writer==='this-browser'){
      assert.equal(result.uploaded,1);
      assert.equal((await client.sync(result.items)).conflicts,0);
    }else assert.equal(result.uploaded,0);
  }
});
