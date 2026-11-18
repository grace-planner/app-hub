import test from 'node:test';
import assert from 'node:assert/strict';
import {SUMMARY_RULES,Services} from '../core.js';

test('summary rules retain actionable CRM details when present',()=>{
  for(const detail of ['居住区域','学校','年级','当前成绩','目标','课程','课时','班型','校区','价格','优惠','顾虑','拒绝原因','尚未确认','下一步']){
    assert.match(SUMMARY_RULES,new RegExp(detail));
  }
  assert.match(SUMMARY_RULES,/不能为了简短而删除/);
  assert.match(SUMMARY_RULES,/简单通话可以短/);
});

test('summary request uses low temperature and keeps JSON output',async()=>{
  let request;
  const draft={meaningful:true,needs_review:false,review_reason:null,summary:'客户住武侯区，正在比较课程。',intent:'B',next_date:null,next_purpose:null,reminder_date:null,reminder_note:null,suggested_name:null,name_evidence:null};
  const fetcher=async(url,options)=>{request={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(draft)}}]})};};
  const services=new Services({textBase:'https://dashscope.aliyuncs.com/compatible-mode/v1',textModel:'qwen-plus'},{text:'test-key'},fetcher);
  await services.summarize('客户住武侯区，正在比较课程。',{date:'2026-11-18'});
  assert.equal(request.body.temperature,0.1);
  assert.deepEqual(request.body.response_format,{type:'json_object'});
  assert.equal(request.body.messages[0].content,SUMMARY_RULES);
});
