// Edge-case tests for prerequisite checking and 4-course schedule building,
// run against the real Spring 2027 catalog. Run: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

// Minimal TypeScript module loader (relative imports + JSON), so tests use the real app code.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();
function load(file) {
  const candidates = [file, `${file}.ts`, `${file}.tsx`];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) throw new Error(`Cannot resolve ${file}`);
  if (cache.has(resolved)) return cache.get(resolved);
  if (resolved.endsWith('.json')) { const data = JSON.parse(fs.readFileSync(resolved, 'utf8')); cache.set(resolved, data); return data; }
  const module = { exports: {} };
  cache.set(resolved, module.exports);
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInThisContext(`(function (exports, module, require) {${code}\n})`)(module.exports, module, (spec) => load(path.resolve(path.dirname(resolved), spec)));
  cache.set(resolved, module.exports);
  return module.exports;
}
const lib = (name) => load(path.join(root, 'app/lib', name));
const { courses, overlaps } = lib('courses');
const { checkPrereq, makeRecord, missingParts, parsePlacements } = lib('prereqs');
const { buildSchedule, alternativeFor, majorPrefixFromProfile } = lib('schedule');
const { summarizeAudit } = lib('advisor');

const byCrn = (crn) => courses.find((course) => course.crn === crn);
const status = (crn, taken, placements = {}, concurrent = []) => checkPrereq(byCrn(crn), makeRecord(taken, placements, concurrent)).status;

// Requirement names exactly as Degree Works lists them for an undeclared student.
const AUDIT = summarizeAudit({ requirements: [
  ['Exploration Phase: Language Study', 'incomplete'], ['Concentration Phase: Major Requirements', 'incomplete'],
  ['Connections Seminar', 'in-progress'], ['Arts Requirement', 'in-progress'], ['Humanities Requirement', 'complete'],
  ['Social Sciences Requirement', 'complete'], ['World Perspectives Requirement', 'in-progress'],
  ['Natural Science Lab Course', 'in-progress'], ['Natural Science in Perspective or 2nd Lab Course', 'in-progress'],
  ['LANGUAGE STUDY REQUIREMENT', 'incomplete'], ['Complete 3rd-semester Level (201 Level) Course, or Higher', 'incomplete'],
  ['Your Major Is Not Declared/Approved', 'incomplete'],
].map(([name, s]) => ({ name, status: s })), checkedAt: '', version: 2, source: '', partial: true });
const SATISFIED = ['ARTS', 'HUMA', 'SOCS', 'WRLD', 'NATL', 'NSIP'];

function input(overrides) {
  return { openNeeds: AUDIT.open, satisfiedTags: SATISFIED, plan: [], ...overrides };
}
// Invariants every schedule must satisfy.
function assertValid(result, inp) {
  const all = [...inp.plan, ...result.picks.map((pick) => pick.course)];
  const codes = all.map((course) => course.code);
  assert.equal(new Set(codes).size, codes.length, `duplicate course codes: ${codes}`);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    assert(!overlaps(all[i], all[j]), `${all[i].code} overlaps ${all[j].code}`);
    assert(!(all[i].title === all[j].title && JSON.stringify(all[i].meetings) === JSON.stringify(all[j].meetings)), `cross-listed duplicate ${all[i].code}/${all[j].code}`);
  }
  for (const { course, prereq } of result.picks) {
    assert(!course.permission, `${course.code} needs permission`);
    assert(!inp.record.taken.has(course.code), `${course.code} already taken`);
    if (inp.classYear) assert(!course.closedTo.includes(inp.classYear), `${course.code} closed to ${inp.classYear}`);
    assert.notEqual(prereq, 'unmet', `${course.code} prerequisite unmet`);
    assert(course.meetings.length > 0 && !/^lab$/i.test(course.title), `${course.code} is not a schedulable course`);
  }
}

test('reads Degree Works placements', () => {
  assert.deepEqual({ ...parsePlacements('French Placement 102, Spanish Placement 101', 'Math Placement 110') }, { FRN: 102, SPA: 101, MAT: 110 });
  assert.deepEqual({ ...parsePlacements(undefined, '') }, {});
});

test('prerequisites: AND/OR groups, placements and compact codes like "CPS112"', () => {
  // CPS 222: (CPS112 OR PLACEMENT IN 222) AND (MAT 109 OR ... OR PLACEMENT IN 110 OR PLACEMENT IN 111)
  assert.equal(status('20375', ['CPS 112', 'MAT 109']), 'met');
  assert.equal(status('20375', ['CPS 112'], { MAT: 110 }), 'met');
  assert.equal(status('20375', ['CPS 112'], { SPA: 101 }), 'unmet'); // placements known, but none in math
  assert.equal(status('20375', ['CPS 112'], {}), 'unknown'); // no placement data at all
  assert.equal(status('20375', [], { MAT: 110 }), 'unmet');
});

