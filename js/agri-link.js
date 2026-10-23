import { S } from './state.js';
import { amountPaiseForEdit,createSharedReader } from './agri-link-model.js';
import { askSharedPassword,selectSharedDuplicate } from './agri-link-dialog.js';
const base='/api/agri?route=';
export async function sharedRequest(path,method='GET',data,{authenticate=true,signal}={}) {
 let response;
 try {response=await fetch(base+encodeURIComponent(path),{method,headers:{...(method!=='GET'?{'content-type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}
 catch{throw new Error('Cannot reach the shared Agriculture workspace. Check your connection; the save is not confirmed.');}
 const result=await response.json().catch(()=>({error:'The shared service returned an unreadable response.'}));
 if(response.status===401&&authenticate&&method!=='GET'){
  const password=await askSharedPassword();if(password===null)throw new Error('Shared remark save cancelled.');
  await sharedRequest('/api/admin/session','POST',{password},{authenticate:false});
  return sharedRequest(path,method,data,{authenticate:false});
 }
 if(!response.ok){const error=new Error(result.error||'Unable to save shared Agriculture loan.');error.candidates=result.candidates;error.status=response.status;throw error;}
 return result;
}
let branches;
async function sharedBranch(branch){
 const code=(branch||'').match(/^\s*(\d+)/)?.[1];
 if(!branches)branches=await sharedRequest('/api/branches');
 const row=branches.find(b=>b.name.match(/^\s*(\d+)/)?.[1]===code);
 if(!row)throw new Error('This branch is not in the shared Agriculture workspace.');return row.id;
}
export async function createShared(data,requestId){
 const input={branchId:await sharedBranch(data.branch),borrowerName:data.customerName,amountPaise:amountPaiseForEdit(null,data.amount),requestId,author:S.user||'Nirnay user',remarks:data.remarks||'',nirnayData:{...data}};
 for(;;){
  try{return await sharedRequest('/api/linkage/loans','POST',input);}
  catch(error){if(!error.candidates)throw error;const choice=await selectSharedDuplicate(error.candidates);if(!choice)throw new Error('Application save cancelled.');if(choice.startsWith('nirnay:')){input.nirnayMatchId=choice.slice(7);delete input.allowDistinct;}else if(choice==='distinct'){input.allowDistinct=true;delete input.linkExistingId;delete input.nirnayMatchId;}else{input.linkExistingId=choice;delete input.allowDistinct;}}
 }
}
export async function updateShared(loan,data,extra={}){
 const requestId=extra.requestId||crypto.randomUUID();
 if(data.status==='returned'&&loan.status!=='returned')data={...data,returnReason:(data.remarks||'').trim()};
 const payload={version:loan._sharedVersion,nirnayVersion:loan._nirnayVersion,data:{...data},requestId,author:S.user||'Nirnay user',...(extra.archived!==undefined?{archived:extra.archived}:{})};
 if(data.amount!==undefined)payload.data.amount=amountPaiseForEdit(loan,data.amount)/10000000;
 return sharedRequest('/api/linkage/loans/'+encodeURIComponent(loan._sharedId),'PATCH',payload);
}
export function watchShared(changed,failed){
 let stopped=false,timer,channel,client,debounce;
 const reader=createSharedReader(signal=>sharedRequest('/api/linkage/loans','GET',undefined,{signal}),changed,failed);
 const refresh=reader.refresh;
 void refresh();
 timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);
 const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);
 // The Supabase SDK is loaded only for shared Agriculture updates; failed subscriptions retain polling.
 void import('https://esm.sh/@supabase/supabase-js@2.118.0').then(async({createClient})=>{
  if(stopped)return;const {SHARED_URL,SHARED_KEY}=await import('./agri-public-config.js');if(stopped)return;
  client=createClient(SHARED_URL,SHARED_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  channel=client.channel('nirnay-agriculture').on('postgres_changes',{event:'UPDATE',schema:'public',table:'amcc_changes'},()=>{clearTimeout(debounce);debounce=setTimeout(()=>void refresh(),150);}).subscribe(status=>{if(status==='SUBSCRIBED')void refresh();});
 }).catch(()=>{});
 return {refresh,invalidate:reader.invalidate,stop(){stopped=true;reader.stop();clearInterval(timer);clearTimeout(debounce);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);if(client&&channel)void client.removeChannel(channel);}};
}
