'use strict';
(function(root){
  function group(item){
    if(item.trashedAt||item.status==='done')return null;
    if(['queued','skipped','processing'].includes(item.status))return 'analysis';
    if(['ready','writing'].includes(item.status))return 'ready';
    return 'attention';
  }
  function inbox(items,filter='all'){return items.filter(i=>group(i)&&(filter==='all'||group(i)===filter));}
  function eligible(item,action){return !item.trashedAt&&(action==='analysis'?(item.hasSource||!!item.file)&&!['done','uncertain','invalid','processing','writing'].includes(item.status):item.status==='ready'&&!!item.recordId);}
  function actionIds(items,ids,action){
    if(!Array.isArray(ids))throw Error('请在当前列表勾选项目后操作');
    const wanted=new Set(ids);
    return items.filter(i=>wanted.has(i.id)&&i.selectedItem&&eligible(i,action)).map(i=>i.id);
  }
  const api={group,inbox,eligible,actionIds};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.crmView=api;
})(typeof window==='object'?window:globalThis);
