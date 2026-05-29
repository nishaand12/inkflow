import { useEffect } from "react";

export const INKFLOW_RESIZE_MESSAGE = "inkflow-resize";

/**
 * Notifies a parent frame (e.g. WordPress) of content height changes so the
 * iframe can grow/shrink without nested scrollbars. Only active when embed=1.
 */
export function useEmbedResize(isActive, deps = []) {
  useEffect(() => {
    if (!isActive) return;

    const sendHeight = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      window.parent.postMessage({ type: INKFLOW_RESIZE_MESSAGE, height }, "*");
    };

    sendHeight();

    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.documentElement);
    observer.observe(document.body);

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, ...deps]);
}
