import{am as b,an as g,ao as k,ap as S,A as $,ah as q,aq as y,G as i,J as n,ar as w,e as L,al as f,ab as E}from"./index-D9EryneC.js";const A=14;let d=s=>void E(s);const M=s=>{d=s};let r=null;const N=s=>{r=s;const t=document.querySelector("#acctAuth");t&&s(t)};let e=null;function j(){var s;e||(e=document.createElement("div"),e.className="asheet hidden",e.id="asheet",document.body.appendChild(e),e.addEventListener("click",t=>t.target===e&&u()),addEventListener("keydown",t=>t.key==="Escape"&&e&&!e.classList.contains("hidden")&&u())),p(),e.classList.remove("hidden"),(s=e.querySelector("#acctX"))==null||s.focus()}function u(){e==null||e.classList.add("hidden")}function O(){e&&!e.classList.contains("hidden")&&p()}function p(){const s=e,t=b(),l=g(k(t.stats)),h=new Set(S(t.stats,$.map(a=>a.id))),m=q(t.stats);s.innerHTML=`<div class="as-in" role="dialog" aria-modal="true" aria-label="حسابي">
    <button type="button" class="as-x" id="acctX" aria-label="سكّر">✕</button>
    <div class="as-head">
      ${y(t.char,96,"big")}
      <div class="as-who">
        <label class="as-name"><span class="sr">اسمك</span><input id="acctName" maxlength="${A}" value="${i(t.name)}" placeholder="اكتب اسمك" autocomplete="nickname"></label>
        <span class="as-title">${i(l.title)} · مستوى ${n(l.level)}</span>
        <span class="bar wide"><i style="width:${Math.round(l.into/l.need*100)}%"></i></span>
        <span class="as-next">باقي ${n(l.need-l.into)} نقطة للمستوى ${n(l.level+1)}</span>
      </div>
    </div>
    <div class="as-stats"><div><b>${n(m.wins)}</b><span>فوز</span></div><div><b>${n(m.played)}</b><span>مباراة</span></div><div><b>${n(h.size)}</b><span>أوسمة</span></div></div>
    <div id="acctAuth" class="as-auth"><p>سجّل دخول عشان تنحفظ فوزاتك بكل جهاز.</p></div>
    <h3>فوزاتك بكل لعبة</h3>
    <ul class="as-games">${$.map(a=>{const o=t.stats.games[a.id]??{played:0,won:0};return`<li><img src="assets/thumbs/${a.id}.jpg" alt="" loading="lazy"><span class="nm">${i(a.name)}</span><b>${n(o.won)}</b><small>من ${n(o.played)}</small></li>`}).join("")}</ul>
    <h3>الأوسمة</h3>
    <ul class="as-badges">${w.map(a=>`<li class="${h.has(a.id)?"got":""}"><b>${i(a.name)}</b><small>${i(a.hint)}</small></li>`).join("")}</ul>
    <h3>اختار بطتك</h3>
    <div class="as-ducks">${L.map(a=>`<button type="button" class="duck${a.id===t.char?" on":""}" data-char="${a.id}" aria-pressed="${a.id===t.char}">${y(a.id,56)}<span>${i(a.name)}</span></button>`).join("")}</div>
  </div>`,r&&r(s.querySelector("#acctAuth")),s.querySelector("#acctX").onclick=u;const c=s.querySelector("#acctName"),v=()=>{const a=c.value.trim().slice(0,A);c.value=a,a!==b().name&&(d({name:a}),f())};c.onchange=v,c.onkeydown=a=>a.key==="Enter"&&c.blur(),c.onblur=v,s.querySelectorAll(".duck").forEach(a=>a.onclick=()=>{d({char:a.dataset.char}),f();const o=s.querySelector(".as-in").scrollTop;p(),s.querySelector(".as-in").scrollTop=o})}export{A as NAME_MAX,u as closeAccount,j as openAccount,O as refreshAccount,N as setAuthArea,M as setSaver};
