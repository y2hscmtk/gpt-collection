const f="gptBookmarks",U="gptBookmarkContent:";const a="gpt-bookmark-btn",y="gpt-bookmark-wrapper",L="data-gpt-bookmark-enhanced",v="gpt-bookmark-highlight",x="gpt-bookmark-style";const u="gpt-bookmark-icon",m="gpt-bookmark-icon-path";const j="[data-message-id]",X='[data-message-author-role="assistant"]',E='[data-testid="conversation-turn"]',$=".markdown",Y=['[data-testid="project-title"]','[data-testid="project-header-title"]','[data-testid="project-header"] h1','[data-testid="project-header"] span','[data-testid="workspace-switcher-current"]','[data-testid="project-name"]'],l=new Map,g=new Map;let c=null,h=null,k=!1;function w(t,...e){const n=[typeof t=="string"?t:null,...e];for(const r of n){if(typeof r!="string")continue;const o=r.trim();if(o.length===0)continue;const s=o.split(`
`).map(i=>i.trim()).find(i=>i.length>0)??o;if(s.length>0)return s.slice(0,120)}return"제목 없음"}function V(t){const n=window.prompt("즐겨찾기 제목을 입력하세요. 취소하면 저장되지 않습니다.",t);if(n===null)return null;const r=n.trim();return r.length===0?t:r.slice(0,120)}function N(){return typeof chrome<"u"&&chrome?.storage?.sync?chrome.storage.sync:chrome.storage?.local??null}function M(){return typeof chrome<"u"&&chrome?.storage?.local?chrome.storage.local:null}function I(t,e,...n){return new Promise((r,o)=>{if(!t?.[e]){r();return}t[e](...n,s=>{const i=chrome.runtime?.lastError;if(i){o(new Error(i.message));return}r(s)})})}function O(t){return t?Array.isArray(t)?t:[]:[]}async function C(){const t=N();try{const n=(await I(t,"get",f))?.[f];return O(n).filter(r=>r&&typeof r=="object").map(r=>({...r,savedAt:r.savedAt??Date.now(),snippet:r.snippet??"",title:w(r.title,r.snippet??"",r.conversationTitle??""),conversationTitle:r.conversationTitle??"ChatGPT",projectId:r.projectId??null,projectTitle:r.projectTitle??null,origin:r.origin??null,messageId:r.messageId??r.id})).sort((r,o)=>(o.savedAt??0)-(r.savedAt??0))}catch(e){return console.warn("[gpt-bookmarks] chrome.storage.sync.get 실패:",e),[]}}async function H(t){const e=N();await I(e,"set",{[f]:t})}function A(t){return`${U}${t}`}async function z(t,e){if(typeof e!="string"||e.length===0)return!1;const n=M();if(!n)return!1;const r=e.length>2097152?e.slice(0,2097152):e,o={[A(t)]:{content:r,updatedAt:Date.now()}};return await I(n,"set",o),!!o[A(t)].content}async function R(t){if(!t)return;const e=M();e&&await I(e,"remove",A(t)).catch(n=>{console.warn("[gpt-bookmarks] remove content failed:",n)})}async function K(t){if(!t)throw new Error("Bookmark payload is required");const e=await C(),n=t.messageId||t.id||crypto.randomUUID(),r=t.messageId??n,o={id:n,messageId:r,conversationId:t.conversationId??null,conversationTitle:t.conversationTitle??"ChatGPT",projectId:t.projectId??null,projectTitle:t.projectTitle??null,origin:t.origin??null,snippet:(t.snippet??"").slice(0,160),title:w(t.title,t.content??"",t.snippet??"",t.conversationTitle??""),url:t.url,savedAt:t.savedAt??Date.now(),hasContent:!1};t.content&&(o.hasContent=await z(n,t.content));const s=[...e.filter(i=>i.id!==n),o].sort((i,d)=>(d.savedAt??0)-(i.savedAt??0));try{await H(s)}catch(i){throw await R(n),i}return o}async function W(t){if(!t)return;const n=(await C()).filter(r=>r.id!==t);await H(n),await R(t)}function F(){if(document.getElementById(x))return;const t=document.createElement("style");t.id=x,t.textContent=`
    .${y} {
      position: absolute;
      inset-inline-start: -36px;
      top: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
    }

    .${a} {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: none;
      background: rgba(15, 23, 42, 0.65);
      color: #94a3b8;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 160ms ease, color 160ms ease, background-color 160ms ease;
      padding: 0;
    }

    .${a} .${u} {
      width: 18px;
      height: 18px;
      display: block;
    }

    .${a} .${u} .${m} {
      fill: rgba(148, 163, 184, 0.85);
      stroke: transparent;
      stroke-width: 0;
      transition: fill 160ms ease, stroke 160ms ease, stroke-width 160ms ease;
    }

    .${a}:hover {
      transform: scale(1.05);
      background: rgba(15, 23, 42, 0.9);
    }

    .${a}:hover .${u} .${m} {
      fill: rgba(250, 204, 21, 0.72);
    }

    .${a}.is-active {
      background: rgba(234, 179, 8, 0.18);
    }

    .${a}.is-active .${u} .${m} {
      fill: #facc15;
      stroke: rgba(245, 158, 11, 0.6);
      stroke-width: 0.8;
    }

    .${v} {
      outline: 2px solid rgba(250, 204, 21, 0.9);
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.9), 0 0 18px rgba(250, 204, 21, 0.45);
      border-radius: 18px;
      transition: outline 200ms ease, box-shadow 200ms ease, background 200ms ease;
      background: rgba(250, 204, 21, 0.08);
    }

    @media (max-width: 1024px) {
      .${y} {
        inset-inline-start: 0;
        top: -38px;
        position: relative;
        margin-bottom: 8px;
        justify-content: flex-start;
      }
    }
  `,document.head.appendChild(t)}function _(t){if(!t||t.querySelector(`.${u}`))return;const e=document.createElementNS("http://www.w3.org/2000/svg","svg");e.setAttribute("viewBox","0 0 24 24"),e.setAttribute("focusable","false"),e.setAttribute("aria-hidden","true"),e.classList.add(u);const n=document.createElementNS("http://www.w3.org/2000/svg","path");n.setAttribute("d","M6 2h12a2 2 0 0 1 2 2v18l-8-4-8 4V4a2 2 0 0 1 2-2z"),n.classList.add(m),e.appendChild(n),t.appendChild(e)}function J(t){return typeof t!="string"?"":typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(t):t.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}function Q(){return(document.title??"").replace(/ - ChatGPT.*$/,"").trim()||"ChatGPT"}function Z(){for(const t of Y){const e=document.querySelector(t);if(e&&e.textContent){const n=e.textContent.trim();if(n)return n}}return null}function tt(){const t=window.location.origin,e=window.location.pathname.split("/").filter(Boolean);let n=null,r=null;if(e.length>0)if(e[0]==="p"){n=e[1]??null;const o=e.indexOf("c");o!==-1&&e[o+1]&&(r=e[o+1])}else e[0]==="c"&&(r=e[1]??null);return{origin:t,projectId:n,conversationId:r,projectTitle:Z()}}function et(t){let e=0;for(let n=0;n<t.length;n+=1)e=(e<<5)-e+t.charCodeAt(n),e|=0;return`tx_${Math.abs(e)}`}function p(t){return t instanceof HTMLElement?t.dataset?.messageId&&t.dataset.messageAuthorRole==="assistant"?t:t.closest(X):null}function P(t){if(!t)return null;const e=t.dataset?.messageId;if(e)return e;const n=t.closest(E);if(n?.dataset?.turnId)return n.dataset.turnId;const o=t.querySelector($)?.innerText?.trim();return o?et(o):null}function nt(t){return rt({origin:t.origin,projectId:t.projectId,conversationId:t.conversationId})}function rt({origin:t,projectId:e,conversationId:n}){const r=t||window.location.origin,o=[];return e&&o.push("p",e),n&&o.push("c",n),o.length===0?window.location.href:`${r}/${o.join("/")}`}function ot(t){if(!t)return null;const e=p(t);if(!e)return null;const n=P(e);if(!n)return null;const r=t.innerText.trim(),o=r.slice(0,160),s=tt(),i=nt(s),d=w(null,r,o);return{id:n,messageId:n,conversationId:s.conversationId,projectId:s.projectId,projectTitle:s.projectTitle,origin:s.origin,conversationTitle:Q(),snippet:o,title:d,content:r,url:i,savedAt:Date.now()}}function st(t){if(!t)return null;if(t.hasAttribute(L)){const o=t.querySelector(`button.${a}`);return o&&_(o),o??null}window.getComputedStyle(t).position==="static"&&(t.style.position="relative");const n=document.createElement("div");n.className=y;const r=document.createElement("button");return r.type="button",r.className=a,_(r),n.appendChild(r),t.insertBefore(n,t.firstChild),t.setAttribute(L,"true"),r}function T(t,e){t.classList.toggle("is-active",e),t.setAttribute("aria-pressed",String(e)),t.title=e?"즐겨찾기에서 제거":"즐겨찾기에 추가",t.setAttribute("aria-label",t.title)}function it(t){if(!t)return!1;t.scrollIntoView({behavior:"smooth",block:"center"}),g.has(t)&&clearTimeout(g.get(t)),t.classList.add(v);const e=window.setTimeout(()=>{t.classList.remove(v),g.delete(t)},2400);return g.set(t,e),!0}function at(t){if(!t)return null;const e=J(t),n=document.querySelector(`[data-message-id="${e}"]`);if(!n)return null;const r=p(n);return r?r.closest(E)||r:n.closest(E)||n}function S(t){if(!t)return!1;const e=at(t);return e?it(e):!1}function ct(t){return t?S(t)?(c=null,!0):(c={id:t,attempts:0},!1):!1}function b(){if(!c)return;const{id:t,attempts:e}=c;if(S(t)){c=null;return}if(e>40){c=null;return}c.attempts+=1}async function lt(t,e){const n=ot(e);if(!n)return;const r=n.messageId,o=l.get(r);try{if(o)await W(o),l.delete(r),T(t,!1);else{const s=n.title??w(null,n.snippet??"",n.conversationTitle??""),i=V(s);if(i===null)return;n.title=i;const d=await K(n);l.set(r,d.id),T(t,!0)}}catch(s){console.error("[gpt-bookmarks] 즐겨찾기 토글 중 오류가 발생했습니다.",s)}}function G(t){const e=p(t);if(!e)return;const n=e.querySelector($);if(!n)return;const r=P(e);if(!r)return;const o=st(e);o&&(o.dataset.messageId=r,T(o,l.has(r)),o.dataset.gptBookmarkBound||(o.addEventListener("click",s=>{s.preventDefault(),s.stopPropagation(),lt(o,n)}),o.dataset.gptBookmarkBound="true"),c?.id===r&&(S(r),c=null))}function D(t=document){t.querySelectorAll(j).forEach(n=>{const r=p(n);r&&r.dataset.messageAuthorRole==="assistant"&&G(r)}),b()}function ut(){new MutationObserver(e=>{e.forEach(n=>{n.addedNodes.forEach(r=>{if(r instanceof HTMLElement)if(r.matches?.(j)){const o=p(r);o&&o.dataset.messageAuthorRole==="assistant"&&G(o)}else D(r)})}),b()}).observe(document.body,{childList:!0,subtree:!0})}function q(t){l.clear(),t.forEach(e=>{const n=e.messageId??e.id;n&&l.set(n,e.id)}),document.querySelectorAll(`button.${a}`).forEach(e=>{const n=e.dataset.messageId;T(e,n?l.has(n):!1)})}function dt(){if(typeof chrome>"u"||!chrome.storage?.onChanged)return()=>{};const t=(e,n)=>{if(n!=="sync"||!e?.[f])return;const r=O(e[f].newValue);q(r)};return chrome.storage.onChanged.addListener(t),()=>chrome.storage.onChanged.removeListener(t)}function ft(){typeof chrome>"u"||!chrome.runtime?.onMessage||chrome.runtime.onMessage.addListener((t,e,n)=>{if(!t||t.type!=="gpt-bookmarks:highlight")return!1;const r=t.payload?.messageId??t.payload?.id,o=ct(r);return n?.({ok:o}),!1})}async function B(){if(!k){k=!0,F();try{const t=await C();q(t)}catch(t){console.warn("[gpt-bookmarks] 초기 즐겨찾기 로드 실패:",t)}dt(),D(),ut(),ft(),h||(h=window.setInterval(b,800))}}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",B):B();window.addEventListener("beforeunload",()=>{h&&clearInterval(h)});
