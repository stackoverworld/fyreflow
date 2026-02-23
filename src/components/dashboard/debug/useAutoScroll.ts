import { useCallback, useEffect, useRef, useState } from "react";

const SCROLL_THRESHOLD = 24;

export function useAutoScroll(contentKey: string) {
  const containerRef = useRef<HTMLPreElement>(null);
  const isPinnedRef = useRef(true);
  const [showLatest, setShowLatest] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isPinnedRef.current = true;
    setShowLatest(false);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = distanceFromBottom <= SCROLL_THRESHOLD;
      isPinnedRef.current = pinned;
      setShowLatest(!pinned);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isPinnedRef.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [contentKey]);

  return { containerRef, showLatest, scrollToBottom };
}
