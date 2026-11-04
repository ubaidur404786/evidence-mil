import { useCallback, useEffect, useState } from "react";

/** Steps through `count` stages: auto-advances every `intervalMs` while playing. */
export function usePlayer(count: number, intervalMs = 2200) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || count === 0) return;
    if (index >= count - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, count - 1)), intervalMs);
    return () => clearTimeout(t);
  }, [playing, index, count, intervalMs]);

  const replay = useCallback(() => {
    setIndex(0);
    setPlaying(true);
  }, []);
  const goTo = useCallback(
    (i: number) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(i, count - 1)));
    },
    [count],
  );
  const toggle = useCallback(() => setPlaying((p) => !p), []);

  return { index, playing, replay, goTo, toggle, setPlaying };
}
