import assert from 'node:assert/strict';
import test from 'node:test';
import {makeDriveTextSync} from '../google-drive-text.js';

const account = 'test-account';
const namespace = 'call-notes-text-v1';
const id = 'a'.repeat(64);
const version = 'b'.repeat(64);
const local = {id, trashedAt:'2026-11-19', driveText:{account,version}};
const folderType = 'application/vnd.google-apps.folder';

function mockDrive(remoteVersion = version) {
  const files = [
    {id:'folder', mimeType:folderType, appProperties:{app:namespace,kind:'folder'}},
    {id:'record', appProperties:{app:namespace,record:id,version:remoteVersion}}
  ];
  const calls = [];
  let failPatch = false;
  async function fetcher(input, {method='GET', body}) {
    const url = new URL(input);
    if (url.pathname.endsWith('/about')) return Response.json({user:{permissionId:account}});
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      return Response.json({files:files.filter(file=>!file.trashed)});
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const marker = JSON.parse(body);
      assert.deepEqual(marker.parents,['folder']);
      assert.deepEqual(marker.appProperties,{app:namespace,kind:'deleted',record:id});
      calls.push('marker');
      files.push({id:'marker',...marker});
      return Response.json({id:'marker'});
    }
    if (url.pathname === '/drive/v3/files/record' && method === 'PATCH') {
      assert.deepEqual(JSON.parse(body),{trashed:true});
      if (failPatch) {
        failPatch = false;
        return new Response(null,{status:503});
      }
      calls.push('trash');
      files[1].trashed = true;
      return Response.json({id:'record'});
    }
    throw Error('Unexpected request: '+method+' '+url.pathname);
  }
  const connect = () => makeDriveTextSync('mock-token',()=>assert.fail('Unexpected file operation'),fetcher);
  return {connect,calls,failNextCleanup:()=>{failPatch=true;}};
}

test('clearing a synced record protects another browser against downloading it again',async()=>{
  const drive = mockDrive();
  const first = await drive.connect();
  await first.clearTrash([local]);
  const second = await drive.connect();
  assert.deepEqual((await second.sync([local])).items,[]);
  assert.deepEqual((await second.sync([])).items,[]);
  const reimported = {id,file:'local-audio',driveText:{account,version:''}};
  assert.deepEqual((await second.sync([reimported])).items,[reimported]);
  await first.clearTrash([local]);
  assert.deepEqual(drive.calls,['marker','trash']);
});

test('a newer remote version prevents clearing before review',async()=>{
  const drive = mockDrive('c'.repeat(64));
  const client = await drive.connect();
  await assert.rejects(()=>client.clearTrash([local]),/其他设备有更新/);
  assert.deepEqual(drive.calls,[]);
});

test('sync retries after Drive saved the marker but could not trash the old file',async()=>{
  const drive = mockDrive();
  drive.failNextCleanup();
  const client = await drive.connect();
  await assert.rejects(()=>client.clearTrash([local]),/503/);
  assert.deepEqual((await client.sync([local])).items,[]);
  assert.deepEqual(drive.calls,['marker','trash']);
});
