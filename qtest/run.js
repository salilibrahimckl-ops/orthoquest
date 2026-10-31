const {chromium}=require('playwright');const fs=require('fs');
const SRC=fs.readFileSync(__dirname+'/source.txt','utf8');
(async()=>{const b=await chromium.launch();const p=await b.newPage();p.on('pageerror',x=>console.log('PE',x.message));
 await p.route(/^https:\/\/(?!localhost)/,r=>r.fulfill({status:404,body:''}));
 await p.goto('file://'+__dirname+'/app.html');await p.waitForTimeout(800);
 const out={};
 for(const exam of ['INI-SS','NEET-SS']){
  out[exam]=await p.evaluate(async([s,exam])=>{GEN.engine='device';GEN.n=6;GEN.exam=exam;
   ODS.w={createChatCompletion:async(o)=>{const r=await fetch('http://localhost:8080/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:o.messages,max_tokens:o.max_tokens,temperature:o.temperature,response_format:o.response_format})});const j=await r.json();const t=j.choices[0].message.content;o.onData({choices:[{delta:{content:t}}]})}};
   const t0=Date.now();try{const q=await genDevice(s,new AbortController().signal);return {ms:Date.now()-t0,q}}catch(e){return {err:JSON.stringify(e)}}},[SRC,exam]);
 }
 fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1));await b.close()})();
