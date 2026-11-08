import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { syncAllAvailability } from '../extension/full-sync.mjs';
import { connectionView } from '../extension/connection-status.mjs';

const moduleExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/lib/availability.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {exports: moduleExports});
const { parseAvailability, availabilityLabel } = moduleExports;
const checkedAt = new Date().toISOString();
const wrap = (records, term = '202620') => JSON.stringify({version:1,term,records:records.map(row=>({checkedAt,...row}))});

test('distinguishes reserved seats from ordinary open seats and waitlist capacity', () => {
  const records=parseAvailability(wrap([
    {crn:'20277',status:'1 of 25 seats remain.78 of 80 waitlist seats remain. Open Seats Reserved for Waitlisted Only.'},
    {crn:'20278',status:'FULL: 0 of 25 seats remain. 16 of 20 waitlist seats remain.'},
    {crn:'20288',status:'4 of 7 seats remain. 30 of 30 waitlist seats remain.'},
  ]));
  assert.equal(records['20277'].seats,1);assert.equal(records['20277'].waitlist,78);assert.equal(records['20277'].waitlistCapacity,80);
  assert.match(availabilityLabel(records['20277']),/Reserved/);
  assert.equal(availabilityLabel(records['20278']),'Full');
  assert.equal(availabilityLabel(records['20288']),'4 of 7 seats remaining');
  assert.equal(availabilityLabel(records['99999']),'Availability unknown');
});

test('rejects wrong terms, malformed data, invalid counts and timestamps',()=>{
  for(const raw of ['broken','null',wrap([{crn:'20277',status:'1 of 25 seats remain.'}],'202710'),wrap([{crn:'20277',status:'26 of 25 seats remain.'}]),wrap([{crn:'20277',status:'FULL',checkedAt:'invalid'}])]) assert.equal(Object.keys(parseAvailability(raw)).length,0);
  assert.equal(availabilityLabel(parseAvailability(wrap([{crn:'20277',status:'Unknown status'}]))['20277']),'Availability unknown');
});

test('planner bridge writes snapshots and notifies the open planner',async()=>{
  const written={}; let listener,notified=false;
  const snapshot={version:1,term:'202620',records:[{crn:'20277',status:'1 of 25 seats remain.',checkedAt}]};
  vm.runInNewContext(fs.readFileSync(new URL('../extension/planner-bridge.js',import.meta.url),'utf8'),{
    chrome:{storage:{local:{get:async()=>({'fm-availability:spring-2027:v1':snapshot})},onChanged:{addListener:fn=>{listener=fn;}}}},
    localStorage:{setItem:(key,value)=>{written[key]=value;}},window:{dispatchEvent:()=>{notified=true;}},Event,
  });
  await Promise.resolve();
  assert.equal(JSON.parse(written['fm-availability:spring-2027:v1']).records[0].crn,'20277');assert(notified);assert.equal(typeof listener,'function');
});


async function simulateFullSync({repeat=false,cancel=false}={}) {
  let stage='results', page=0, listener;
  const saved={};
  const visible=(yes)=>({getClientRects:()=>yes?[{}]:[]});
  const crns=()=>page===0?['20277','20278']:(repeat?['20277']:['20288']);
  const row=crn=>({querySelector:selector=>selector.includes('courseReferenceNumber')?{textContent:crn}:selector.includes('section-details-link')?{getAttribute:()=>`202620,${crn}`}:{getAttribute:()=> '1 of 25 seats remain.'}});
  const document={
    querySelector(selector) {
      if(selector==='#search-again-button')return {...visible(stage==='results'),click(){stage='search';}};
      if(selector==='#search-clear')return {...visible(stage==='search'),click(){}};
      if(selector==='#search')return {textContent:'Term: Spring 2027'};
      if(selector==='#search-go')return {...visible(stage==='search'),click(){stage='results';page=0;}};
      if(selector==='#searchResultsTable')return visible(stage==='results');
      if(selector==='#searchTerms')return {textContent:'Term: Spring 2027'};
      if(selector==='#searchResults h3')return {textContent:'Search Results — 3 Classes'};
      if(selector.includes('title="Next"'))return {disabled:page>0,getAttribute:()=>null,click(){page++;}};
      return null;
    },
    querySelectorAll(selector) {return selector.includes('tbody tr')?crns().map(row):stage==='results'?crns().map(crn=>({textContent:crn})):[];}
  };
  await vm.runInNewContext(`(${syncAllAvailability.toString()})()`,{
    location:{origin:'https://prd-reg9.fandm.edu',pathname:'/StudentRegistrationSsb/ssb/classSearch/classSearch'},
    document, setTimeout:fn=>{queueMicrotask(fn);}, Event,
    chrome:{storage:{local:{get:async key=>({[key]:saved[key]}),set:async values=>{
      Object.assign(saved,values);
      const job=values['fm-availability-sync'];
      if(cancel&&job?.state==='running'&&job.scanned>0)listener({'fm-availability-sync':{newValue:{...job,cancel:true}}},'local');
    }},onChanged:{addListener:fn=>{listener=fn;},removeListener(){}}}}
  });
  return saved;
}

