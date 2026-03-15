import { createProject } from '../../services/projectService';
import { formatDateDDMMYY, parseDDMMYY } from '../../utils/dateFormat';
import { attachDateRangePicker } from '../../utils/dateRangePicker';

type ModalMode = 'create';

interface ModalConfig {
  mode: ModalMode;
}

export function openProjectModal(config: ModalConfig) {
  const existing = document.querySelector('.modal-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-header">
      <h2>${config.mode === 'create' ? 'New project' : 'Project'}</h2>
      <button class="modal-close" aria-label="Close">&times;</button>
    </div>
    <form class="modal-body">
      <label>
        <span>Name</span>
        <input name="name" type="text" required />
      </label>
      <label>
        <span>Description</span>
        <textarea name="description" rows="3"></textarea>
      </label>
      <label>
        <span>Dates</span>
        <input type="text" id="modal-date-range-display" placeholder="DD/MM/YY — DD/MM/YY" autocomplete="off" />
        <input name="startDate" type="hidden" />
        <input name="endDate" type="hidden" />
      </label>
      <label>
        <span>Status</span>
        <select name="status">
          <option value="NotStarted">Not started</option>
          <option value="InProgress">In progress</option>
          <option value="Blocked">Blocked</option>
          <option value="Done">Done</option>
        </select>
      </label>
      <label>
        <span>Priority</span>
        <select name="priority">
          <option value="Low">Low</option>
          <option value="Medium" selected>Medium</option>
          <option value="High">High</option>
          <option value="Critical">Critical</option>
        </select>
      </label>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-role="cancel">Cancel</button>
        <button type="submit" class="btn">Create</button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      close();
    }
  });

  modal.querySelector<HTMLButtonElement>('.modal-close')?.addEventListener(
    'click',
    () => close(),
  );

  modal
    .querySelector<HTMLButtonElement>('[data-role="cancel"]')
    ?.addEventListener('click', () => close());

  const form = modal.querySelector<HTMLFormElement>('form')!;
  const today = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const startInput = form.elements.namedItem('startDate') as HTMLInputElement;
  const endInput = form.elements.namedItem('endDate') as HTMLInputElement;
  startInput.value = formatDateDDMMYY(today);
  endInput.value = formatDateDDMMYY(nextWeek);
  const displayEl = modal.querySelector<HTMLInputElement>('#modal-date-range-display')!;
  attachDateRangePicker(displayEl, startInput, endInput);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;

    const startDateStr = String(data.get('startDate')).trim();
    const endDateStr = String(data.get('endDate')).trim();
    const startDate = parseDDMMYY(startDateStr);
    const endDate = parseDDMMYY(endDateStr);
    if (!startDate || !endDate) {
      alert('Please enter dates in DD/MM/YY format (e.g. 14/03/25).');
      return;
    }

    await createProject({
      name,
      description: String(data.get('description') ?? '').trim() || undefined,
      startDate: new Date(startDate + 'T00:00:00').toISOString(),
      endDate: new Date(endDate + 'T00:00:00').toISOString(),
      status: data.get('status') as any,
      priority: data.get('priority') as any,
    });

    close();
    window.dispatchEvent(new Event('hashchange'));
  });
}

