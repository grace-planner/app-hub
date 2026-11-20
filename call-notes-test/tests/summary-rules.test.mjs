import test from 'node:test';
import assert from 'node:assert/strict';
import {SUMMARY_RULES,Services} from '../core.js';

test('summary rules retain actionable CRM details when present',()=>{
  for(const detail of ['居住区域','学校','年级','当前成绩','目标','课程','课时','班型','校区','价格','优惠','顾虑','拒绝原因','下一步']){
    assert.match(SUMMARY_RULES,new RegExp(detail));
  }
  assert.match(SUMMARY_RULES,/不能为了简短而删除/);
  assert.match(SUMMARY_RULES,/信息很少或无效的通话只用一句话写实际发生的事/);
  assert.match(SUMMARY_RULES,/本次仅确认联系方式，未涉及具体咨询内容/);
  assert.match(SUMMARY_RULES,/只写录音实际出现的信息/);
  assert.match(SUMMARY_RULES,/必须直接省略/);
  assert.match(SUMMARY_RULES,/严禁罗列缺失/);
  assert.match(SUMMARY_RULES,/不得写“未介绍课程、价格、校区”/);
  assert.match(SUMMARY_RULES,/“未涉及成绩、年级、学校、居住地”/);
  assert.match(SUMMARY_RULES,/无法提取CRM跟进所需字段/);
  assert.match(SUMMARY_RULES,/明确说某件事尚未决定、仍在考虑或需要补充时/);
  assert.match(SUMMARY_RULES,/当前顾问是龚老师/);
  assert.match(SUMMARY_RULES,/其他老师/);
  assert.match(SUMMARY_RULES,/宫老师/);
  assert.match(SUMMARY_RULES,/review_reason只写需要人工核对的具体疑点/);
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
  assert.match(request.body.messages[0].content,/未接/);
});
