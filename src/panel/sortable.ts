/** The ids of the rows of a sortable list, top to bottom. */
function idsOf(list: HTMLElement): string[] {
	return Array.from(list.querySelectorAll<HTMLElement>(".ghs-sort-row")).map((row) => row.dataset["id"]!);
}

/** Within this many pixels of the top or bottom edge of the scrolling area, dragging scrolls it. */
const EDGE_PX = 48;
const SCROLL_STEP_PX = 14;

/**
 * Makes the rows of a list (`.ghs-sort-row` with a `.ghs-sort-handle` in it) movable: drag the handle with a mouse or a
 * finger, or press the arrow keys on it. The rows move while they are dragged; `onDrop` gets the new order of their
 * `data-id`s when the handle is let go or a key moved a row.
 */
export function makeSortable(list: HTMLElement, onDrop: (ids: string[]) => void): void {
	for (const handle of Array.from(list.querySelectorAll<HTMLElement>(".ghs-sort-handle"))) {
		const row = handle.closest<HTMLElement>(".ghs-sort-row")!;

		handle.addEventListener("pointerdown", (event) => {
			if (event.button > 0) return;
			event.preventDefault();
			row.addClass("ghs-sort-dragging");
			// listeners on the document, not pointer capture: moving the row in the list would release the capture
			const scroller = list.closest<HTMLElement>(".view-content");
			const move = (e: Event): void => {
				const y = (e as PointerEvent).clientY;
				// a list longer than the screen: dragging to the edge brings the rest into view
				if (scroller) {
					const area = scroller.getBoundingClientRect();
					if (y < area.top + EDGE_PX) scroller.scrollTop -= SCROLL_STEP_PX;
					else if (y > area.bottom - EDGE_PX) scroller.scrollTop += SCROLL_STEP_PX;
				}
				const next = Array.from(list.querySelectorAll<HTMLElement>(".ghs-sort-row")).filter((r) => r !== row).find((r) => {
					const box = r.getBoundingClientRect();
					return y < box.top + box.height / 2;
				});
				list.insertBefore(row, next ?? null);
			};
			const up = (): void => {
				activeDocument.removeEventListener("pointermove", move);
				activeDocument.removeEventListener("pointerup", up);
				activeDocument.removeEventListener("pointercancel", up);
				row.removeClass("ghs-sort-dragging");
				onDrop(idsOf(list));
			};
			activeDocument.addEventListener("pointermove", move);
			activeDocument.addEventListener("pointerup", up);
			activeDocument.addEventListener("pointercancel", up);
		});

		handle.addEventListener("keydown", (event) => {
			const key = event.key;
			const up = key === "ArrowUp";
			if (!up && key !== "ArrowDown") return;
			event.preventDefault();
			// a row that is already at the end it is sent towards stays where it is
			if (up ? row.previousElementSibling === null : row.nextElementSibling === null) return;
			const target = up ? row.previousElementSibling : row.nextElementSibling!.nextElementSibling;
			list.insertBefore(row, target);
			handle.focus();
			onDrop(idsOf(list));
		});
	}
}
