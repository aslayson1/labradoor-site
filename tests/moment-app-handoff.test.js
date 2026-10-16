const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html','utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8,html.lastIndexOf('</script>'));
const owner = '13a57885-8709-44d8-9de1-b3d0d4b4f167';
const post = '3a7c45e2-b48b-4f20-9b40-1b30d8f1cf53';
const token = `v1.${owner}.${post}.${'A'.repeat(43)}`;

function run(query){
  const store=new Map();
  const anchors=[
    { href:'https://app.labradoor.ai/auth' },
    { href:'https://apps.apple.com/us/app/labradoor/id6795967598' },
    { href:'https://www.labradoor.ai/business' },
  ];
  const appended=[];
  const hero={appendChild(x){appended.push(x)}};
  const document={
    querySelector(selector){return selector==='.hero-cta'?hero:null},
    getElementById(id){return appended.find(x=>x.id===id)||null},
    createElement(tag){return {tag,style:{},setAttribute(name,value){this[name]=value}}},
    querySelectorAll(){return anchors},
  };
  const window={
    location:{origin:'https://www.labradoor.ai',search:query},
    sessionStorage:{
      setItem:(key,value)=>store.set(key,value),
      getItem:key=>store.get(key)||null,
      removeItem:key=>store.delete(key),
    },
  };
  vm.runInNewContext(script,{document,window,URL,URLSearchParams,Date,encodeURIComponent},
    {timeout:1000});
  return {anchors,appended,store};
}
test('referral landing retains signed campaign in Business and creates explicit installed-app handoff',()=>{
 const view=run('?mref='+encodeURIComponent(token))
 assert.equal(view.appended.length,1)
 assert.equal(view.appended[0].href,'labradoor://open?mref='+encodeURIComponent(token))
 assert.equal(view.appended[0].textContent,'Already have Labradoor? Open app')
 assert.equal(new URL(view.anchors[0].href).searchParams.get('mref'),token)
 assert.equal(new URL(view.anchors[2].href).searchParams.get('mref'),token)
 assert.equal(view.anchors[1].href,'https://apps.apple.com/us/app/labradoor/id6795967598')
});
test('badly formatted referral does not add a misleading app CTA',()=>{
 const view=run('?mref=not-a-signed-campaign')
 assert.equal(view.appended.length,0)
 assert.equal(new URL(view.anchors[0].href).searchParams.has('mref'),false)
});
