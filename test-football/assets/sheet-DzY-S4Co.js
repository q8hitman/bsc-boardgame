import{ao as b,ap as k,aq as S,ar as L,A as y,aj as q,as as f,G as i,J as l,at as w,e as E,an as A,ad as j}from"./index-hXO-UTUS.js";const g=14;let d=s=>void j(s);const M=s=>{d=s};let r=null;const N=s=>{r=s;const e=document.querySelector("#acctAuth");e&&s(e)};let t=null,u=null;function C(s){var e;u=s??null,t||(t=document.createElement("div"),t.className="asheet hidden",t.id="asheet",document.body.appendChild(t),t.addEventListener("click",n=>n.target===t&&p()),addEventListener("keydown",n=>n.key==="Escape"&&t&&!t.classList.contains("hidden")&&p())),h(),t.classList.remove("hidden"),(e=t.querySelector("#acctX"))==null||e.focus()}function p(){var e,n;if(!t||t.classList.contains("hidden"))return;(n=(e=document.activeElement)==null?void 0:e.blur)==null||n.call(e),t.classList.add("hidden");const s=u;u=null,s==null||s()}function O(){t&&!t.classList.contains("hidden")&&h()}function h(){const s=t,e=b(),n=k(S(e.stats)),m=new Set(L(e.stats,y.map(a=>a.id))),v=q(e.stats);s.innerHTML=`<div class="as-in" role="dialog" aria-modal="true" aria-label="حسابي">
    <button type="button" class="as-x" id="acctX" aria-label="سكّر">✕</button>
    <div class="as-head">
      ${f(e.char,96,"big")}
      <div class="as-who">
        <label class="as-name"><span class="sr">اسمك</span><input id="acctName" maxlength="${g}" value="${i(e.name)}" placeholder="اكتب اسمك" autocomplete="nickname"></label>
        <span class="as-title">${i(n.title)} · مستوى ${l(n.level)}</span>
        <span class="bar wide"><i style="width:${Math.round(n.into/n.need*100)}%"></i></span>
        <span class="as-next">باقي ${l(n.need-n.into)} نقطة للمستوى ${l(n.level+1)}</span>
      </div>
    </div>
    <div class="as-stats"><div><b>${l(v.wins)}</b><span>فوز</span></div><div><b>${l(v.played)}</b><span>مباراة</span></div><div><b>${l(m.size)}</b><span>أوسمة</span></div></div>
    <div id="acctAuth" class="as-auth"><p>سجّل دخول عشان تنحفظ فوزاتك بكل جهاز.</p></div>
    <h3>فوزاتك بكل لعبة</h3>
    <ul class="as-games">${y.map(a=>{const o=e.stats.games[a.id]??{played:0,won:0};return`<li><img src="assets/thumbs/${a.id}.jpg" alt="" loading="lazy"><span class="nm">${i(a.name)}</span><b>${l(o.won)}</b><small>من ${l(o.played)}</small></li>`}).join("")}</ul>
    <h3>الأوسمة</h3>
    <ul class="as-badges">${w.map(a=>`<li class="${m.has(a.id)?"got":""}"><b>${i(a.name)}</b><small>${i(a.hint)}</small></li>`).join("")}</ul>
    <h3>اختار بطتك</h3>
    <div class="as-ducks">${E.map(a=>`<button type="button" class="duck${a.id===e.char?" on":""}" data-char="${a.id}" aria-pressed="${a.id===e.char}">${f(a.id,56)}<span>${i(a.name)}</span></button>`).join("")}</div>
  </div>`,r&&r(s.querySelector("#acctAuth")),s.querySelector("#acctX").onclick=p;const c=s.querySelector("#acctName"),$=()=>{const a=c.value.trim().slice(0,g);c.value=a,a!==b().name&&(d({name:a}),A())};c.onchange=$,c.onkeydown=a=>a.key==="Enter"&&c.blur(),c.onblur=$,s.querySelectorAll(".duck").forEach(a=>a.onclick=()=>{d({char:a.dataset.char}),A();const o=s.querySelector(".as-in").scrollTop;h(),s.querySelector(".as-in").scrollTop=o})}export{g as NAME_MAX,p as closeAccount,C as openAccount,O as refreshAccount,N as setAuthArea,M as setSaver};
