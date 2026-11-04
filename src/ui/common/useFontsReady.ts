import { useEffect, useState } from 'react';

/** True once the fonts have loaded: charts and measured layouts (report, Print Gantt) wait for it, so they use IBM Plex. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready;
}
