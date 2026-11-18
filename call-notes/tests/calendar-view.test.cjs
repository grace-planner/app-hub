const test=require('node:test');
const assert=require('node:assert/strict');
const view=require('../queue-view.js');

test('batch summary selection excludes hidden, unchecked and missing-transcript rows',()=>{
  const base={status:'ready',selectedItem:true,hasTranscript:true};
  const items=[
    {...base,id:'eligible'},
    {...base,id:'hidden',status:'review'},
    {...base,id:'unchecked',selectedItem:false},
    {...base,id:'no-text',hasTranscript:false},
    {...base,id:'trash',trashedAt:'2026-11-18'}
  ];
  assert.deepEqual(view.actionIds(view.inbox(items,'ready'),items.map(i=>i.id),'resummarize'),['eligible']);
});

const rows=[
  {id:'b',customer:'王妈妈',status:'done',meta:{date:'2026-11-18',epoch:200,stamp:'2026/11/18 14:00'}},
  {id:'a',filename:'李同学_20261118_090000.wav',status:'ready',meta:{date:'2026-11-18',epoch:100,stamp:'2026/11/18 09:00',sourceLabel:'李同学'}},
  {id:'c',filename:'电话_20261119_100000.wav',status:'queued',meta:{date:'2026-11-19',epoch:300,stamp:'2026/11/19 10:00',sourceLabel:'电话'}},
  {id:'trash',customer:'回收站',status:'ready',trashedAt:'2026-11-18',meta:{date:'2026-11-18',epoch:50}},
];

test('calendar uses recording dates, names and chronological order',()=>{
  const days=view.calendarRange(rows,'2026-11-18',2);
  assert.equal(days[0].date,'2026-11-18');
  assert.equal(days[0].count,2);
  assert.deepEqual(days[0].items.map(i=>view.displayName(i)),['李同学','王妈妈']);
  assert.equal(days[1].count,1);
});

test('month grid has 42 cells and excludes trash',()=>{
  const month=view.calendarMonth(rows,'2026-11-18');
  assert.equal(month.length,42);
  assert.equal(month.find(d=>d.date==='2026-11-18').count,2);
});
