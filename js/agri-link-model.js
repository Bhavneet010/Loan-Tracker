export const isEligibleFresh = loan => loan.category === 'Agriculture' && loan.status === 'pending' && loan.isFreshCC !== false;
export function sharedEditBase(current,draft){if(current?._sharedId&&draft&&!draft._sharedId)throw new Error('Shared record has finished loading. Reopen this editor before saving.');return draft?._sharedId?draft:current;}
export function assertLinkageResolved(loan,resolved){if(!resolved&&loan?.category==='Agriculture')throw new Error('Shared Agriculture records are still loading. Please retry after synchronization.');}
// A read started before an accepted mutation must never replace that mutation.
export function createSharedReader(read,changed,failed){
 let stopped=false,generation=0,active=null,queued=false;
 async function refresh(){
  if(stopped)return;if(active){queued=true;return;}
  const token=++generation,controller=new AbortController();active=controller;
  try{const rows=await read(controller.signal);if(!stopped&&token===generation)changed(rows);}
  catch(error){if(!stopped&&token===generation)failed(error);}
  finally{if(token===generation){active=null;if(queued){queued=false;void refresh();}}}
 }
 return {refresh,invalidate(){generation++;active?.abort();active=null;queued=false;void refresh();},stop(){stopped=true;generation++;active?.abort();}};
}
export function toNirnayLoan(shared) {
  const local = shared.nirnay || { data: {}, version: 0, archived: false };
  const data = local.data || {};
  return { ...data, id: local.firebaseId || `agri_${shared.id}`, category: 'Agriculture', branch: shared.branchName.replace(/\s*·\s*/, ' : '), customerName: shared.borrowerName, amount: shared.amountPaise / 10000000, remarks: shared.remarks || '', receiveDate: data.receiveDate || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date(shared.createdAt)), status: shared.status || data.status || 'pending', returnedDate:shared.returnedDate||'', sanctionDate:shared.sanctionDate||data.sanctionDate||'', _returnReason:shared.returnReason||'', _statusHistory:shared.statusHistory||[], createdAt: shared.createdAt, _sharedId: shared.id, _sharedVersion: shared.version, _nirnayVersion: local.version || 0, _amountPaise: shared.amountPaise, _atsId: shared.atsId || '', _sharedHistory: shared.remarkHistory || [], _archived: !!local.archived };
}
export function mergeSharedLoans(firebaseRows, sharedRows) {
  const linked = new Set(sharedRows.map(row => row.nirnay?.firebaseId).filter(Boolean));
  return [...firebaseRows.filter(row => !linked.has(row.id)), ...sharedRows.map(toNirnayLoan).filter(row => !row._archived)].sort((a,b) => (b.receiveDate || '').localeCompare(a.receiveDate || ''));
}
export function amountPaiseForEdit(loan, amountLakhs) {
  if (loan?._amountPaise && Number(amountLakhs) === Number(loan.amount)) return loan._amountPaise;
  const paise = Math.round(Number(amountLakhs) * 10000000);
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new Error('Enter a valid positive amount.');
  return paise;
}

export const returnDateForDecision=(loan,draft,today)=>draft.returnedDate||(loan.status==='returned'?loan.returnedDate:'')||today;
