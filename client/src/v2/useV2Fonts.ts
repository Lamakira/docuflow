import { useEffect } from "react";

const FONTSHARE_HREF =
  "https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=switzer@400,500,600,700&display=swap";

/**
 * Shares one resource between many users: `setup` runs for the first, the
 * teardown it returns runs when the last one lets go. A user that unmounts
 * while another still needs the resource therefore removes nothing.
 */
export function createRefCounted(setup: () => () => void): () => () => void {
  let users = 0;
  let teardown: (() => void) | null = null;
  return () => {
    if (users++ === 0) teardown = setup();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--users === 0) {
        teardown?.();
        teardown = null;
      }
    };
  };
}

const acquireFonts = createRefCounted(() => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONTSHARE_HREF;
  link.setAttribute("data-df-v2-fonts", "true");
  document.head.appendChild(link);
  return () => link.remove();
});

/**
 * Loads the v2 fonts for whichever v2 surfaces are mounted. Reference-counted:
 * the rail's lockup and the shell both call it, and either may unmount first.
 */
export function useV2Fonts() {
  useEffect(() => acquireFonts(), []);
}
