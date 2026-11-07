import { useEffect, useRef, useState } from "react";

/**
 * `true` quando o elemento entra bem na tela (uma vez só), para disparar animações de entrada.
 * Sem IntersectionObserver (testes, navegadores antigos), o conteúdo já aparece pronto.
 */
export default function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -18% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return [ref, shown];
}
