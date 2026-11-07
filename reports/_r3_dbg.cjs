const fs=require('fs'); const acorn=require('acorn');
const base='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js=fs.readFileSync(base+'compact-app-pc.f32c58b63b6f4273a8a4.js','latin1');
function scan(openAt, maxTok){
  const sub=js.slice(openAt); const tok=acorn.tokenizer(sub,{ecmaVersion:2022});
  let depth=0,n=0;
  for(;;){ let t; try{t=tok.getToken();}catch(e){return {err:e.message,at:tok.pos,tokens:n};}
    n++; if(t.type.label==='eof') return {eof:true,tokens:n};
    if(t.type.label==='{')depth++; else if(t.type.label==='}'){depth--; if(depth===0) return {end:openAt+t.start,len:t.start,tokens:n};}
    if(n>=maxTok) return {limit:true,tokens:n,depth}; }
}
for (const [k,openAt] of [['Zao8',12273577],['Fuol',5458194],['GQ8g',5553773]]){
  const r=scan(openAt, 20000000);
  console.log(k, JSON.stringify({...r, at:r.at, tokens:r.tokens}));
}
// chat-message early occurrence context
console.log('\n@987109 ctx:', JSON.stringify(js.slice(984000,988600).slice(-500)));
