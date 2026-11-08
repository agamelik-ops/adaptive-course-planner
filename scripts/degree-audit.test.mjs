import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { degreeWorksView } from '../extension/connection-status.mjs';
import { extractDegreeAudit } from '../extension/degree-audit.mjs';

function loadTs(path, requireFn=()=>({})) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:requireFn});
  return exports;
}
const {parseAudit}=loadTs('../app/lib/degree-audit.ts');

function worksheet() {
  const block={querySelector:()=>({textContent:'Example Major IN-PROGRESS'})};
  const cells=(values)=>values.map(textContent=>({tagName:'TD',textContent}));
  const rows=[
    {children:cells(['Requirement','CPS 111','Intro Computing','A','1','Fall 2025',''])},
    {children:cells(['CPS 112','Computing II','','(1)','Spring 2027',''])},
    {children:cells(['Requirement','CPS 120','Topics','F','1','Fall 2025',''])},
    {children:cells(['Requirement','CPS 111','Intro Computing','A','1','Fall 2025',''])},
  ];
  const headers=['','Course','Title','Grade','Credits','Term','Repeated'].map(textContent=>({textContent}));
  const table={closest:()=>block,querySelectorAll:selector=>selector.includes('thead')?headers:rows};
  const requirement={textContent:'Still needed: one approved elective',closest:()=>block,querySelector:()=>({textContent:'Major elective'})};
  const icon={getAttribute:()=> 'Not complete',closest:()=>requirement};
  const profile=['Major','Minor','Student ID'].map(label=>({textContent:label,parentElement:{querySelector:()=>({textContent:label==='Student ID'?'PRIVATE-ID':`Example ${label}`})}}));
  let expanded=false;
  const document={querySelector:selector=>selector==='#degree'?{value:'Example Degree'}:selector==='#expand-all-audit-sections-summary'?{getAttribute:()=> 'false',click(){expanded=true;}}:null,querySelectorAll:selector=>selector==='table tbody tr'?rows:selector==='#student-details dt'?profile:selector==='svg[aria-label]'?[icon]:selector==='table'?[table]:selector==='.MuiAccordionSummary-root'?[{querySelector:()=>({textContent:'Example Major IN-PROGRESS'}),textContent:'Catalog year: 2025-2026'}]:[]};
  return {document,isExpanded:()=>expanded};
}

test('expands the worksheet, captures courses including rowspan continuations, and excludes identity fields',async()=>{
  const fixture=worksheet();
  const extracted=await vm.runInNewContext(`(${extractDegreeAudit.toString()})()`,{document:fixture.document,setTimeout:fn=>queueMicrotask(fn)});
  assert(fixture.isExpanded());
  assert.equal(extracted.courses.length,3);
  assert.equal(extracted.courses.find(c=>c.code==='CPS 111').status,'completed');
  assert.equal(extracted.courses.find(c=>c.code==='CPS 112').status,'in-progress');
  assert.equal(extracted.courses.find(c=>c.code==='CPS 120').status,'not-completed');
  assert.equal(extracted.requirements[0].details,'Still needed: one approved elective');
  assert.equal(extracted.profile.major,'Example Major');
  assert(!JSON.stringify(extracted).includes('PRIVATE-ID'));
  assert.equal(extracted.partial,true);
  const parsed=parseAudit(extracted);
  assert.equal(parsed.courses.length,3);
  assert.equal(parsed.courses[1].credits,1);
  assert.equal(parsed.profile.major,'Example Major');
  assert.equal(parsed.requirements[0].block,'Example Major');
});

test('legacy requirement imports remain supported and invalid course records do not become completed history',()=>{
  const requirements=[{name:'Humanities',status:'incomplete'}];
  assert.equal(parseAudit({requirements}).requirements.length,1);
  const audit=parseAudit({requirements,courses:[{code:'CPS 111',title:'Intro',term:'Fall 2025',grade:'',credits:-1,status:'invented',blocks:[]},{code:'invalid',term:'Fall 2025'}],profile:{studentId:'PRIVATE-ID',major:'Example Major'}});
  assert.equal(audit.courses.length,1);assert.equal(audit.courses[0].status,'unknown');
  assert.equal(audit.courses[0].credits,null);assert(!JSON.stringify(audit).includes('PRIVATE-ID'));
});

test('advisor excludes completed and in-progress courses but permits failed-course candidates',()=>{
  const courses=['CPS 111','CPS 112','CPS 120'].map((code,index)=>({code,crn:String(index),meetings:[{}],permission:false,closedTo:[],prereq:'',dist:[]}));
  const advisor=loadTs('../app/lib/advisor.ts',()=>({courses,overlaps:()=>false}));
  const result=advisor.recommend({id:'major',label:'Major',kind:'major',status:'incomplete',sources:[]},{plan:[],pending:[],rejected:new Set(),majorPrefix:'CPS',academicCourses:[{code:'CPS 111',status:'completed'},{code:'CPS 112',status:'in-progress'},{code:'CPS 120',status:'not-completed'}]});
  assert.equal(result.length,1);assert.equal(result[0].code,'CPS 120');
});


test('Degree Works badge separates saved audits from an active import and preserves linked state after a failed update',()=>{
  const now=Date.now();
  assert.equal(degreeWorksView(null,null,now).label,'Degree Works not linked');
  const audit={checkedAt:new Date(now).toISOString(),requirements:[{name:'Example',status:'complete'}],courses:[]};
  assert.equal(degreeWorksView(audit,null,now).label,'Degree Works linked');
  assert.match(degreeWorksView(audit,null,now).note,/snapshot/);
  assert.equal(degreeWorksView(audit,{state:'importing',updatedAt:now},now).label,'Importing Degree Works…');
  assert.equal(degreeWorksView(audit,{state:'error',updatedAt:now},now).linked,true);
  assert.equal(degreeWorksView(null,{state:'error',updatedAt:now},now).linked,false);
  assert.equal(degreeWorksView(audit,{state:'importing',updatedAt:now-400000},now).importing,false);
});
