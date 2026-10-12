// Screen shortcuts (Enter to start, Space to tap) must not steal a key press
// from the control that has focus: Enter on a link follows it, Enter or Space
// on a button presses it, and any key in a text box types.

const FIELD = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const PRESSABLE = new Set(['A', 'BUTTON', 'SUMMARY']);
const ROLES = new Set(['button', 'link', 'radio', 'checkbox', 'switch', 'tab', 'menuitem', 'option', 'slider', 'spinbutton']);

/** True when the focused element is a text box, select or other editable control. */
export function inField(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (FIELD.has(t.tagName) || t.isContentEditable);
}

/**
 * True when this key press belongs to the focused control rather than to the
 * screen: any key in a text box, and Enter or Space on a link, button, radio,
 * checkbox or similar control that was reached from the keyboard (Tab).
 * A button just clicked with the mouse keeps focus without showing it; Enter
 * then still does what the screen says (Start, Next, Done).
 */
export function forControl(e: KeyboardEvent): boolean {
  if (inField(e)) return true;
  if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return false;
  const t = e.target as HTMLElement | null;
  // Not an element (the window itself): nothing has focus.
  if (!t || typeof t.getAttribute !== 'function' || t === document.body || t === document.documentElement) return false;
  const role = t.getAttribute('role');
  if (!PRESSABLE.has(t.tagName) && !(role && ROLES.has(role))) return false;
  return t !== clicked;
}

/** The control last pressed with the mouse or a finger; Tab clears it. */
let clicked: Element | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (clicked = (e.target as Element | null)?.closest?.('a, button, summary, [role]') ?? null), true);
  window.addEventListener('keydown', (e) => e.key === 'Tab' && (clicked = null), true);
}
