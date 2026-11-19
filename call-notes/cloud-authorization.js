import {batch,get} from './browser-platform.js?v=20261119-cloud-test';

const storageKey='cloudAuthorization';
const encode=text=>new TextEncoder().encode(text);

export async function rememberAuthorization(endpoint,token){
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encode(endpoint)},key,encode(token));
  await batch([{key:storageKey,value:{endpoint,key,iv,ciphertext}}],{reportFailure:false});
}

export async function readAuthorization(){
  const saved=await get(storageKey);
  if(!saved)return null;
  const {endpoint,key,iv,ciphertext}=saved;
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encode(endpoint)},key,ciphertext);
  return {endpoint,token:new TextDecoder().decode(bytes)};
}

export function forgetAuthorization(){
  return batch([{key:storageKey,remove:true}],{reportFailure:false});
}
