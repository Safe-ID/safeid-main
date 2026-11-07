import { useEffect } from "react";

// Teclas que rolam a página. Tab continua livre: o foco pode andar mesmo com a rolagem presa
const SCROLL_KEYS = new Set([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "End", "Home"]);

function isEditable(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Enquanto `active`, a página não rola: roda do mouse, toque, teclas e arrasto da barra
 * voltam para a posição em que a trava começou. Feito para durar segundos (ex.: a montagem
 * da capa), não para prender a pessoa: quem usa a trava deve soltá-la com um limite de tempo.
 * Não usa overflow: hidden, que tiraria a barra de rolagem e faria a página "pular" de lado.
 */
export default function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const y = window.scrollY;
    const block = (event) => event.preventDefault();
    const onKey = (event) => {
      if (SCROLL_KEYS.has(event.key) && !isEditable(event.target)) event.preventDefault();
    };
    const hold = () => {
      if (window.scrollY !== y) window.scrollTo(0, y);
    };

    window.addEventListener("wheel", block, { passive: false });
    window.addEventListener("touchmove", block, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hold);
    return () => {
      window.removeEventListener("wheel", block);
      window.removeEventListener("touchmove", block);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hold);
    };
  }, [active]);
}
