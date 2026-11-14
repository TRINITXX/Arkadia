/**
 * The choice kit of the chat's visuals (Alexis, 13/11/2026): a page that
 * offers options writes plain markup (`ark-choice`, `ark-question`,
 * `ark-option`…, in the tool's description) and this kit draws it the one
 * way he validated: cards whose choice shows by its orange frame alone, the
 * advice (« Conseillé ») on the card's top edge, out of the text's way, bold
 * figures and letters, one tab card per group of questions, « Valider mes
 * choix » at the bottom right. Every session's choices look the same.
 * Under each question, a field for a remark on it, always shown, sent in
 * that question's line when filled (Alexis, 14/11/2026).
 *
 * A picture in an option (a mockup) takes its card's width, up to its own
 * size: it drops the cap that fits media to the pane's height, and a max-width
 * the page's CSS gives it, which together left a phone screenshot a third of
 * its card wide (Alexis, 13/11/2026). One with a width, height or style
 * attribute stays as the page sized it.
 *
 * Added to a page only when it uses the kit (`usesChoiceKit`). The kit moves
 * the page's own nodes into its cards, never re-parses their text, and keeps
 * whatever it has no slot for where the page put it.
 */

/** The page uses the kit: an element of class `ark-choice`. */
export function usesChoiceKit(html: string): boolean {
  return /class\s*=\s*["'][^"']*\bark-choice\b/i.test(html);
}

/** Inter from a CDN the visual's CSP allows: a font that fails falls back, silently. */
const INTER =
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.2.6/files/";

export const VISUAL_KIT_CSS = `
@font-face{font-family:"Inter Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(${INTER}inter-latin-ext-wght-normal.woff2) format("woff2-variations");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Inter Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(${INTER}inter-latin-wght-normal.woff2) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
.ark-choice{--ark-ease:cubic-bezier(.23,1,.32,1);--ark-ring:inset 0 0 0 1px var(--border);--ark-mark:color-mix(in srgb,var(--faint) 55%,var(--card));--ark-read:color-mix(in srgb,var(--text) 90%,var(--card));font-family:"Inter Variable",var(--font-sans)}
.ark-choice button{-webkit-user-select:none;user-select:none;font:inherit}
.ark-choice button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.ark-nomo *{transition:none!important}
.ark-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:10px}
.ark-step{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 18px 15px;border-radius:14px;background:var(--card);box-shadow:var(--ark-ring);color:var(--muted);transition:background-color .15s var(--ark-ease),box-shadow .15s var(--ark-ease),transform .16s var(--ark-ease)}
.ark-step:active{transform:scale(.985)}
.ark-step .ark-nm{flex:1;min-width:0}
.ark-step .ark-nm b{display:block;font-size:16.5px;font-weight:650;letter-spacing:-.01em;color:inherit}
.ark-step .ark-nm span{display:block;font-size:13px;color:var(--faint);margin-top:1px}
.ark-code{font-size:13px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--faint);white-space:nowrap}
.ark-todo{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--accent);white-space:nowrap}
.ark-todo::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent)}
.ark-step[aria-selected=true]{background:var(--card-2);color:var(--text);box-shadow:inset 0 0 0 1px var(--border-strong),inset 0 -3px 0 var(--accent)}
.ark-step[aria-selected=true] .ark-code{color:var(--muted)}
.ark-for{margin:14px 0 0;font-size:14px;color:var(--muted)}
.ark-for.ark-alone{margin:0 0 18px}
.ark-pane{padding-top:22px}
.ark-pane[hidden]{display:none}
.ark-sec{margin-bottom:24px}
.ark-sh{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.ark-sh b{font-size:15px;font-weight:600}
.ark-sh span{font-size:13.5px;color:var(--faint)}
.ark-qx{font-size:14.5px;line-height:1.55;color:var(--muted);margin:-4px 0 12px}
.ark-qx>:first-child{margin-top:0}.ark-qx>:last-child{margin-bottom:0}
.ark-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:20px 12px;padding-top:6px}
.ark-grid.ark-long{grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr))}
.ark-opt{all:unset;box-sizing:border-box;cursor:pointer;position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;background:var(--card);border-radius:14px;padding:16px 18px 18px;box-shadow:var(--ark-ring);transition:box-shadow .15s var(--ark-ease),background-color .15s var(--ark-ease),transform .16s var(--ark-ease)}
.ark-opt:active{transform:scale(.985)}
.ark-opt[aria-checked=true]{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,transparent),transparent 90px),var(--card);box-shadow:inset 0 0 0 2px var(--accent)}
@media (hover:hover) and (pointer:fine){
.ark-opt:not([aria-checked=true]):hover,.ark-step:not([aria-selected=true]):hover{background:var(--card-2);box-shadow:inset 0 0 0 1px var(--border-strong)}
.ark-step:hover{color:var(--text)}
.ark-cta:hover{filter:brightness(1.07)}
.ark-next:hover,.ark-rmt:not(:focus):hover{box-shadow:inset 0 0 0 1px var(--border-strong)}
.ark-next:hover{color:var(--text)}}
.ark-mk{flex-shrink:0;align-self:flex-start;font-size:24px;font-weight:750;line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums;color:var(--ark-mark);transition:color .15s var(--ark-ease)}
.ark-th .ark-mk{font-size:20px}
.ark-opt[aria-checked=true] .ark-mk{color:var(--accent)}
.ark-st{font-size:15.5px;line-height:1.4;font-weight:500;color:var(--text);text-wrap:pretty}
.ark-th{display:flex;align-items:center;gap:10px}
.ark-th b{font-size:15.5px;font-weight:600;line-height:1.3;letter-spacing:-.005em}
.ark-d{font-size:13px;color:var(--faint);line-height:1.4;margin-top:-4px}
.ark-body{border-top:1px solid var(--border);padding-top:12px;font-size:15px;line-height:1.6;color:var(--ark-read);text-wrap:pretty;min-width:0}
.ark-body>:first-child{margin-top:0}.ark-body>:last-child{margin-bottom:0}
.ark-body p{margin:0 0 9px}
.ark-opt :where(img,video):not([width]):not([height]):not([style]){max-width:100%;max-height:none}
:where(.ark-opt :is(img,video):not([width]):not([height]):not([style])){display:block;margin-inline:auto}
.ark-reco{position:absolute;top:-10px;right:16px;font-size:11.5px;font-weight:600;letter-spacing:.02em;line-height:18px;color:var(--accent);background:var(--bg);border:1px solid color-mix(in srgb,var(--accent) 50%,transparent);border-radius:999px;padding:0 9px;pointer-events:none}
.ark-rm{position:relative;margin-top:14px}
.ark-rm svg{position:absolute;left:15px;top:15px;width:16px;height:16px;color:var(--faint);pointer-events:none;transition:color .15s var(--ark-ease)}
.ark-rm:focus-within svg{color:var(--muted)}
.ark-rmt{display:block;width:100%;box-sizing:border-box;min-height:46px;margin:0;padding:12px 16px 12px 42px;resize:none;overflow:hidden;border:0;outline:0;border-radius:12px;font:inherit;font-size:15px;line-height:1.45;color:var(--text);background:transparent;box-shadow:var(--ark-ring);transition:box-shadow .15s var(--ark-ease),background-color .15s var(--ark-ease)}
.ark-rmt::placeholder{color:var(--faint);opacity:1}
@media (pointer:coarse){.ark-rmt{font-size:16px}}
.ark-rmt:focus{background:var(--card);box-shadow:inset 0 0 0 1px var(--border-strong)}
.ark-note{font-size:15px;line-height:1.55;color:var(--muted);text-wrap:pretty;background:var(--card);border-radius:14px;padding:14px 18px;box-shadow:var(--ark-ring)}
.ark-note>:first-child{margin-top:0}.ark-note>:last-child{margin-bottom:0}
.ark-prev{background:var(--card);border-radius:12px;padding:12px 16px;box-shadow:var(--ark-ring);min-width:0;font-size:14.5px}
.ark-mail{display:flex;align-items:center;gap:14px;min-width:0}
.ark-mail::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--info);flex-shrink:0}
.ark-mail>b:first-child{font-weight:700;flex-shrink:0;min-width:120px}
.ark-mail>span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--faint)}
.ark-mail>span b{font-weight:700;color:var(--text)}
.ark-foot{display:flex;align-items:center;gap:12px 16px;border-top:1px solid var(--border);padding-top:16px;flex-wrap:wrap}
.ark-next{all:unset;cursor:pointer;font-size:14px;font-weight:600;color:var(--muted);border-radius:999px;padding:10px 18px;box-shadow:var(--ark-ring)}
.ark-next[hidden]{display:none}
.ark-left{font-size:13px;color:var(--accent);margin-left:auto}
.ark-left:empty{display:none}
.ark-cta{all:unset;cursor:pointer;margin-left:auto;display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:var(--accent-text);font-weight:650;font-size:14.5px;padding:11px 24px;border-radius:999px;transition:transform .16s var(--ark-ease),filter .15s var(--ark-ease)}
.ark-left:not(:empty)+.ark-cta{margin-left:0}
.ark-cta:active{transform:scale(.97)}
.ark-cta svg{width:16px;height:16px}
@media (prefers-reduced-motion:reduce){.ark-opt:active,.ark-step:active,.ark-cta:active{transform:none}}
`;

/**
 * The kit's script: reads each `.ark-choice` once the page is parsed, moves
 * its nodes into the cards, then only flips states (choice, tab, previews).
 * Sends with `arkadia.choose` (the bootstrap's), one line per group, and
 * says « Ajouté » only when the Lab answers that it went in
 * (`arkadia-chosen`).
 */
export const VISUAL_KIT_JS = `(function(){
var SVG="http://www.w3.org/2000/svg",BLOCK=/^(P|DIV|LI|UL|OL|H[1-6]|BR|TR|TD|SECTION|BLOCKQUOTE|PRE)$/;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function at(n,k){var v=n.getAttribute(k);return v==null?"":v.trim();}
function words(n){var s="";Array.prototype.forEach.call(n.childNodes,function(c){if(c.nodeType===3)s+=c.data;else if(c.nodeType===1){var b=BLOCK.test(c.tagName);s+=(b?" ":"")+words(c)+(b?" ":"");}});return s;}
function txt(n){return words(n).replace(/\\s+/g," ").trim();}
function cap(s,n){return s.length>n?s.slice(0,n-1)+"\\u2026":s;}
function low(s){return !s||/^[A-Z0-9]{2}/.test(s)?s:s.charAt(0).toLowerCase()+s.slice(1);}
function has(n,c){return n.nodeType===1&&n.classList.contains(c);}
function blank(n){return n.nodeType===8||(n.nodeType===3&&!n.data.trim());}
function nodes(n){return Array.prototype.slice.call(n.childNodes);}
function moveAll(from,to){while(from.firstChild)to.appendChild(from.firstChild);}
function same(a,b){return a.trim().toLowerCase()===b.trim().toLowerCase();}
function head(title,sub){var h=el("div","ark-sh");if(title)h.appendChild(el("b",null,title));if(sub)h.appendChild(el("span",null,sub));return h;}
function check(){var s=document.createElementNS(SVG,"svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("fill","none");s.setAttribute("stroke","currentColor");s.setAttribute("stroke-width","2.6");s.setAttribute("stroke-linecap","round");s.setAttribute("stroke-linejoin","round");var p=document.createElementNS(SVG,"path");p.setAttribute("d","M5 12.5l4.5 4.5L19 7.5");s.appendChild(p);return s;}
function bubble(){var s=document.createElementNS(SVG,"svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("fill","none");s.setAttribute("stroke","currentColor");s.setAttribute("stroke-width","2");s.setAttribute("stroke-linecap","round");s.setAttribute("stroke-linejoin","round");var p=document.createElementNS(SVG,"path");p.setAttribute("d","M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");s.appendChild(p);return s;}
function grow(t){if(!t.offsetParent)return;t.style.height="auto";t.style.height=t.scrollHeight+"px";}
function mark(kind,i){return kind==="letter"?String.fromCharCode(65+i):(i<9?"0":"")+(i+1);}
function group(src){return {title:src?at(src,"data-title"):"",sub:src?at(src,"data-sub"):"",forLine:src?at(src,"data-for"):"",blocks:[],qs:[],previews:[],seen:false};}
function question(c,G){
 var kind=at(c,"data-mark")||(G.qs.length===1?"letter":"num");
 var Q={kind:"q",title:at(c,"data-title"),sub:at(c,"data-sub"),multi:c.hasAttribute("data-multi"),mark:kind,opts:[],extra:[]};
 (function keep(w){nodes(w).forEach(function(n){if(blank(n)||has(n,"ark-option"))return;if(n.nodeType===1&&n.querySelector(".ark-option"))keep(n);else Q.extra.push(n);});})(c);
 Array.prototype.filter.call(c.querySelectorAll(".ark-option"),function(o){return o.parentNode.closest(".ark-question")===c;}).forEach(function(o,i){
  var long=o.hasAttribute("data-title"),label=long?at(o,"data-title"):txt(o);
  Q.opts.push({src:o,long:long,label:label,sub:at(o,"data-sub"),reco:o.hasAttribute("data-reco"),mk:mark(kind,i),preview:o.hasAttribute("data-preview")?at(o,"data-preview"):txt(o),len:txt(o).length,on:o.hasAttribute("data-reco")});
 });
 if(!Q.multi){var one=false;Q.opts.forEach(function(o){if(o.on&&one)o.on=false;if(o.on)one=true;});}
 G.qs.push(Q);return Q;
}
function block(n,G,questions){
 if(questions&&has(n,"ark-question"))return question(n,G);
 if(has(n,"ark-note"))return {kind:"note",title:at(n,"data-title"),sub:at(n,"data-sub"),src:n};
 if(has(n,"ark-preview")){var P={kind:"preview",title:at(n,"data-title"),sub:at(n,"data-sub"),src:n,group:G};G.previews.push(P);return P;}
 return {kind:"other",src:n};
}
function mount(root){
 if(root.getAttribute("data-ark-ready"))return;root.setAttribute("data-ark-ready","1");
 var all=nodes(root).filter(function(n){return !blank(n);}),flat=!all.some(function(n){return has(n,"ark-group");});
 var groups=[],shared=group(null),top=[],bottom=[],cur=0,waitTimer=null,idleTimer=null,waiting=false;
 if(flat){var F=group(null);F.forLine=at(root,"data-for");all.forEach(function(n){F.blocks.push(block(n,F,true));});groups.push(F);}
 else all.forEach(function(n){
  if(has(n,"ark-group")){var G=group(n);nodes(n).forEach(function(c){if(!blank(c))G.blocks.push(block(c,G,true));});groups.push(G);}
  else (groups.length?bottom:top).push(block(n,shared,false));
 });
 shared.previews.forEach(function(P){P.group=null;});
 groups[0].seen=true;
 var intro=at(root,"data-intro")||"Mes choix",sendLabel=at(root,"data-send")||"Valider mes choix";
 // Text sized by its length; images, drawings or fixed widths keep the frame's width.
 if(!root.querySelector("img,svg,canvas,video,picture,[style*=width]"))root.style.maxWidth=Math.ceil(width())+"px";
 function width(){
  var w=flat?420:Math.max(520,groups.length*230+(groups.length-1)*10);
  groups.forEach(function(G){G.qs.forEach(function(Q){
   var long=Q.opts.some(function(o){return o.long;}),n=Math.max(1,Math.min(Q.opts.length,long?3:4)),c=0;
   Q.opts.forEach(function(o){var t=o.long?Math.max(66+o.label.length*8.6,220+o.len*0.6):36+o.label.length*8.2;if(t>c)c=t;});
   c=long?Math.max(280,Math.min(440,c)):Math.max(170,Math.min(300,c));
   w=Math.max(w,n*c+(n-1)*12);
  });});
  return w;
 }
 function render(B){
  if(B.kind==="other")return B.src;
  var sec=el("section","ark-sec");sec.appendChild(head(B.title,B.sub));
  if(B.kind==="note"){var n=el("div","ark-note");moveAll(B.src,n);sec.appendChild(n);}
  else if(B.kind==="preview"){var pv=el("div","ark-prev");moveAll(B.src,pv);B.box=pv;sec.appendChild(pv);}
  else{
   if(B.extra.length){var x=el("div","ark-qx");B.extra.forEach(function(e){x.appendChild(e);});sec.appendChild(x);}
   var grid=el("div","ark-grid"+(B.opts.some(function(o){return o.long;})?" ark-long":""));
   grid.setAttribute("role",B.multi?"group":"radiogroup");if(B.title)grid.setAttribute("aria-label",B.title);
   B.opts.forEach(function(o){
    var b=el("button","ark-opt");b.type="button";b.setAttribute("role",B.multi?"checkbox":"radio");
    if(o.src.id)b.id=o.src.id;
    if(o.reco)b.appendChild(el("span","ark-reco","Conseill\\u00e9"));
    if(o.long){var th=el("span","ark-th");th.appendChild(el("span","ark-mk",o.mk));th.appendChild(el("b",null,o.label));b.appendChild(th);
     if(o.sub)b.appendChild(el("span","ark-d",o.sub));var body=el("div","ark-body");moveAll(o.src,body);if(body.firstChild)b.appendChild(body);}
    else{b.appendChild(el("span","ark-mk",o.mk));var st=el("span","ark-st");moveAll(o.src,st);b.appendChild(st);}
    b.addEventListener("click",function(){pick(B,o);});o.btn=b;grid.appendChild(b);
   });
   sec.appendChild(grid);
   var rm=el("div","ark-rm"),ta=el("textarea","ark-rmt");ta.rows=1;ta.maxLength=500;ta.placeholder="Une remarque sur ce choix ?";ta.setAttribute("aria-label",B.title?"Remarque sur "+low(B.title):"Remarque");
   ta.addEventListener("input",function(){grow(ta);});rm.appendChild(bubble());rm.appendChild(ta);B.remark=ta;sec.appendChild(rm);
  }
  return sec;
 }
 var out=document.createDocumentFragment();
 top.forEach(function(B){out.appendChild(render(B));});
 if(!flat){var steps=el("div","ark-steps");steps.setAttribute("role","tablist");out.appendChild(steps);
  groups.forEach(function(G,gi){var b=el("button","ark-step");b.type="button";b.setAttribute("role","tab");b.title="Fl\\u00e8ches gauche et droite";
   var nm=el("span","ark-nm");nm.appendChild(el("b",null,G.title));if(G.sub)nm.appendChild(el("span",null,G.sub));b.appendChild(nm);
   G.state=el("span");b.appendChild(G.state);b.addEventListener("click",function(){go(gi);});G.tab=b;steps.appendChild(b);});}
 groups.forEach(function(G){if(G.forLine)out.appendChild(G.forP=el("p",flat?"ark-for ark-alone":"ark-for",G.forLine));});
 groups.forEach(function(G){var pane=el("div",flat?"":"ark-pane");if(!flat)pane.setAttribute("role","tabpanel");G.blocks.forEach(function(B){pane.appendChild(render(B));});G.pane=pane;out.appendChild(pane);});
 bottom.forEach(function(B){out.appendChild(render(B));});
 var foot=el("div","ark-foot"),next=el("button","ark-next"),left=el("span","ark-left"),cta=el("button","ark-cta");
 next.type="button";cta.type="button";
 if(!flat)foot.appendChild(next);foot.appendChild(left);foot.appendChild(cta);out.appendChild(foot);
 root.textContent="";root.appendChild(out);
 function pick(Q,o){if(Q.multi)o.on=!o.on;else Q.opts.forEach(function(x){x.on=x===o;});draw();}
 function go(i){cur=i;groups[i].seen=true;draw();}
 function chosen(Q){return Q.opts.filter(function(o){return o.on;});}
 function code(G){return G.qs.map(function(Q){var c=chosen(Q);return c.length?c.map(function(o){return o.mk;}).join("+"):"\\u2013";}).join(" ");}
 function find(want,G){var order=[G||groups[cur]].concat(groups);for(var i=0;i<order.length;i++){var q=order[i].qs.filter(function(q){return same(q.title,want);})[0];if(q)return q;}return null;}
 function fill(P){Array.prototype.forEach.call(P.box.querySelectorAll("[data-from]"),function(n){var Q=find(n.getAttribute("data-from")||"",P.group);if(Q)n.textContent=chosen(Q).map(function(o){return o.preview;}).join(", ");});}
 function idle(){cta.textContent=sendLabel;}
 // A remark keeps its height right when the pane's width changes or its tab shows again.
 function regrow(){groups.forEach(function(G){G.qs.forEach(function(Q){if(Q.remark&&Q.remark.value)grow(Q.remark);});});}
 function draw(){
  groups.forEach(function(G,gi){
   var on=gi===cur;
   if(!flat){G.tab.setAttribute("aria-selected",on?"true":"false");G.pane.hidden=!on;if(G.forP)G.forP.hidden=!on;
    G.state.className=G.seen?"ark-code":"ark-todo";G.state.textContent=G.seen?(G.qs.length?code(G):"Vu"):"\\u00c0 voir";}
   G.qs.forEach(function(Q){Q.opts.forEach(function(o){o.btn.setAttribute("aria-checked",o.on?"true":"false");});});
   G.previews.forEach(fill);
  });
  shared.previews.forEach(fill);
  regrow();
  if(!flat){var last=cur>=groups.length-1;next.hidden=last;if(!last)next.textContent="Liste suivante : "+groups[cur+1].title+"  \\u2192";
   var un=groups.filter(function(G){return !G.seen;}).map(function(G){return G.title;});
   left.textContent=un.length?(un.length===1?un[0]+" pas encore vue":un.slice(0,-1).join(", ")+" et "+un[un.length-1]+" pas encore vues"):"";}
 }
 function summary(){
  var lines=[intro+" :"];
  groups.forEach(function(G){
   var parts=G.qs.map(function(Q){var c=chosen(Q).map(function(o){return "\\u00ab "+cap(o.label,160)+" \\u00bb";});var a=c.length?c.join(", "):"aucun choix",r=Q.remark?Q.remark.value.replace(/\\s+/g," ").trim():"";if(r)a+=" (remarque : "+r+")";return flat?(Q.title?Q.title+" : "+a:a):(Q.title?low(Q.title)+" "+a:a);});
   if(!parts.length)return;
   if(flat)lines.push.apply(lines,parts);else lines.push(G.title+" : "+parts.join(", "));
  });
  return lines.join("\\n");
 }
 next.addEventListener("click",function(){if(cur<groups.length-1)go(cur+1);});
 cta.addEventListener("click",function(){
  if(!window.arkadia||!window.arkadia.choose)return;
  window.arkadia.choose(summary());
  clearTimeout(idleTimer);idle();
  waiting=true;clearTimeout(waitTimer);waitTimer=setTimeout(function(){waiting=false;},2000);
 });
 window.addEventListener("arkadia-chosen",function(){
  if(!waiting)return;waiting=false;clearTimeout(waitTimer);
  cta.textContent="";cta.appendChild(check());cta.appendChild(el("span",null,"Ajout\\u00e9 \\u00e0 ton message"));
  clearTimeout(idleTimer);idleTimer=setTimeout(idle,2500);
 });
 root.addEventListener("ark-key",function(e){
  var k=e.detail,G=groups[cur],hit=true;
  if(k==="ArrowRight"&&!flat)go((cur+1)%groups.length);
  else if(k==="ArrowLeft"&&!flat)go((cur+groups.length-1)%groups.length);
  else{var kind=/^[1-9]$/.test(k)?"num":/^[A-Z]$/.test(k)?"letter":"",Q=kind?G.qs.filter(function(q){return q.mark===kind;})[0]:null;
   var i=kind==="num"?+k-1:k.charCodeAt(0)-65;if(Q&&Q.opts[i])pick(Q,Q.opts[i]);else hit=false;}
  if(hit){root.classList.add("ark-nomo");requestAnimationFrame(function(){requestAnimationFrame(function(){root.classList.remove("ark-nomo");});});}
 });
 window.addEventListener("resize",regrow);
 idle();draw();
}
function start(){var all=document.querySelectorAll(".ark-choice");for(var i=0;i<all.length;i++)mount(all[i]);}
document.addEventListener("keydown",function(e){
 if(e.ctrlKey||e.metaKey||e.altKey||e.defaultPrevented)return;
 var t=e.target;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;
 var roots=document.querySelectorAll(".ark-choice[data-ark-ready]");if(roots.length!==1)return;
 var k=e.key.length===1?e.key.toUpperCase():e.key;if(!/^([1-9A-Z]|ArrowLeft|ArrowRight)$/.test(k))return;
 roots[0].dispatchEvent(new CustomEvent("ark-key",{detail:k}));
});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();`;
