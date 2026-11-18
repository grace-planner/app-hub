import test from 'node:test';
import assert from 'node:assert/strict';
import {modelProbe,Services} from '../core.js';

test('model probe distinguishes a rejected key without exposing it',async()=>{
  let request;
  const options={method:'POST',headers:{Authorization:'Bearer secret-key'},body:'real-model-body'};
  const result=await modelProbe('https://dashscope.aliyuncs.com/api/v1/test',options,async(url,actual)=>{request={url,options:actual};return {status:401};});
  assert.equal(result.verdict,'invalid_key');
  assert.equal(result.status,401);
  assert.equal(request.options.body,'real-model-body');
  assert.equal(JSON.stringify(result).includes('secret-key'),false);
});

test('model probe does not call a 400 response successful',async()=>{
  const result=await modelProbe('https://dashscope.aliyuncs.com/api/v1/test',{method:'POST'},async()=>({status:400}));
  assert.equal(result.verdict,'request_error');
});

test('model probe returns sanitized provider detail',async()=>{
  const result=await modelProbe('https://dashscope.aliyuncs.com/api/v1/test',{method:'POST'},async()=>({status:401,json:async()=>({error:{message:'Incorrect API key provided: sk-secret-key'}})}));
  assert.equal(result.detail,'Incorrect API key provided: [密钥已隐藏]');
  assert.equal(JSON.stringify(result).includes('sk-secret-key'),false);
});

test('aliyun diagnostic checks audio and text endpoints separately',async()=>{
  const requests=[];
  const fetcher=async(url,options)=>{requests.push({url,options});return {status:200};};
  const services=new Services({audioBase:'https://dashscope.aliyuncs.com/api/v1',audioModel:'qwen-audio-3.1-asr-flash',textBase:'https://dashscope.aliyuncs.com/compatible-mode/v1',textModel:'qwen-plus'},{audio:'shared-secret',text:'shared-secret'},fetcher);
  const result=await services.diagnoseAliyun();
  assert.equal(result.audio.verdict,'accepted');
  assert.equal(result.text.verdict,'accepted');
  assert.equal(result.key.length,'shared-secret'.length);
  assert.match(result.key.sha256,/^[0-9a-f]{16}$/);
  assert.equal(JSON.stringify(result).includes('shared-secret'),false);
  assert.equal(requests.length,2);
  assert.equal(requests[0].options.headers.Authorization,'Bearer shared-secret');
  assert.equal(requests[1].options.headers.Authorization,'Bearer shared-secret');
  const audioBody=JSON.parse(requests[0].options.body),textBody=JSON.parse(requests[1].options.body);
  assert.equal(audioBody.model,'qwen-audio-3.1-asr-flash');
  assert.match(audioBody.input.messages[0].content[0].input_audio.data,/^https:\/\/dashscope\.oss-cn-beijing\.aliyuncs\.com\//);
  assert.equal(textBody.model,'qwen-plus');
});

test('aliyun diagnostic rejects split internal keys',async()=>{
  const services=new Services({audioBase:'https://dashscope.aliyuncs.com/api/v1',textBase:'https://dashscope.aliyuncs.com/compatible-mode/v1'},{audio:'one',text:'two'},async()=>({status:200}));
  await assert.rejects(()=>services.diagnoseAliyun(),/同一把百炼密钥/);
});
