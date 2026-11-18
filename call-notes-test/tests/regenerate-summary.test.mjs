import test from 'node:test';
import assert from 'node:assert/strict';
import {Queue} from '../core.js';

test('regenerateSummary re-runs summarize without re-transcribing',async()=>{
  let summarizeCalls=0,transcribeCalls=0;
  const services={
    async summarize(){summarizeCalls++;return {meaningful:true,needs_review:false,review_reason:null,summary:'客户仅确认联系方式。',intent:null,next_date:null,next_purpose:null,reminder_date:null,reminder_note:null,suggested_name:null,name_evidence:null};},
    async extractName(){return {suggested_name:null,name_evidence:null,name_checked:true};},
    async transcribe(){transcribeCalls++;throw Error('不应重新转写');}
  };
  const q=new Queue('test',services,()=>{});
  q.persist=async()=>{};
  q.items=[{id:'1',status:'ready',recordId:'r1',customer:'某客户',meta:{date:'2026-11-18',stamp:'2026-11-18 13:37',epoch:0},transcript:'旧转写',draft:{summary:'旧的罗列缺失摘要'},selectedItem:true}];
  await q.regenerateSummary('1');
  assert.equal(summarizeCalls,1);
  assert.equal(transcribeCalls,0);
  assert.equal(q.items[0].draft.summary,'客户仅确认联系方式。');
  assert.equal(q.items[0].status,'ready');
  assert.equal(q.items[0].selectedItem,false);
});

test('regenerateSummary rejects records without a transcript',async()=>{
  const q=new Queue('test',{summarize:async()=>{throw Error('不应调用');}},()=>{});
  q.persist=async()=>{};
  q.items=[{id:'2',status:'ready',draft:{summary:'x'}}];
  await assert.rejects(()=>q.regenerateSummary('2'),/没有可重新生成的转写内容/);
});
