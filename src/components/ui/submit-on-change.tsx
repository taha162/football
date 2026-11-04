"use client";

import { useEffect, useRef } from "react";

/** Submits the form it sits in whenever one of its fields changes, so a search updates without pressing its button. */
export function SubmitOnChange() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const submit = () => form.requestSubmit();
    form.addEventListener("change", submit);
    return () => form.removeEventListener("change", submit);
  }, []);
  return <span ref={ref} hidden />;
}
