import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNirnayLoan, mergeSharedLoans, amountPaiseForEdit, isEligibleFresh, createSharedReader, sharedEditBase, assertLinkageResolved,returnDateForDecision } from '../js/agri-link-model.js';
const shared = { id: 'shared-1', branchName: '2413 · MAJRA', borrowerName: 'Borrower', amountPaise: 12345678, atsId: 'ATS 12345678', remarks: 'Note', version: 3, createdAt: '2026-10-23T00:00:00Z', nirnay: { firebaseId: 'firebase-1', version: 2, data: { status: 'pending', allocatedTo: 'Officer' }, archived: false } };
test('a shared editor retains the versions it opened with',()=>{
 const original=toNirnayLoan(shared),latest={...original,_sharedVersion:4,_nirnayVersion:3};
 assert.equal(sharedEditBase(latest,original)._sharedVersion,3);
 assert.throws(()=>assertLinkageResolved({category:'Agriculture',status:'pending'},false),/loading/);
 assert.doesNotThrow(()=>assertLinkageResolved({category:'SME'},false));
});
test('an older read cannot overwrite an accepted mutation and busy reads trail refresh',async()=>{
 const pending=[],seen=[];const reader=createSharedReader(()=>new Promise(resolve=>pending.push(resolve)),rows=>seen.push(rows),()=>{});
 const first=reader.refresh();reader.invalidate();pending[0](['old']);pending[1](['fresh']);await first;await new Promise(r=>setTimeout(r,0));assert.deepEqual(seen,[['fresh']]);
 const next=reader.refresh();reader.refresh();pending[2](['one']);await next;pending[3](['two']);await new Promise(r=>setTimeout(r,0));assert.deepEqual(seen,[['fresh'],['one'],['two']]);reader.stop();
});
test('shared loan retains its Firebase ID and exact paise while displaying lakhs without ATS requirements', () => {
  const row=toNirnayLoan(shared); assert.equal(row.id,'firebase-1'); assert.equal(row._sharedId,'shared-1'); assert.equal(row.amount,1.2345678); assert.equal(row._amountPaise,12345678); assert.equal(row.category,'Agriculture');
});
test('a linked Firebase row is displayed once and unrelated historic records remain', () => {
  const rows=mergeSharedLoans([{id:'firebase-1',category:'Agriculture',remarks:'Old'}, {id:'old-sanction',category:'Agriculture',status:'sanctioned'}, {id:'sme',category:'SME'}],[shared]);
  assert.equal(rows.length,3); assert.equal(rows.find(r=>r.id==='firebase-1').remarks,'Note');
  assert.equal(mergeSharedLoans([{id:'firebase-1'}],[{...shared,nirnay:{...shared.nirnay,archived:true}}]).length,0);
});
test('deletion from either app hides the shared row and its original Firebase copy',()=>{
 assert.equal(mergeSharedLoans([{id:'firebase-1'}],[{...shared,agriArchived:true}]).length,0);
 assert.equal(mergeSharedLoans([{id:'firebase-1'}],[{...shared,nirnay:{...shared.nirnay,archived:true}}]).length,0);
 assert.equal(mergeSharedLoans([{id:'firebase-1'}],[{...shared,agriArchived:false,nirnay:{...shared.nirnay,archived:false}}]).length,1);
});
test('opening and saving a displayed amount cannot round stored paise', () => {
  const row=toNirnayLoan(shared); assert.equal(amountPaiseForEdit(row,1.2345678),12345678); assert.equal(amountPaiseForEdit(row,2.5),25000000);
});
test('only pending fresh Agriculture is eligible for initial linking', () => {
  assert.equal(isEligibleFresh({category:'Agriculture',status:'pending'}),true);
  for(const row of [{category:'Agriculture',status:'sanctioned'},{category:'SME',status:'pending'},{category:'Agriculture',status:'pending',isFreshCC:false}])assert.equal(isEligibleFresh(row),false);
});
test('canonical returned status and decision dates override stale Nirnay metadata',()=>{
 const row=toNirnayLoan({...shared,status:'returned',returnedDate:'2026-10-22',returnReason:'Documents missing',sanctionDate:null,statusHistory:[{id:'event',toStatus:'returned'}]});
 assert.equal(row.status,'returned');assert.equal(row.returnedDate,'2026-10-22');assert.equal(row._returnReason,'Documents missing');assert.equal(row._statusHistory.length,1);
 assert.equal(mergeSharedLoans([{id:'firebase-1',status:'returned'}],[{...shared,status:'returned'}]).length,1);
});
test('return decisions honor a selected date and do not reuse a prior cycle by default',()=>{
 assert.equal(returnDateForDecision({status:'pending',returnedDate:'2026-10-01'},{returnedDate:'2026-10-22'},'2026-10-24'),'2026-10-22');
 assert.equal(returnDateForDecision({status:'pending',returnedDate:'2026-10-01'},{},'2026-10-24'),'2026-10-24');
});
