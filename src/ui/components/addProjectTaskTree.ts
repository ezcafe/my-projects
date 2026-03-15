import type { ProjectPriority, ProjectStatus } from '../../models/domain';
import type { TaskTreeNode } from '../../models/domain';
import { confirmDialog } from './confirmDialog';
import { formatDateDDMMYY, parseDDMMYY } from '../../utils/dateFormat';
import { attachDateRangePicker } from '../../utils/dateRangePicker';

export interface TaskDraft {
  id: string;
  dbId?: number;
  title: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  subtasks: TaskDraft[];
}

export interface AddProjectTaskTreeOptions {
  initialTasks: TaskDraft[];
  getDefaultDates: () => { start: string; end: string };
}

export interface AddProjectTaskTreeApi {
  container: HTMLElement;
  getTasks: () => TaskDraft[];
  setTasks: (tasks: TaskDraft[]) => void;
  refresh: () => void;
  addRootTask: () => void;
}

let draftIdCounter = 0;
function nextDraftId(): string {
  return `draft-${(draftIdCounter++).toString(36)}`;
}

function newTaskDraft(startDate: string, endDate: string): TaskDraft {
  return {
    id: nextDraftId(),
    title: '',
    startDate,
    endDate,
    status: 'NotStarted',
    priority: 'Medium',
    subtasks: [],
  };
}

/** Prefer storing ISO (YYYY-MM-DD) in drafts so formatDateDDMMYY(t.startDate) in templates displays correctly. */
function toDraftDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const iso = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = parseDDMMYY(formatDateDDMMYY(value));
  return parsed ?? fallback;
}

export function taskTreeToDrafts(
  nodes: TaskTreeNode[],
  defaultStart: string,
  defaultEnd: string,
): TaskDraft[] {
  return nodes.map((node) => ({
    id: nextDraftId(),
    dbId: node.id,
    title: node.title,
    startDate: toDraftDate(node.startDate, defaultStart),
    endDate: toDraftDate(node.endDate, defaultEnd),
    status: node.status,
    priority: node.priority,
    subtasks: taskTreeToDrafts(node.children, defaultStart, defaultEnd),
  }));
}

function replaceDraft(
  tasks: TaskDraft[],
  draftId: string,
  updater: (d: TaskDraft) => TaskDraft,
): TaskDraft[] {
  return tasks.map((t) => {
    if (t.id === draftId) return updater(t);
    return { ...t, subtasks: replaceDraft(t.subtasks, draftId, updater) };
  });
}

function removeDraft(tasks: TaskDraft[], draftId: string): TaskDraft[] {
  const filtered = tasks.filter((t) => t.id !== draftId);
  if (filtered.length !== tasks.length) return filtered;
  return tasks.map((t) => ({ ...t, subtasks: removeDraft(t.subtasks, draftId) }));
}

function findParent(
  tasks: TaskDraft[],
  draftId: string,
  parent: TaskDraft | null,
): TaskDraft | null | undefined {
  for (const t of tasks) {
    if (t.id === draftId) return parent;
    const found = findParent(t.subtasks, draftId, t);
    if (found !== undefined) return found;
  }
  return undefined;
}

function appendSubtask(tasks: TaskDraft[], parentId: string, draft: TaskDraft): TaskDraft[] {
  return tasks.map((t) => {
    if (t.id === parentId) {
      return { ...t, subtasks: [...t.subtasks, draft] };
    }
    return { ...t, subtasks: appendSubtask(t.subtasks, parentId, draft) };
  });
}

function findDraft(tasks: TaskDraft[], draftId: string): TaskDraft | undefined {
  for (const t of tasks) {
    if (t.id === draftId) return t;
    const found = findDraft(t.subtasks, draftId);
    if (found) return found;
  }
  return undefined;
}

function setDraftAndSubtasksDone(d: TaskDraft): TaskDraft {
  return { ...d, status: 'Done', subtasks: d.subtasks.map(setDraftAndSubtasksDone) };
}

function hasSubtaskDraftNotDone(d: TaskDraft): boolean {
  return d.subtasks.some(
    (st) => st.status !== 'Done' || hasSubtaskDraftNotDone(st),
  );
}

