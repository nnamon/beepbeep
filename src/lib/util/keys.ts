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
 * checkbox or similar control.
 */
export function forControl(e: KeyboardEvent): boolean {
  if (inField(e)) return true;
  if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return false;
  const t = e.target as HTMLElement | null;
  if (!t || t === document.body || t === document.documentElement) return false;
  const role = t.getAttribute('role');
  return PRESSABLE.has(t.tagName) || (!!role && ROLES.has(role));
}
