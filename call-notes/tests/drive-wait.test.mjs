import assert from 'node:assert/strict';
import test from 'node:test';
import {makeDriveTextSync,requestDriveToken} from '../google-drive-text.js';

test('a silent Google popup can be cancelled and a late callback is ignored',async t=>{
  let callbacks;
  let authorizationChecks=0;
  globalThis.google={accounts:{oauth2:{
    initTokenClient(options){callbacks=options;return {requestAccessToken(){}};},
    hasGrantedAllScopes(){authorizationChecks++;return true;}
  }}};
  t.after(()=>{delete globalThis.google;});
  const controller=new AbortController();
  const pending=requestDriveToken(controller.signal);
  const error=Error('cancelled login');
  controller.abort(error);
  await assert.rejects(pending,error);
  callbacks.callback({access_token:'late-token'});
  assert.equal(authorizationChecks,0);
});

test('cancel reaches an in-flight Drive request and a later sync can succeed',async()=>{
  let startRequest;
  const started=new Promise(resolve=>{startRequest=resolve;});
  let waiting=true;
  const fetcher=async(url,{signal})=>{
    if(url.includes('/about?'))return Response.json({user:{permissionId:'test-account'}});
    if(!waiting)return Response.json({files:[]});
    startRequest();
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  };
  const drive=await makeDriveTextSync('mock-token',assert.fail,fetcher);
  const controller=new AbortController();
  const pending=drive.sync([],controller.signal);
  await started;
  const error=Error('cancelled sync');
  controller.abort(error);
  await assert.rejects(pending,error);
  waiting=false;
  assert.deepEqual((await drive.sync([])).items,[]);
});
