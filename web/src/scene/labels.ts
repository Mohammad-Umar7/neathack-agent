// CSS2D labels: twin-cell titles, STUCK tags and violation tags. Styles are injected once.
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const STYLE_ID = 'sp3d-styles';

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.sp3d-root{position:relative;overflow:hidden;}
.sp3d-root canvas{display:block;outline:none;}
.sp3d-css{position:absolute;inset:0;pointer-events:none;overflow:hidden;}
.sp3d-css > div{pointer-events:none;}
.sp3d-cell{font:600 13px/1.2 Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;
  color:#eef2f7;padding:9px 16px 9px 14px;border-radius:999px;white-space:nowrap;
  background:linear-gradient(180deg,rgba(18,22,30,.82),rgba(10,12,18,.72));
  border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 30px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;gap:10px;}
.sp3d-cell i{width:9px;height:9px;border-radius:50%;display:inline-block;box-shadow:0 0 10px currentColor;}
.sp3d-cell.a i{background:#ff5a3c;color:#ff5a3c;}
.sp3d-cell.b i{background:#38e08a;color:#38e08a;}
.sp3d-cell b{font-weight:800;}
.sp3d-stuck{font:800 10px/1 Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:.16em;color:#fff;
  padding:5px 8px;border-radius:4px;background:rgba(214,30,190,.92);box-shadow:0 0 18px rgba(255,60,230,.75);
  animation:sp3d-blink .5s steps(2,end) infinite;white-space:nowrap;}
@keyframes sp3d-blink{50%{opacity:.55}}
.sp3d-viol{font:600 12px/1.35 Inter,"Segoe UI",system-ui,sans-serif;color:#fff;max-width:280px;
  padding:8px 12px 9px;border-radius:8px;background:rgba(40,6,8,.86);border:1px solid rgba(255,70,60,.75);
  box-shadow:0 0 0 1px rgba(255,40,40,.15),0 0 28px rgba(255,40,30,.55),0 10px 30px rgba(0,0,0,.5);
  white-space:normal;will-change:transform;}
.sp3d-viol .r{display:inline-block;font-weight:800;letter-spacing:.08em;background:#ff3b30;color:#fff;
  padding:2px 6px;border-radius:4px;margin-right:7px;font-size:11px;}
.sp3d-viol .k{font-weight:800;letter-spacing:.12em;font-size:10px;color:#ff8a80;display:block;margin-bottom:3px;}
`;
  document.head.appendChild(s);
}

export function makeLabel(className: string, html: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  const obj = new CSS2DObject(el);
  return obj;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