test('full sync navigates every results page and verifies completeness',async()=>{
  const saved=await simulateFullSync();
  assert.equal(saved['fm-availability-sync'].state,'complete');
  assert.equal(saved['fm-availability-sync'].scanned,3);
  assert.equal(saved['fm-availability:spring-2027:v1'].records.length,3);
});

test('full sync reports repeated pages and cancellation without claiming completion',async()=>{
  const repeated=await simulateFullSync({repeat:true});
  assert.equal(repeated['fm-availability-sync'].state,'error');
  assert.match(repeated['fm-availability-sync'].message,/repeated/);
  const cancelled=await simulateFullSync({cancel:true});
  assert.equal(cancelled['fm-availability-sync'].state,'cancelled');
  assert.equal(cancelled['fm-availability:spring-2027:v1'].records.length,2);
});


test('update status never presents stopped or overdue refreshes as live',()=>{
  const {autoUpdateLabel}=moduleExports;
  const now=Date.now();
  assert.match(autoUpdateLabel(null,now),/paused/);
  assert.match(autoUpdateLabel(JSON.stringify({enabled:true,state:'waiting',nextCheckAt:now+300000}),now),/Every 5 minutes/);
  assert.match(autoUpdateLabel(JSON.stringify({enabled:true,state:'waiting',nextCheckAt:now-120000}),now),/paused/);
  assert.match(autoUpdateLabel(JSON.stringify({enabled:true,state:'syncing',updatedAt:now-180000}),now),/paused/);
});

test('automatic scheduler refreshes immediately, schedules next pass, and pauses on tab close',async()=>{
  const values={}, handlers={};let scans=0,alarm=null;
  const chrome={
    storage:{local:{get:async key=>({[key]:values[key]}),set:async data=>Object.assign(values,data)}},
    alarms:{create:async(name,settings)=>{alarm={name,...settings};},clear:async()=>{alarm=null;},onAlarm:{addListener:fn=>handlers.alarm=fn}},
    permissions:{contains:async()=>true},
    tabs:{create:async()=>({id:1}),get:async id=>({id,url:'https://prd-reg9.fandm.edu/StudentRegistrationSsb/ssb/classSearch/classSearch'}),onRemoved:{addListener:fn=>handlers.removed=fn},onUpdated:{addListener:fn=>handlers.updated=fn}},
    scripting:{executeScript:async()=>{scans++;values['fm-availability-sync']={state:'complete'};}},
    runtime:{id:'test',onMessage:{addListener:fn=>{const previous=handlers.message;handlers.message=(...args)=>{previous?.(...args);return fn(...args);};}},onStartup:{addListener:fn=>handlers.startup=fn},onInstalled:{addListener:fn=>handlers.installed=fn}}
  };
  vm.runInNewContext(fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),{chrome,syncAllAvailability,URL});
  const reply=await new Promise(resolve=>handlers.message({type:'connect-fm'},{id:'test'},resolve));
  assert(reply.ok);
  assert.equal(values['fm-availability-auto'].state,'connecting');
  await new Promise(resolve=>handlers.message({type:'connection-ready'},{id:'test',tab:{id:99}},resolve));
  assert.equal(scans,0);
  await new Promise(resolve=>handlers.message({type:'connection-ready'},{id:'test',tab:{id:1}},resolve));
  for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(scans,1);assert.equal(values['fm-availability-auto'].state,'waiting');
  assert.equal(alarm.name,'fm-refresh-availability');
  assert(alarm.when>Date.now());
  handlers.alarm({name:alarm.name});
  for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(scans,2);
  await handlers.removed(1);
  assert.equal(values['fm-availability-auto'].enabled,false);assert.equal(alarm,null);
  handlers.alarm({name:'fm-refresh-availability'});
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(scans,2);
});


