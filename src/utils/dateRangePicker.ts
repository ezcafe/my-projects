import { Calendar } from 'vanilla-calendar-pro';
import 'vanilla-calendar-pro/styles/index.css';
import { formatDateDDMMYY, parseDDMMYY } from './dateFormat';

/** Local calendar date as YYYY-MM-DD (avoids UTC shift in positive-offset TZ). */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Expand [startIso, endIso] to all dates in range (inclusive). Used so vanilla-calendar-pro highlights the range in both months. */
function expandRangeToDates(startIso: string, endIso: string): string[] {
  const start = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso + 'T00:00:00');
  if (end < start) return [startIso];
  const out: string[] = [];
  const cur = new Date(start.getTime());
  while (cur <= end) {
    out.push(toLocalDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function setDisplayRange(display: HTMLElement, startIso: string, endIso: string): void {
  const text = `${formatDateDDMMYY(startIso)} — ${formatDateDDMMYY(endIso)}`;
  if (display instanceof HTMLInputElement) {
    display.value = text;
  } else {
    display.textContent = text;
  }
}

export interface DateRangePickerOptions {
  onRangeSelected?: (startFormatted: string, endFormatted: string) => void;
}

/**
 * One calendar instance for start/end range. Popup is shown on display click;
 * no document click listener — closes only when 2 dates are selected or display is clicked again.
 */
export function attachDateRangePicker(
  displayElement: HTMLElement,
  startInput: HTMLInputElement,
  endInput: HTMLInputElement,
  options?: DateRangePickerOptions,
): void {
  if (displayElement.closest('.date-range-picker-wrap')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'date-range-picker-wrap';
  const parent = displayElement.parentElement!;
  parent.insertBefore(wrapper, displayElement);
  wrapper.appendChild(displayElement);

  const popup = document.createElement('div');
  popup.className = 'date-range-picker-popup';
  popup.setAttribute('aria-hidden', 'true');
  document.body.appendChild(popup);
  const calendarEl = document.createElement('div');
  popup.appendChild(calendarEl);

  function syncDisplay(): void {
    const startIso = parseDDMMYY(startInput.value) || toLocalDateString(new Date());
    const endIso = parseDDMMYY(endInput.value) || toLocalDateString(new Date());
    const start = new Date(startIso + 'T00:00:00');
    const end = new Date(endIso + 'T00:00:00');
    const isoStart = toLocalDateString(start);
    const isoEnd = end <= start ? isoStart : toLocalDateString(end);
    setDisplayRange(displayElement, isoStart, isoEnd);
  }

  function openPopup(): void {
    const startIso = parseDDMMYY(startInput.value) || toLocalDateString(new Date());
    const endIso = parseDDMMYY(endInput.value) || toLocalDateString(new Date());
    const start = new Date(startIso + 'T00:00:00');
    const end = new Date(endIso + 'T00:00:00');
    const isoStart = toLocalDateString(start);
    const isoEnd = toLocalDateString(end);
    calendar.selectedDates = start <= end ? expandRangeToDates(isoStart, isoEnd) : [isoStart];
    calendar.update({ dates: true });
    const rect = wrapper.getBoundingClientRect();
    popup.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;z-index:10000;visibility:visible;pointer-events:auto;`;
    popup.setAttribute('aria-hidden', 'false');
    popup.classList.add('range-incomplete');
    selectionStep = 0;

    // Close when clicking outside (attach on next tick so the click that opened doesn't close immediately)
    setTimeout(() => {
      clickOutsideHandler = (e: MouseEvent) => {
        const target = e.target as Node;
        const path = e.composedPath();
        const inside =
          popup.contains(target) ||
          wrapper.contains(target) ||
          path.includes(popup) ||
          path.includes(wrapper);
        if (inside) return;
        closePopup();
        isOpen = false;
        selectionStep = 0;
      };
      document.addEventListener('click', clickOutsideHandler);
    }, 0);
  }

  let clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  function closePopup(): void {
    popup.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:10000;visibility:hidden;pointer-events:none;';
    popup.setAttribute('aria-hidden', 'true');
    popup.classList.remove('range-incomplete');
    if (clickOutsideHandler) {
      document.removeEventListener('click', clickOutsideHandler);
      clickOutsideHandler = null;
    }
  }

  syncDisplay();

  const calendar = new Calendar(calendarEl, {
    inputMode: false,
    selectionDatesMode: 'multiple-ranged',
    enableEdgeDatesOnly: true,
    onHide: (self: Calendar) => {
      // Keep popup visible when range incomplete (only 1 date selected) so user can pick second date
      if (isOpen && self.selectedDates?.length === 1) {
        popup.classList.add('range-incomplete');
        calendarEl.removeAttribute('data-vc-calendar-hidden');
        requestAnimationFrame(() => calendar.update({ dates: true }));
      }
    },
    onClickDate: (_self: Calendar, event: MouseEvent) => {
      // Use the clicked cell's data-vc-date so selection matches the calendar cell the user clicked
      const dateEl = (event.target as HTMLElement)?.closest?.('[data-vc-date]') as HTMLElement | null;
      const clickedIso = dateEl?.dataset?.vcDate ?? null;
      if (!clickedIso || !/^\d{4}-\d{2}-\d{2}$/.test(clickedIso)) return;

      if (selectionStep === 0) {
        // First click: deselect current range — show only this date, stay open for second click
        startDateFromFirstClick = clickedIso;
        calendar.selectedDates = [clickedIso];
        calendar.update({ dates: true });
        selectionStep = 1;
        popup.classList.add('range-incomplete');
        requestAnimationFrame(() => {
          calendarEl.removeAttribute('data-vc-calendar-hidden');
          calendar.update({ dates: true });
        });
        return;
      }

      // Second click: set end date, close picker, update date field
      const startIso = startDateFromFirstClick;
      const endIso = clickedIso;
      const orderedStart = startIso <= endIso ? startIso : endIso;
      const orderedEnd = startIso <= endIso ? endIso : startIso;
      startInput.value = formatDateDDMMYY(orderedStart);
      endInput.value = formatDateDDMMYY(orderedEnd);
      setDisplayRange(displayElement, orderedStart, orderedEnd);
      options?.onRangeSelected?.(formatDateDDMMYY(orderedStart), formatDateDDMMYY(orderedEnd));
      popup.classList.remove('range-incomplete');
      closePopup();
      isOpen = false;
      selectionStep = 0;
    },
  });
  calendar.init();
  closePopup();

  let isOpen = false;
  let selectionStep = 0;
  let startDateFromFirstClick: string = '';

  // Undo library hide when only 1 date selected (library sets data-vc-calendar-hidden on calendarEl)
  const hiddenObserver = new MutationObserver(() => {
    if (!isOpen || calendar.selectedDates?.length !== 1) return;
    if (!calendarEl.hasAttribute('data-vc-calendar-hidden')) return;
    popup.classList.add('range-incomplete');
    requestAnimationFrame(() => {
      if (!isOpen || calendar.selectedDates?.length !== 1) return;
      calendarEl.removeAttribute('data-vc-calendar-hidden');
      calendar.update({ dates: true });
    });
  });
  hiddenObserver.observe(calendarEl, { attributes: true, attributeFilter: ['data-vc-calendar-hidden'] });

  // No document-level click listener: keep popup open until 2 dates selected or display clicked again.
  // (A doc listener was closing the popup on first date click, likely due to event target/ordering.)

  displayElement.setAttribute('readonly', '');
  if (displayElement instanceof HTMLInputElement) displayElement.readOnly = true;
  // Keep focus in calendar when open with 1 date selected (avoid focus on display closing or hiding picker)
  displayElement.addEventListener('focus', () => {
    if (!isOpen || calendar.selectedDates?.length !== 1) return;
    displayElement.blur();
    const calEl = popup.querySelector('[data-vc="calendar"]') ?? calendarEl;
    (calEl as HTMLElement).focus?.();
  });
  displayElement.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) {
      closePopup();
      isOpen = false;
    } else {
      openPopup();
      isOpen = true;
    }
  });
}
