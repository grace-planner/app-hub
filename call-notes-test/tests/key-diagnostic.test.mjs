import test from 'node:test';
import assert from 'node:assert/strict';
import {authProbe,Services} from '../core.js';

test('auth probe distinguishes a rejected key without exposing it',async()=>{
  let request;
  const result=await authProbe('https://dashscope.aliyuncs.com/api/v1/test','secret-key',async(url,options)=>{request={url,options};return {status:401};});
  assert.equal(result.verdict,'invalid_key');
  assert.equal(result.status,401);
  assert.equal(request.options.body,'{}');
  assert.equal(JSON.stringify(result).includes('secret-key'),false);
});

test('auth probe treats validation errors as accepted authentication',async()=>{
  const result=await authProbe('https://dashscope.aliyuncs.com/api/v1/test','secret-key',async()=>({status:400}));
  assert.equal(result.verdict,'accepted');
  assert.match(result.message,/未提交录音或模型推理/);
});

test('aliyun diagnostic checks audio and text endpoints separately',async()=>{
  const requests=[];
  const fetcher=async(url,options)=>{requests.push({url,options});return {status:url.includes('multimodal-generation')?401:400};};
  const services=new Services({audioBase:'https://dashscope.aliyuncs.com/api/v1',textBase:'https://dashscope.aliyuncs.com/compatible-mode/v1'},{audio:'audio-secret',text:'text-secret'},fetcher);
  const result=await services.diagnoseAliyun();
  assert.equal(result.audio.verdict,'invalid_key');
  assert.equal(result.text.verdict,'accepted');
  assert.equal(requests.length,2);
  assert.equal(requests[0].options.body,'{}');
  assert.equal(requests[1].options.body,'{}');
});