test('seat bars show remaining counts, proportional fill, warnings, and unknown states',()=>{
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(new URL('../app/components/availability-status.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(source,{exports,require:createRequire(import.meta.url)});
  const record=parseAvailability(wrap([{crn:'20277',status:'18 of 20 seats remain. 78 of 80 waitlist seats remain. Open Seats Reserved for Waitlisted Only.'}]))['20277'];
  const html=renderToStaticMarkup(React.createElement(exports.default,{record}));
  assert.match(html,/Seats available/);assert.match(html,/Waitlist seats left/);
  assert.match(html,/width:90%/);assert.match(html,/width:97.5%/);
  assert.match(html,/18 \/ 20/);assert.match(html,/78 \/ 80/);assert.match(html,/reserved for waitlisted/);
  assert.match(renderToStaticMarkup(React.createElement(exports.default,{})),/Unknown/);
});


test('connection watcher waits for the supported semester before notifying',async()=>{
  let observer,ready=false,notices=0;
  const window={};
  const context={window,document:{documentElement:{},querySelector:selector=>selector==='#searchTerms'?(ready?{textContent:'Term: Spring 2027'}:null):selector==='#search-go'?{}:null},MutationObserver:class{constructor(fn){observer=fn;}observe(){}},chrome:{runtime:{sendMessage:async()=>{notices++;}}}};
  vm.runInNewContext(fs.readFileSync(new URL('../extension/connect-watch.js',import.meta.url),'utf8'),context);
  assert.equal(notices,0);
  ready=true;observer();observer();
  assert.equal(notices,1);
});

test('merged extension preserves Degree Works import approval and availability popup',async()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.action.default_popup,'popup.html');
  assert.equal(manifest.background.type,'module');
  assert(manifest.permissions.includes('alarms'));
  const html=fs.readFileSync(new URL('../extension/popup.html',import.meta.url),'utf8');
  assert(html.includes('id="sync"'));assert(html.includes('id="audit"'));
  const source=fs.readFileSync(new URL('../extension/degree-audit.mjs',import.meta.url),'utf8');
  assert(source.includes('if (!approved) return false;'));
  let approved=false,writes=0,opened=0;
  const returnedAudit={version:2,partial:true,requirements:[{name:'Example requirement',status:'incomplete'}],courses:[]};
  const chrome={scripting:{executeScript:async options=>[{result:options.args?approved:returnedAudit}]},storage:{local:{set:async data=>{writes++;assert.equal(data.degreeAudit,returnedAudit);}}},tabs:{create:async()=>{opened++;}}};
  const importer=vm.runInNewContext(source.replaceAll('export async function','async function')+'\nimportDegreeAudit;', {chrome,URL});
  const tab={id:1,url:'https://degreeworks.fandm.edu/'};
  assert.equal(await importer(tab),false);assert.equal(writes,0);
  approved=true;
  assert.equal((await importer(tab)).requirements,1);assert.equal(writes,1);assert.equal(opened,1);
  await assert.rejects(()=>importer({id:1,url:'https://example.com/'}),/Academic worksheet/);
});


test('popup distinguishes connecting, successful connection, refreshing, and overdue updates',()=>{
  const now=Date.now();
  assert.equal(connectionView(null,null,now).label,'Not connected');
  assert.equal(connectionView({enabled:true,state:'connecting',updatedAt:now},null,now).state,'connecting');
  const waiting={enabled:true,state:'waiting',lastSuccessfulAt:now-1000,nextCheckAt:now+300000};
  assert.equal(connectionView(waiting,{state:'complete',scanned:635},now).label,'Connected to F&M');
  assert.equal(connectionView(waiting,{state:'complete',scanned:635},now).total,635);
  assert.equal(connectionView({...waiting,state:'syncing',updatedAt:now},{state:'running',updatedAt:now},now).connected,true);
  assert.equal(connectionView({...waiting,nextCheckAt:now-120000},null,now).active,false);
  assert.equal(connectionView({...waiting,enabled:false},null,now).state,'disconnected');
});
