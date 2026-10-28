/** sessionStorage key: set once the opening has played (or been skipped) in this tab. */
export const INTRO_SEEN_KEY = "malaab-intro-seen";

/**
 * Runs inline at the top of <body>, before first paint, on any document load
 * (it is part of the root layout, which client navigations never re-render).
 * On the landing page only, it decides whether the opening plays, so the hero
 * copy can wait for the lights without a flash of content. The opening plays
 * once per session, never with reduced motion or Save-Data, and a failsafe
 * releases the page if the engine is not running within 3.5 s.
 */
export const INTRO_SCRIPT = `(function(){if(!new RegExp("^/(ar|en)/?$").test(location.pathname))return;var d=document.documentElement;try{var s=sessionStorage.getItem("${INTRO_SEEN_KEY}");var r=matchMedia("(prefers-reduced-motion: reduce)").matches;var c=navigator.connection;var sd=c&&c.saveData;var gl="WebGL2RenderingContext" in window;d.setAttribute("data-intro",!s&&!r&&!sd&&gl?"wait":"done");}catch(e){d.setAttribute("data-intro","done");}setTimeout(function(){if(d.getAttribute("data-intro")==="wait")d.setAttribute("data-intro","done");},3500);})();`;