test('prerequisites: says only the missing part, in plain words', () => {
  // CPS 261: (CPS 112 OR PLACEMENT IN 222) AND (CPS 237 OR MAT 237 )
  const cps261 = byCrn('20378');
  const junior = makeRecord(['CPS 111', 'CPS 112', 'MAT 109', 'MAT 110'], { MAT: 109 });
  assert.deepEqual(missingParts(cps261, junior), ['CPS 237 or MAT 237']);
  assert.equal(checkPrereq(cps261, junior).reason, 'Needs CPS 237 or MAT 237.');
  assert.deepEqual(missingParts(cps261, makeRecord([], { MAT: 109 })), ['CPS 112 or placement into 222', 'CPS 237 or MAT 237']);
  assert.deepEqual(missingParts(cps261, makeRecord(['CPS 112', 'CPS 237'])), []);
  // CPS 222's compact "CPS112" code reads as "CPS 112".
  assert.deepEqual(missingParts(byCrn('20375'), makeRecord(['MAT 109'], { MAT: 109 })), ['CPS 112 or placement into 222']);
});

test('prerequisites: "may be taken concurrently" counts courses planned for the same term', () => {
  assert.equal(status('20153', [], { SPA: 101 }, ['MAT 109']), 'met'); // PHY 111 with MAT 109 alongside
  assert.equal(status('20153', [], { SPA: 101 }), 'unmet');
});

test('prerequisites: language placement levels', () => {
  assert.equal(status('20169', [], { FRN: 102 }), 'met'); // FRN 102 with French placement 102
  assert.equal(status('20353', [], { SPA: 101 }), 'unmet'); // SPA 201 needs SPA 102 or placement 201
  assert.equal(status('20353', ['SPA 102'], {}), 'met');
});

test('prerequisites: written-out rules and permission paths', () => {
  assert.equal(status('20340', ['PHI 100', 'PHI 130']), 'met'); // "Two prior philosophy courses"
  assert.equal(status('20340', ['PHI 100']), 'unmet');
  assert.equal(status('20263', ['SOC 100', 'SOC 200']), 'met'); // "SOC 100 plus one other SOC course"
  assert.equal(status('20263', ['SOC 100']), 'unmet');
  assert.equal(status('20345', ['PSY 100']), 'met'); // "One PHI or one PSY course"
  assert.equal(status('20010', ['BIO 102']), 'unknown'); // (BIO 101 OR PERMISSION) AND BIO 102
  assert.equal(status('20010', ['BIO 101', 'BIO 102']), 'met');
});

test('maps the Degree Works major field to a subject', () => {
  assert.equal(majorPrefixFromProfile('Computer Science'), 'CPS');
  assert.equal(majorPrefixFromProfile('Economics'), 'ECO');
  assert.equal(majorPrefixFromProfile('Undeclared'), null);
  assert.equal(majorPrefixFromProfile(''), null);
});

test('first-year, undeclared, French placement 102: full 4-course plan with French 102', () => {
  const inp = input({ classYear: 'FR', majorPrefix: null, record: makeRecord([], parsePlacements('French Placement 102, Spanish Placement 101', 'Math Placement 110')) });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  assert.equal(result.picks.length, 4);
  const language = result.picks.find((pick) => pick.role === 'language');
  assert.equal(language?.course.code, 'FRN 102');
  assert(!result.picks.some((pick) => /^SPA 2/.test(pick.course.code)), 'should not suggest Spanish 201+ with placement 101');
});

test('sophomore exploring economics gets an ECO entry course plus math support', () => {
  const inp = input({ classYear: 'SO', majorPrefix: 'ECO', record: makeRecord(['CPS 111'], { MAT: 110, FRN: 102 }) });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  assert.equal(result.picks.length, 4);
  assert(result.picks.some((pick) => pick.role === 'major' && pick.course.code.startsWith('ECO ')), 'expected an ECO course');
  assert(result.picks.some((pick) => pick.role === 'support' && pick.course.code.startsWith('MAT ')), 'expected math support');
});

test('junior CS major moves to the next courses in the sequence and explains blocked ones', () => {
  const inp = input({ classYear: 'JR', majorPrefix: 'CPS', openNeeds: AUDIT.open.filter((need) => need.kind !== 'language'),
    record: makeRecord(['CPS 111', 'CPS 112', 'MAT 109', 'MAT 110'], { MAT: 110 }) });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  const cps = result.picks.filter((pick) => pick.course.code.startsWith('CPS '));
  assert(cps.length >= 2, `expected two CS courses, got ${cps.map((p) => p.course.code)}`);
  assert(cps.some((pick) => /builds on/.test(pick.reason)), 'expected a next-step reason');
  assert(!result.picks.some((pick) => ['CPS 111', 'CPS 112'].includes(pick.course.code)));
  assert(result.blocked.every(({ course }) => course.code.startsWith('CPS ')));
  assert(result.blocked.some(({ reason }) => /CPS 222|CPS 237/.test(reason)), 'expected courses blocked behind CPS 222 or 237');
});