function formatDraftSubtaskListForConfirm(draft: TaskDraft): string {
  const lines: string[] = [];
  const format = (d: TaskDraft, depth: number) => {
    const prefix = depth > 0 ? '|__ '.repeat(depth) : '';
    const status = depth === 0 ? 'Done' : d.status;
    lines.push(prefix + `${d.title || 'Untitled'} (${status})`);
    for (const st of d.subtasks) {
      format(st, depth + 1);
    }
  };
  format({ ...draft, status: 'Done' }, 0);
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderTaskNode(t: TaskDraft, depth: number, collapsedIds: Set<string>): string {
  const hasSubtasks = t.subtasks.length > 0;
  const isCollapsed = hasSubtasks && collapsedIds.has(t.id);
  const childrenClass =
    hasSubtasks && isCollapsed
      ? 'add-project-task-children add-project-subtasks-collapsed'
      : 'add-project-task-children';
  const toggleAriaExpanded = hasSubtasks ? (isCollapsed ? 'false' : 'true') : undefined;
  const toggleLabel = isCollapsed ? 'Expand subtasks' : 'Collapse subtasks';
  const toggleIconSvg = isCollapsed
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const rowLabel = t.title?.trim() ? `Task: ${escapeHtml(t.title)}` : 'Task';

  return `
    <div class="add-project-task-node add-project-task-node--status-${t.status} add-project-task-node--priority-${t.priority}" data-draft-id="${t.id}" data-depth="${depth}" data-status="${t.status}" data-priority="${t.priority}" role="group" aria-label="${rowLabel}">
      <div class="add-project-task-row">
        <div class="add-project-task-row-line1">
          ${hasSubtasks ? `<button type="button" class="add-project-task-toggle-subtasks" data-action="toggle-subtasks" data-draft-id="${t.id}" aria-label="${toggleLabel}" aria-expanded="${toggleAriaExpanded}" title="${toggleLabel}">${toggleIconSvg}</button>` : '<span class="add-project-task-toggle-placeholder" aria-hidden="true"></span>'}
          <label class="add-project-task-title-wrap">
            <span class="visually-hidden">Task title</span>
            <input type="text" class="add-project-task-title" data-field="title" placeholder="Task title" value="${escapeHtml(t.title)}" autocomplete="off" />
          </label>
          <div class="add-project-task-actions" role="group" aria-label="Task actions">
            <button type="button" class="btn btn-small btn-ghost add-project-task-btn-add" data-action="add-subtask" aria-label="Add subtask"><span aria-hidden="true">+</span> Subtask</button>
            <button type="button" class="btn btn-small btn-ghost btn-danger add-project-task-btn-remove" data-action="remove" aria-label="Remove task">Remove</button>
          </div>
        </div>
        <div class="add-project-task-row-line2">
          <label class="add-project-task-date-wrap">
            <span class="visually-hidden">Start and end date</span>
            <input type="text" class="add-project-task-date add-project-task-date-range-display" placeholder="DD/MM/YY — DD/MM/YY" title="Dates" value="${formatDateDDMMYY(t.startDate)} — ${formatDateDDMMYY(t.endDate)}" autocomplete="off" />
          </label>
          <input type="hidden" data-field="startDate" value="${formatDateDDMMYY(t.startDate)}" />
          <input type="hidden" data-field="endDate" value="${formatDateDDMMYY(t.endDate)}" />
          <label class="add-project-task-status-wrap">
            <span class="visually-hidden">Status</span>
            <select class="add-project-task-status" data-field="status" aria-label="Status">
              <option value="NotStarted" ${t.status === 'NotStarted' ? 'selected' : ''}>Not started</option>
              <option value="InProgress" ${t.status === 'InProgress' ? 'selected' : ''}>In progress</option>
              <option value="Blocked" ${t.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
              <option value="Done" ${t.status === 'Done' ? 'selected' : ''}>Done</option>
            </select>
          </label>
          <label class="add-project-task-priority-wrap">
            <span class="visually-hidden">Priority</span>
            <select class="add-project-task-priority" data-field="priority" aria-label="Priority">
              <option value="Low" ${t.priority === 'Low' ? 'selected' : ''}>Low</option>
              <option value="Medium" ${t.priority === 'Medium' ? 'selected' : ''}>Medium</option>
              <option value="High" ${t.priority === 'High' ? 'selected' : ''}>High</option>
              <option value="Critical" ${t.priority === 'Critical' ? 'selected' : ''}>Critical</option>
            </select>
          </label>
        </div>
      </div>
      ${hasSubtasks ? `<div class="${childrenClass}">${t.subtasks.map((st) => renderTaskNode(st, depth + 1, collapsedIds)).join('')}</div>` : ''}
    </div>
  `;
}

const EMPTY_STATE_HTML = `
  <div class="add-project-empty-state" aria-live="polite">
    <div class="add-project-empty-state-icon" aria-hidden="true">📋</div>
    <p class="add-project-empty-state-text">No tasks yet</p>
    <p class="add-project-empty-state-hint">Add tasks to break down your project. You can add subtasks to any task.</p>
    <button type="button" class="btn add-project-empty-state-cta" data-action="add-first-task" aria-label="Add your first task">Add your first task</button>
  </div>
`;

function syncSelectValuesToDrafts(list: TaskDraft[], container: HTMLElement): void {
  list.forEach((d) => {
    const node = container.querySelector(`[data-draft-id="${d.id}"]`);
    if (!node) return;
    const statusSelect = node.querySelector<HTMLSelectElement>('select[data-field="status"]');
    const prioritySelect = node.querySelector<HTMLSelectElement>('select[data-field="priority"]');
    if (statusSelect) statusSelect.value = d.status;
    if (prioritySelect) prioritySelect.value = d.priority;
    if (d.subtasks.length) syncSelectValuesToDrafts(d.subtasks, container);
  });
}

/**
 * Creates the add-project task tree UI and returns the container plus API to get/set tasks and refresh.
 */
export function createAddProjectTaskTree(
  options: AddProjectTaskTreeOptions,
): AddProjectTaskTreeApi {
  const { initialTasks, getDefaultDates } = options;
  let tasks = [...initialTasks];
  const collapsedTaskIds = new Set<string>();

  const container = document.createElement('div');
  container.className = 'add-project-task-tree';

  function addRootTask(): void {
    const { start, end } = getDefaultDates();
    tasks = [...tasks, newTaskDraft(start, end)];
    refresh();
  }

  function refresh(): void {
    if (tasks.length === 0) {
      container.innerHTML = EMPTY_STATE_HTML;
      const emptyCta = container.querySelector<HTMLButtonElement>('[data-action="add-first-task"]');
      emptyCta?.addEventListener('click', addRootTask);
      return;
    }
    container.innerHTML = tasks.map((t) => renderTaskNode(t, 0, collapsedTaskIds)).join('');
    syncSelectValuesToDrafts(tasks, container);
    bindDatePickers();
  }

  function bindDatePickers(): void {
    container.querySelectorAll('[data-draft-id]').forEach((nodeEl) => {
      const node = nodeEl as HTMLElement;
      const displayEl = node.querySelector<HTMLInputElement>('.add-project-task-date-range-display');
      const startInput = node.querySelector<HTMLInputElement>('input[data-field="startDate"]');
      const endInput = node.querySelector<HTMLInputElement>('input[data-field="endDate"]');
      if (displayEl && startInput && endInput) {
        const draftId = node.getAttribute('data-draft-id')!;
        attachDateRangePicker(displayEl, startInput, endInput, {
          onRangeSelected: (startFormatted, endFormatted) => {
            tasks = replaceDraft(tasks, draftId, (d) => ({
              ...d,
              startDate: startFormatted,
              endDate: endFormatted,
            }));
          },
        });
      }
    });
  }

  container.addEventListener('input', async (e) => {
    const target = e.target as HTMLElement;
    const node = target.closest('[data-draft-id]') as HTMLElement | null;
    if (!node) return;
    const draftId = node.dataset.draftId!;
    const field = (target as HTMLInputElement | HTMLSelectElement).dataset.field as keyof TaskDraft;
    let value = (target as HTMLInputElement | HTMLSelectElement).value;
    if (field === 'startDate' || field === 'endDate') {
      const parsed = parseDDMMYY(value);
      if (parsed) value = parsed;
    }
    if (field === 'status' && value === 'Done') {
      const draft = findDraft(tasks, draftId);
      if (draft && hasSubtaskDraftNotDone(draft)) {
        const list = formatDraftSubtaskListForConfirm(draft);
        const taskName = draft.title?.trim() || 'Untitled';
        const confirmed = await confirmDialog({
          title: 'Set subtasks to Done?',
          message: `${list}\n\n${taskName} has subtasks. Set them all to Done as well?`,
          confirmLabel: 'Set all to Done',
        });
        if (confirmed) {
          tasks = replaceDraft(tasks, draftId, setDraftAndSubtasksDone);
          refresh();
          return;
        }
      }
    }
    tasks = replaceDraft(tasks, draftId, (d) => ({ ...d, [field]: value }));
  });

  container.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button[data-action]');
    if (!target) return;
    const node = (e.target as HTMLElement).closest('[data-draft-id]') as HTMLElement | null;
    const action = target.getAttribute('data-action');
    if (action === 'toggle-subtasks') {
      const draftId = target.getAttribute('data-draft-id');
      if (draftId) {
        if (collapsedTaskIds.has(draftId)) {
          collapsedTaskIds.delete(draftId);
        } else {
          collapsedTaskIds.add(draftId);
        }
        refresh();
      }
    } else if (action === 'add-subtask' && node) {
      const draftId = node.dataset.draftId!;
      const { start, end } = getDefaultDates();
      const newDraft = newTaskDraft(start, end);
      tasks = appendSubtask(tasks, draftId, newDraft);
      refresh();
    } else if (action === 'remove' && node) {
      const draftId = node.dataset.draftId!;
      const parent = findParent(tasks, draftId, null);
      if (parent === undefined) return;
      if (parent === null) {
        tasks = tasks.filter((t) => t.id !== draftId);
      } else {
        tasks = removeDraft(tasks, draftId);
      }
      refresh();
    }
  });

  function getTasks(): TaskDraft[] {
    return tasks;
  }

  function deepCloneDrafts(list: TaskDraft[]): TaskDraft[] {
    return list.map((d) => ({
      ...d,
      subtasks: deepCloneDrafts(d.subtasks),
    }));
  }

  function setTasks(newTasks: TaskDraft[]): void {
    tasks = deepCloneDrafts(newTasks);
  }

  refresh();
  return { container, getTasks, setTasks, refresh, addRootTask };
}
