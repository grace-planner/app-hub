import test from 'node:test';
import assert from 'node:assert/strict';
import {SUMMARY_RULES,Services,suggestedFollowUp,planFields} from '../core.js';

test('substantive contact can receive a default date even with a negative intent',()=>{
  const meta={date:'2026-01-31',stamp:'2026/01/31 10:00'};
  const draft={summary:'客户介绍了自己的情况，暂不需要。',meaningful:true,needs_review:false,intent:'E',follow_up_evidence:'我现在是大二'};
  const newest={newestCall:true};
  assert.equal(suggestedFollowUp(meta,draft,{},newest),'2026-02-28');
  assert.equal(suggestedFollowUp(meta,{...draft,follow_up_evidence:null},{},newest),'');
  assert.equal(suggestedFollowUp(meta,draft,{next_date:'2026-02-16'},newest),'');
  assert.equal(suggestedFollowUp(meta,draft,{},{newestCall:false}),'');
  const record={fields:{'下次跟进日期':1771171200000}};
  const fields=planFields(record,meta,{...draft,next_date:'2026-02-28',default_follow_up:true}).fields;
  assert.equal(Object.hasOwn(fields,'下次跟进日期'),false);
});

test('summary rules retain actionable CRM details when present',()=>{
  for(const detail of ['居住区域','学校','年级','当前成绩','目标','课程','课时','班型','校区','价格','优惠','顾虑','拒绝原因','下一步']){
    assert.match(SUMMARY_RULES,new RegExp(detail));
  }
  assert.match(SUMMARY_RULES,/不能为了简短而删除/);
  assert.match(SUMMARY_RULES,/信息很少或无效的通话只写一句/);
  assert.match(SUMMARY_RULES,/只写录音实际出现的信息/);
  assert.match(SUMMARY_RULES,/必须直接省略/);
  assert.match(SUMMARY_RULES,/不写“尚未确认年级、学校、成绩、课程”等缺失清单/);
  assert.match(SUMMARY_RULES,/明确说某件事尚未决定、仍在考虑或需要补充时/);
  assert.match(SUMMARY_RULES,/不得列举录音未提到的字段/);
  assert.match(SUMMARY_RULES,/信息很少或无效的通话只写一句/);
  assert.match(SUMMARY_RULES,/当前顾问是龚老师/);
  assert.match(SUMMARY_RULES,/其他老师/);
  assert.match(SUMMARY_RULES,/宫老师/);
});

test('summary request uses low temperature and keeps JSON output',async()=>{
  let request;
  const draft={meaningful:true,needs_review:false,review_reason:null,summary:'客户住武侯区，正在比较课程。',intent:'B',next_date:null,next_purpose:null,reminder_date:null,reminder_note:null,suggested_name:null,name_evidence:null};
  const fetcher=async(url,options)=>{request={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(draft)}}]})};};
  const services=new Services({textBase:'https://dashscope.aliyuncs.com/compatible-mode/v1',textModel:'qwen-plus'},{text:'test-key'},fetcher);
  await services.summarize('客户住武侯区，正在比较课程。',{date:'2026-11-18'});
  assert.equal(request.body.temperature,0.1);
  assert.deepEqual(request.body.response_format,{type:'json_object'});
  assert.ok(request.body.messages[0].content.startsWith(SUMMARY_RULES));
  assert.match(request.body.messages[0].content,/follow_up_evidence/);
  assert.equal(request.body.enable_thinking,false);

  for(const model of ['qwen3.6-plus','deepseek-v4.1-flash']){
    services.settings.textModel=model;
    await services.summarize('客户住武侯区，正在比较课程。',{date:'2026-11-18'});
    assert.equal(request.body.model,model);
    assert.equal(request.body.enable_thinking,false);
    assert.deepEqual(request.body.response_format,{type:'json_object'});
  }
});
