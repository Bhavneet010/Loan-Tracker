// Shared-service choices use explicit dialogs; borrower details are inserted as text.
export function sharedDialog({title,message,choices,password=false}) {
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='modal-box';dialog.style.cssText='max-width:480px;width:calc(100% - 32px);border:0;border-radius:18px;padding:24px;color:var(--text,#263044);background:var(--card,#fff)';
  const heading=document.createElement('h2');heading.textContent=title;dialog.append(heading);
  const copy=document.createElement('p');copy.textContent=message;copy.style.cssText='margin:12px 0;line-height:1.5';dialog.append(copy);
  let input;
  if(password){const label=document.createElement('label');label.textContent='Agri admin password';input=document.createElement('input');input.type='password';input.autocomplete='current-password';input.style.cssText='display:block;width:100%;padding:12px;margin:8px 0 16px;font-size:16px';label.append(input);dialog.append(label);}
  let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
  for(const choice of choices){const button=document.createElement('button');button.type='button';button.className='btn btn-outline';button.style.cssText='display:block;width:100%;margin-top:10px;padding:12px;white-space:normal';button.textContent=choice.label;button.onclick=()=>finish(password&&choice.value==='submit'?input.value:choice.value);dialog.append(button);}
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  document.body.append(dialog);dialog.showModal();input?.focus();
 });
}
export const selectSharedDuplicate=candidates=>sharedDialog({title:'Possible existing Agriculture application',message:'Select the existing application to link it. Choose a different application only when this is a separate loan.',choices:[...candidates.map(row=>({label:`Use existing: ${row.borrowerName} · ₹${(row.amountPaise/100).toLocaleString('en-IN')} · ${row.atsId||'ATS pending'} · ${row.status||'pending'}`,value:row.id})),{label:'This is a different application',value:'distinct'},{label:'Cancel',value:null}]});
export const askSharedPassword=()=>sharedDialog({title:'Connect shared decisions',message:'Use the existing Agri admin password to change shared status. Officer assignments remain specific to Nirnay.',password:true,choices:[{label:'Connect and save',value:'submit'},{label:'Cancel',value:null}]});
