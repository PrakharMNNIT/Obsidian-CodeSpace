const SCROLLING_CLASS = "code-space-is-scrolling";
const SCROLLBAR_HIDE_DELAY = 600;

/**
 * Shows a CodeMirror scroller's scrollbar while it is actively scrolling.
 * Focused scrollers remain visible through the CSS :focus-within selector.
 */
export function setupScrollbarVisibility(scroller: HTMLElement): () => void {
	const ownerWindow = scroller.ownerDocument.defaultView ?? window;
	let hideTimer: number | null = null;

	const onScroll = () => {
		scroller.classList.add(SCROLLING_CLASS);
		if (hideTimer !== null) {
			ownerWindow.clearTimeout(hideTimer);
		}
		hideTimer = ownerWindow.setTimeout(() => {
			hideTimer = null;
			scroller.classList.remove(SCROLLING_CLASS);
		}, SCROLLBAR_HIDE_DELAY);
	};

	scroller.addEventListener("scroll", onScroll, { passive: true });

	return () => {
		scroller.removeEventListener("scroll", onScroll);
		if (hideTimer !== null) {
			ownerWindow.clearTimeout(hideTimer);
			hideTimer = null;
		}
		scroller.classList.remove(SCROLLING_CLASS);
	};
}
