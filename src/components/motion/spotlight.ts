/**
 * Cards marked `.spotlight` are lit from where the pointer is, like turf
 * under a floodlight (mouse and pen only: touch has no hover). The position
 * reaches CSS as --mx/--my, at most once per frame, through a held Web
 * Animation rather than the style attribute (a card may not be hydrated yet).
 */
export function startSpotlight(): () => void {
  const lights = new WeakMap<Element, Animation>();
  let last: PointerEvent | null = null;
  let frame = 0;
  const paint = () => {
    frame = 0;
    const card = last?.target instanceof Element ? last.target.closest<HTMLElement>(".spotlight") : null;
    if (!last || !card) return;
    const r = card.getBoundingClientRect();
    const at: Keyframe[] = [{ "--mx": `${Math.round(last.clientX - r.left)}px`, "--my": `${Math.round(last.clientY - r.top)}px` }];
    const light = lights.get(card);
    if (light?.effect instanceof KeyframeEffect) light.effect.setKeyframes(at);
    else lights.set(card, card.animate(at, { duration: 0, fill: "forwards" }));
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    last = e;
    frame ||= requestAnimationFrame(paint);
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    document.removeEventListener("pointermove", onMove);
    cancelAnimationFrame(frame);
  };
}