test('Spanish placement 101 only: no 201-level Spanish and a note explaining why', () => {
  const inp = input({ classYear: 'SO', majorPrefix: null, record: makeRecord([], { SPA: 101 }) });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  assert(!result.picks.some((pick) => pick.course.code.startsWith('SPA ') && parseInt(pick.course.code.split(' ')[1], 10) >= 201));
  assert(result.notes.some((note) => /Spanish/.test(note)), `expected a Spanish note, got ${result.notes}`);
});

test('existing plan of two courses: only two more, none overlapping', () => {
  const plan = [byCrn('20373'), byCrn('20094')]; // CPS 111 + MAT 109 A
  const inp = input({ classYear: 'FR', majorPrefix: 'CPS', plan, record: makeRecord([], { MAT: 110, FRN: 102 }) });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  assert.equal(result.picks.length, 2);
});

test('full plan already: no picks, a note instead', () => {
  const plan = ['20373', '20094', '20208', '20169'].map(byCrn);
  const inp = input({ classYear: 'FR', majorPrefix: null, plan, record: makeRecord([], {}) });
  const result = buildSchedule(inp);
  assert.equal(result.picks.length, 0);
  assert(result.notes.some((note) => /already has 4/.test(note)));
});

test('seniors never get sections closed to seniors', () => {
  const inp = input({ classYear: 'SR', majorPrefix: 'ANT', openNeeds: [], record: makeRecord([], { FRN: 102 }) });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  assert(!result.picks.some((pick) => pick.course.closedTo.includes('SR')));
});

test('constraints: no Friday classes and nothing before 10am', () => {
  const inp = input({ classYear: 'SO', majorPrefix: 'CPS', record: makeRecord(['CPS 111'], { MAT: 110, FRN: 102 }), constraints: { excludeDays: [4], earliest: 600 } });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  for (const { course } of result.picks) for (const item of course.meetings) {
    assert(!item.days.includes(4), `${course.code} meets Friday`);
    assert(item.start >= 600, `${course.code} starts before 10am`);
  }
});

test('rejecting a pick offers a different course for the same slot', () => {
  const inp = input({ classYear: 'FR', majorPrefix: 'CPS', record: makeRecord([], { MAT: 110, FRN: 102 }) });
  const result = buildSchedule(inp);
  const rejected = result.picks.find((pick) => pick.role === 'elective' || pick.role === 'support');
  assert(rejected, `expected an elective or support pick, got ${result.picks.map((p) => p.role)}`);
  const others = result.picks.filter((pick) => pick !== rejected).map((pick) => pick.course);
  const alternative = alternativeFor(rejected, { ...inp, plan: others, exclude: new Set([rejected.course.crn]) });
  assert(alternative, 'expected an alternative');
  assert.notEqual(alternative.course.crn, rejected.course.crn);
  assert.equal(alternative.role, rejected.role);
  assert(!others.some((course) => overlaps(course, alternative.course)), 'alternative must fit the rest of the plan');
});

test('rejecting the only eligible course in a sequence has no alternative (CPS 111 for a first-year)', () => {
  const inp = input({ classYear: 'FR', majorPrefix: 'CPS', record: makeRecord([], { MAT: 110, FRN: 102 }) });
  const result = buildSchedule(inp);
  const major = result.picks.find((pick) => pick.role === 'major');
  assert.equal(major?.course.code, 'CPS 111');
  assert.equal(alternativeFor(major, { ...inp, plan: [], exclude: new Set([major.course.crn]) }), null);
});

test('prerequisites: "advanced" placements are above the 202 level', () => {
  assert.equal(status('20392', [], { SPA: 101 }), 'unmet'); // SPA 226: SPA 202 OR PLACEMENT IN ADVANCED LOW OR ADVANCED MID
  assert.equal(status('20392', [], { SPA: 301 }), 'met');
  assert.equal(status('20392', ['SPA 202'], { SPA: 101 }), 'met');
});

test('student who has taken every intro course still gets a full plan of electives', () => {
  const taken = courses.filter((course) => parseInt(course.code.split(' ')[1], 10) < 200).map((course) => course.code);
  const inp = input({ classYear: 'JR', majorPrefix: null, openNeeds: [], record: makeRecord(taken, { FRN: 102 }) });
  const result = buildSchedule(inp);
  assertValid(result, inp);
  assert.equal(result.picks.length, 4);
  assert.equal(new Set(result.picks.map((pick) => pick.course.code.split(' ')[0])).size, 4, 'electives should vary by subject');
});
