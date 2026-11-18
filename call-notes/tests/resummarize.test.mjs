import test from 'node:test';
import assert from 'node:assert/strict';
import {Queue} from '../core.js';

const draft={summary:'原摘要',meaningful:true,needs_review:false,intent:'B',next_purpose:'手动填写'};
const item={id:'one',recordId:'customer',status:'ready',transcript:'客户正在上课',meta:{date:'2026-11-18'},draft,selectedItem:true};

test('resummarization uses stored text even without audio and preserves other draft fields',async()=>{
  const calls=[];
  const queue=new Queue('test',{
    summarize:async(...args)=>{calls.push(args);return {...draft,summary:'客户正在上课。',intent:'E',next_purpose:null};},
    transcribe:()=>assert.fail('不应重新转写'),
    proxy:()=>assert.fail('不应访问飞书')
  });
  queue.items=[{...item}];
  queue.persist=async()=>{};
  await queue.resummarize(item.id);
  assert.deepEqual(calls,[[item.transcript,item.meta]]);
  assert.deepEqual(queue.items[0].draft,{...draft,summary:'客户正在上课。',follow_up_evidence:null});
  assert.equal(queue.items[0].status,'review');
  assert.equal(queue.items[0].selectedItem,false);
});

test('failed request preserves existing draft and selection',async()=>{
  const queue=new Queue('test',{summarize:async()=>{throw Error('模拟失败');}});
  queue.items=[{...item}];
  queue.persist=()=>assert.fail('失败不应保存');
  await assert.rejects(queue.resummarize(item.id),/模拟失败/);
  assert.deepEqual(queue.items[0],item);
});

test('batch proceeds sequentially, preserves failed drafts and stops before the next request',async()=>{
  const calls=[];
  const queue=new Queue('test',{summarize:async text=>{
    calls.push(text);
    if(text==='失败')throw Error('模拟失败');
    queue.stop=true;
    return {...draft,summary:'新摘要'};
  }});
  queue.items=['失败','成功','未处理'].map(id=>({...item,id,transcript:id}));
  queue.persist=async()=>{};
  assert.deepEqual(await queue.resummarizeSelected(['失败','成功','未处理']),{
    completed:1,failed:1,unprocessed:1,firstError:'模拟失败'
  });
  assert.deepEqual(calls,['失败','成功']);
  assert.deepEqual(queue.items.map(row=>row.draft.summary),['原摘要','新摘要','原摘要']);
  assert.equal(queue.running,false);
});
