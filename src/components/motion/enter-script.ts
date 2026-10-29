/**
 * How marked content rises into place: the same values for the entrance
 * below, scroll reveals and content added later (reveal.ts).
 */
export const RISE_FRAMES = [
  { opacity: 0, transform: "translate3d(0, 36px, 0) scale(0.96)" },
  { opacity: 1, transform: "none" },
];
export const RISE_TIMING = { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)", stagger: 65, maxStagger: 9 };
/** Capacity bars inside rising content fill up after it. */
export const FILL_FRAMES = [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }];
/** reveal.ts fires this when it takes over from the entrance below. */
export const REVEALS_START = "reveals:start";

/**
 * Runs inline at the top of <body>, before first paint, on every full page
 * load. It hides marked content (`html[data-enter]` in globals.css) and, once
 * the document is parsed, makes what is on screen rise into place in reading
 * order — without waiting for React to hydrate, so slow phones get the
 * entrance at first paint rather than a blank page.
 *
 * Most pages stream: the document finishes with the loading skeleton on
 * screen and React swaps the page in a moment later, still before hydrating.
 * So after the first pass it keeps watching, and sections rise as they are
 * swapped in, until reveal.ts announces it has taken over.
 *
 * A failsafe shows everything after 2.5 s whatever happens. Reduced motion:
 * nothing is hidden.
 */
export const ENTER_SCRIPT = `(function(){var d=document.documentElement;try{if(matchMedia("(prefers-reduced-motion: reduce)").matches||!d.animate||!window.MutationObserver)return;}catch(e){return;}d.setAttribute("data-enter","");var F=${JSON.stringify(RISE_FRAMES)},T=${JSON.stringify(RISE_TIMING)},B=${JSON.stringify(FILL_FRAMES)};var seen=new WeakSet(),started=false,handed=false,frame=0,mo=null;function scan(){frame=0;try{var h=innerHeight,n=0,list=document.querySelectorAll(".reveal, .reveal-children > *");for(var i=0;i<list.length;i++){var el=list[i];if(seen.has(el))continue;var r=el.getBoundingClientRect();if(!(r.width||r.height))continue;seen.add(el);if(el.parentElement&&el.parentElement.closest(".reveal"))continue;if(!(r.bottom>0&&r.top<h))continue;var delay=Math.min(n++,T.maxStagger)*T.stagger;el.animate(F,{duration:T.duration,delay:delay,easing:T.easing,fill:"backwards"});var bars=el.querySelectorAll(".meter-fill");for(var j=0;j<bars.length;j++)bars[j].animate(B,{duration:1100,delay:delay+250,easing:T.easing,fill:"backwards"});}}catch(e){}}document.addEventListener(${JSON.stringify(REVEALS_START)},function(){handed=true;if(frame){cancelAnimationFrame(frame);scan();}if(mo)mo.disconnect();},{once:true});function run(){if(started)return;started=true;scan();d.removeAttribute("data-enter");if(handed)return;mo=new MutationObserver(function(){frame||(frame=requestAnimationFrame(scan));});mo.observe(document.body,{childList:true,subtree:true});}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();setTimeout(run,2500);})();`;
