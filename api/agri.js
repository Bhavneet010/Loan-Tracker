// Only the public application key is used here. Administrative access uses an HttpOnly signed session.
const { SHARED_URL,SHARED_KEY,SHARED_REGION }=require('../server/agri-config.cjs');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const route=Array.isArray(req.query?.route)?'':req.query?.route;
 if(typeof route!=='string'||!/^\/api\/(branches|admin\/session|linkage\/loans(?:\/[^/?]+)?)$/.test(route)){res.statusCode=404;return res.end(JSON.stringify({error:'Not found.'}));}
 if(!['GET','POST','PATCH','DELETE'].includes(req.method)){res.statusCode=405;return res.end(JSON.stringify({error:'Method not allowed.'}));}
 const host=req.headers.host;
 const protocol=host?.startsWith('localhost')||host?.startsWith('127.0.0.1')?'http':'https';
 if(req.method!=='GET'&&req.headers.origin!==`${protocol}://${host}`){res.statusCode=403;return res.end(JSON.stringify({error:'Request origin is not allowed.'}));}
 const headers={apikey:SHARED_KEY,'x-region':SHARED_REGION,'content-type':'application/json',...(req.headers.cookie?{cookie:req.headers.cookie}:{})};
 if(req.method!=='GET')headers.origin=SHARED_URL;
 try{
  let body=req.body;
  if(req.method!=='GET'&&body===undefined){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192){res.statusCode=413;return res.end(JSON.stringify({error:'Request is too large.'}));}chunks.push(chunk);}body=Buffer.concat(chunks).toString('utf8');}
  if(body&&typeof body!=='string')body=JSON.stringify(body);
  if(body&&Buffer.byteLength(body)>8192){res.statusCode=413;return res.end(JSON.stringify({error:'Request is too large.'}));}
  const upstream=await fetch(SHARED_URL+'/functions/v1/amcc-api'+route,{method:req.method,headers,...(req.method==='GET'?{}:{body}),signal:AbortSignal.timeout(15000),redirect:'manual'});
  res.statusCode=upstream.status;res.setHeader('Content-Type','application/json');const cookies=upstream.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
  const text=await upstream.text();if(!upstream.headers.get('content-type')?.includes('application/json')){res.statusCode=502;return res.end(JSON.stringify({error:'Shared Agriculture service is temporarily unavailable.'}));}return res.end(text);
 }catch{res.statusCode=503;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:'Shared Agriculture service is unavailable. Please try again.'}));}
};
