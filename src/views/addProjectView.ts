import { TASK_MAX_LEVEL } from '../models/domain';
import type { ProjectPriority, ProjectStatus } from '../models/domain';
import { buildTaskTree } from '../models/domain';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
} from '../services/projectService';
import {
  createTask,
  listTasksForProject,
  updateTask,
  getTask,
  hasDescendantWithStatusNotDone,
  setDescendantsStatus,
  setAllTasksInProjectStatus,
  getTaskWithDescendantsTree,
  formatSubtaskListForConfirm,
} from '../services/taskService';
import { confirmDialog } from '../ui/components/confirmDialog';
import {
  createAddProjectTaskTree,
  taskTreeToDrafts,
  type TaskDraft,
} from '../ui/components/addProjectTaskTree';
import { goToHome } from '../router';
import { parseImportFile } from '../services/exportImportService';
import {
  formatDateDDMMYY,
  parseDDMMYY,
  dateOnlyToUtcIso,
  addDays,
  daysBetween,
} from '../utils/dateFormat';
import { attachDateRangePicker } from '../utils/dateRangePicker';

/**
 * Shift all task/subtask dates by the same number of days (from project start change).
 * Preserves duration; caps task end date to project end date if it would exceed.
 */
function shiftDraftDates(
  drafts: TaskDraft[],
  shiftDays: number,
  projectEndIso: string,
): TaskDraft[] {
  return drafts.map((d) => {
    const startIso = parseDDMMYY(d.startDate) ?? (d.startDate.length >= 10 ? d.startDate.slice(0, 10) : null);
    const endIso = parseDDMMYY(d.endDate) ?? (d.endDate.length >= 10 ? d.endDate.slice(0, 10) : null);
    if (!startIso || !endIso || !/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) {
      return {
        ...d,
        subtasks: shiftDraftDates(d.subtasks, shiftDays, projectEndIso),
      };
    }
    let newStart = addDays(startIso, shiftDays);
    let newEnd = addDays(endIso, shiftDays);
    if (newEnd > projectEndIso) newEnd = projectEndIso;
    if (newStart > newEnd) newStart = newEnd;
    return {
      ...d,
      startDate: newStart,
      endDate: newEnd,
      subtasks: shiftDraftDates(d.subtasks, shiftDays, projectEndIso),
    };
  });
}

function setDefaultDates(): { start: string; end: string } {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 30);
  return {
    start: today.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

function getMaxDraftLevel(list: TaskDraft[], level = 1): number {
  let maxLevel = 0;
  for (const draft of list) {
    maxLevel = Math.max(maxLevel, level);
    if (draft.subtasks.length > 0) {
      maxLevel = Math.max(maxLevel, getMaxDraftLevel(draft.subtasks, level + 1));
    }
  }
  return maxLevel;
}

function validateDraftDepth(list: TaskDraft[]): boolean {
  const maxLevel = getMaxDraftLevel(list);
  if (maxLevel > TASK_MAX_LEVEL) {
    alert(`Subtasks can only be nested up to ${TASK_MAX_LEVEL} levels.`);
    return false;
  }
  return true;
}

export async function renderAddProjectView(
  root: HTMLElement,
  editProjectId?: number,
) {
  let dates = setDefaultDates();
  let tasks: TaskDraft[] = [];
  let pageTitle = 'Add project';
  const metaPrefill = {
    name: '',
    description: '',
    startDate: dates.start,
    endDate: dates.end,
    status: 'NotStarted' as ProjectStatus,
    priority: 'Medium' as ProjectPriority,
  };

  if (editProjectId != null) {
    const project = await getProject(editProjectId);
    if (!project) {
      goToHome();
      return;
    }
    pageTitle = 'Edit project';
    metaPrefill.name = project.name;
    metaPrefill.description = project.description ?? '';
    metaPrefill.startDate = formatDateDDMMYY(project.startDate);
    metaPrefill.endDate = formatDateDDMMYY(project.endDate);
    metaPrefill.status = project.status;
    metaPrefill.priority = project.priority;
    dates = { start: metaPrefill.startDate, end: metaPrefill.endDate };
    const tasksRaw = await listTasksForProject(editProjectId);
    tasks = taskTreeToDrafts(buildTaskTree(tasksRaw), dates.start, dates.end);
  }

  async function createTasksRecursive(
    projectId: number,
    list: TaskDraft[],
    parentDbId: number | null,
  ): Promise<void> {
    for (const d of list) {
      const startIso = d.startDate ? (parseDDMMYY(d.startDate) ?? d.startDate) : undefined;
      const endIso = d.endDate ? (parseDDMMYY(d.endDate) ?? d.endDate) : undefined;
      const payload = {
        title: d.title.trim() || 'Untitled task',
        startDate: startIso ? dateOnlyToUtcIso(startIso) : undefined,
        endDate: endIso ? dateOnlyToUtcIso(endIso) : undefined,
        status: d.status,
        priority: d.priority,
      };
      let resolvedId: number;
      let setDescendantsDoneAfterRecurse = false;
      if (d.dbId != null) {
        if (payload.status === 'Done') {
          const hasSubtasksNotDone = await hasDescendantWithStatusNotDone(d.dbId);
          if (hasSubtasksNotDone) {
            const tree = await getTaskWithDescendantsTree(d.dbId);
            const list = tree ? formatSubtaskListForConfirm(tree) : '';
            const taskName = tree?.title?.trim() || d.title?.trim() || 'Untitled';
            const confirmed = await confirmDialog({
              title: 'Set subtasks to Done?',
              message: list ? `${list}\n\n${taskName} has subtasks. Set them all to Done as well?` : 'This task has subtasks. Set them all to Done as well?',
              confirmLabel: 'Set all to Done',
            });
            if (!confirmed) {
              const existing = await getTask(d.dbId);
              await updateTask(d.dbId, { ...payload, status: existing!.status });
            } else {
              await updateTask(d.dbId, payload);
              setDescendantsDoneAfterRecurse = true;
            }
          } else {
            await updateTask(d.dbId, payload);
          }
        } else {
          await updateTask(d.dbId, payload);
        }
        resolvedId = d.dbId;
      } else {
        const created = await createTask({
          projectId,
          parentId: parentDbId,
          ...payload,
        });
        resolvedId = created.id;
      }
      if (d.subtasks.length) {
        await createTasksRecursive(projectId, d.subtasks, resolvedId);
      }
      if (setDescendantsDoneAfterRecurse && d.dbId != null) {
        await setDescendantsStatus(d.dbId, 'Done');
      }
    }
  }

  root.innerHTML = `
    <div class="app-shell add-project-shell project-details-shell">
      <main class="app-main project-details-main add-project-main">
        <div class="project-details-title-row">
          <div class="project-details-app-bar-left">
            <button type="button" class="btn btn-link project-details-app-bar-back" id="appbar-back" aria-label="Go back">\u2039</button>
            <h1 class="project-details-name" id="add-project-title">${escapeHtml(pageTitle)}</h1>
          </div>
          <div class="project-details-app-bar-right">
            <div class="project-details-title-primary-actions">
              <button type="button" class="btn" id="add-project-save">Save</button>
              <button type="button" class="btn btn-secondary" id="add-project-save-exit">Save & Exit</button>
            </div>
            <div class="project-details-title-menu">
              <button type="button" class="btn btn-link project-details-title-menu-button" id="add-project-more-actions" aria-haspopup="menu" aria-expanded="false" aria-controls="add-project-more-menu">\u22ef</button>
              <div class="project-details-title-menu-list" id="add-project-more-menu" role="menu" hidden>
                ${editProjectId == null ? '<input type="file" accept=".json,application/json" id="add-project-import-input" style="display:none" aria-hidden="true" /><button type="button" class="btn btn-secondary" id="add-project-import" role="menuitem">Import</button>' : ''}
                ${editProjectId != null ? '<button type="button" class="btn btn-secondary add-project-action-archive" id="add-project-archive" role="menuitem">Archive</button><button type="button" class="btn btn-danger" id="add-project-delete" role="menuitem">Delete</button>' : ''}
              </div>
            </div>
          </div>
        </div>
        <div class="project-details-columns">
          <aside class="project-details-col-meta">
            <p class="project-details-meta-caption" aria-hidden="true">Project info</p>
            <form class="add-project-form add-project-meta-form" id="add-project-meta-form">
              <section class="add-project-section add-project-meta">
                <label>
                  <span>Project name</span>
                  <input name="name" type="text" id="add-project-name" class="add-project-name-h1" required placeholder="Project name" value="${escapeHtml(metaPrefill.name)}" />
                </label>
                <label>
                  <span>Dates</span>
                  <input type="text" id="add-project-meta-date-range-display" placeholder="DD/MM/YY — DD/MM/YY" value="${metaPrefill.startDate} — ${metaPrefill.endDate}" />
                  <input name="startDate" type="hidden" />
                  <input name="endDate" type="hidden" />
                </label>
                <label>
                  <span>Status</span>
                  <select name="status">
                    <option value="NotStarted" ${metaPrefill.status === 'NotStarted' ? 'selected' : ''}>Not started</option>
                    <option value="InProgress" ${metaPrefill.status === 'InProgress' ? 'selected' : ''}>In progress</option>
                    <option value="Blocked" ${metaPrefill.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
                    <option value="Done" ${metaPrefill.status === 'Done' ? 'selected' : ''}>Done</option>
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <select name="priority">
                    <option value="Low" ${metaPrefill.priority === 'Low' ? 'selected' : ''}>Low</option>
                    <option value="Medium" ${metaPrefill.priority === 'Medium' ? 'selected' : ''}>Medium</option>
                    <option value="High" ${metaPrefill.priority === 'High' ? 'selected' : ''}>High</option>
                    <option value="Critical" ${metaPrefill.priority === 'Critical' ? 'selected' : ''}>Critical</option>
                  </select>
                </label>
                <label>
                  <span>Description</span>
                  <textarea name="description" rows="3" placeholder="Optional description">${escapeHtml(metaPrefill.description)}</textarea>
                </label>
              </section>
            </form>
          </aside>
          <div class="project-details-tasks-section">
            <p class="project-details-meta-caption" aria-hidden="true">Project tasks</p>
            <div class="add-project-tasks-header">
              <button type="button" class="btn" id="add-project-add-task">Add task</button>
            </div>
            <div class="add-project-task-tree-placeholder"></div>
          </div>
        </div>
      </main>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#appbar-back')?.addEventListener(
    'click',
    () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        goToHome();
      }
    },
  );

  const moreBtn = root.querySelector<HTMLButtonElement>('#add-project-more-actions');
  const moreMenu = root.querySelector<HTMLElement>('#add-project-more-menu');
  const moreWrap = root.querySelector<HTMLElement>('.project-details-title-menu');
  const closeMoreMenu = () => {
    if (!moreBtn || !moreMenu) return;
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
  };
  moreBtn?.addEventListener('click', () => {
    if (!moreBtn || !moreMenu) return;
    const next = moreMenu.hidden;
    moreMenu.hidden = !next;
    moreBtn.setAttribute('aria-expanded', String(next));
  });
  root.addEventListener('click', (event) => {
    if (!moreWrap?.contains(event.target as Node)) {
      closeMoreMenu();
    }
  });
  moreMenu?.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => closeMoreMenu());
  });

  const metaForm = root.querySelector<HTMLFormElement>('#add-project-meta-form')!;
  const saveBtn = root.querySelector<HTMLButtonElement>('#add-project-save')!;
  const saveExitBtn = root.querySelector<HTMLButtonElement>('#add-project-save-exit')!;
  const addTaskBtn = root.querySelector<HTMLButtonElement>('#add-project-add-task')!;

  const metaStartInput = metaForm.elements.namedItem('startDate') as HTMLInputElement;
  const metaEndInput = metaForm.elements.namedItem('endDate') as HTMLInputElement;
  // dates may be ISO (new project) or already DD/MM/YY (edit mode); keep DD/MM/YY as-is so hidden inputs submit correctly
  metaStartInput.value = parseDDMMYY(dates.start) ? dates.start : formatDateDDMMYY(dates.start);
  metaEndInput.value = parseDDMMYY(dates.end) ? dates.end : formatDateDDMMYY(dates.end);
  const metaDisplayEl = root.querySelector<HTMLInputElement>('#add-project-meta-date-range-display')!;
  attachDateRangePicker(metaDisplayEl, metaStartInput, metaEndInput);

  const getDefaultDates = () => {
    const startEl = metaForm.elements.namedItem('startDate') as HTMLInputElement;
    const endEl = metaForm.elements.namedItem('endDate') as HTMLInputElement;
    const start = parseDDMMYY(startEl?.value ?? '') ?? startEl?.value ?? dates.start;
    const end = parseDDMMYY(endEl?.value ?? '') ?? endEl?.value ?? dates.end;
    return { start, end };
  };
  const taskTree = createAddProjectTaskTree({
    initialTasks: tasks,
    getDefaultDates,
  });
  const placeholder = root.querySelector<HTMLDivElement>('.add-project-task-tree-placeholder')!;
  placeholder.replaceWith(taskTree.container);

  let savedProjectId: number | null = editProjectId ?? null;

  function readMeta(): { name: string; description?: string; startDate: string; endDate: string; status: ProjectStatus; priority: ProjectPriority } | null {
    const data = new FormData(metaForm);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return null;
    const rawStart = String(data.get('startDate') ?? '');
    const rawEnd = String(data.get('endDate') ?? '');
    const startDate = parseDDMMYY(rawStart);
    const endDate = parseDDMMYY(rawEnd);
    if (!startDate || !endDate) {
      alert('Please enter dates in DD/MM/YY format (e.g. 14/03/25).');
      return null;
    }
    return {
      name,
      description: String(data.get('description') ?? '').trim() || undefined,
      startDate,
      endDate,
      status: (data.get('status') as ProjectStatus) ?? 'NotStarted',
      priority: (data.get('priority') as ProjectPriority) ?? 'Medium',
    };
  }

  /** If project dates changed in edit mode, ask to auto-update task dates and apply shift. Updates `dates` and task tree when confirmed. */
  async function applyProjectDateChangeIfConfirmed(meta: {
    startDate: string;
    endDate: string;
  }): Promise<void> {
    if (savedProjectId == null) return;
    const oldStartIso = parseDDMMYY(dates.start) ?? dates.start.slice(0, 10);
    const oldEndIso = parseDDMMYY(dates.end) ?? dates.end.slice(0, 10);
    const datesChanged =
      meta.startDate !== oldStartIso || meta.endDate !== oldEndIso;
    const taskList = taskTree.getTasks();
    const hasTasks = taskList.length > 0;
    if (!datesChanged || !hasTasks) return;

    const confirmed = await confirmDialog({
      title: 'Update task dates?',
      message:
        'Project dates have changed. Auto-update task and subtask dates to follow the new project range? ' +
        'Tasks will be shifted by the same number of days; if a task would end after the new project end date, its end date will be set to the project end date.',
      confirmLabel: 'Yes, update task dates',
    });
    if (!confirmed) return;

    const shiftDays = daysBetween(oldStartIso, meta.startDate);
    taskTree.setTasks(shiftDraftDates(taskList, shiftDays, meta.endDate));
    taskTree.refresh();
    dates = {
      start: formatDateDDMMYY(meta.startDate),
      end: formatDateDDMMYY(meta.endDate),
    };
  }

  saveBtn.addEventListener('click', async () => {
    const meta = readMeta();
    if (!meta) return;
    await applyProjectDateChangeIfConfirmed(meta);
    if (!validateDraftDepth(taskTree.getTasks())) return;
    const originalSaveText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    saveBtn.textContent = 'Saving…';
    try {
      if (savedProjectId != null) {
        await updateProject(savedProjectId, {
          name: meta.name,
          description: meta.description,
          startDate: dateOnlyToUtcIso(meta.startDate),
          endDate: dateOnlyToUtcIso(meta.endDate),
          status: meta.status,
          priority: meta.priority,
        });
      } else {
        const project = await createProject({
          name: meta.name,
          description: meta.description,
          startDate: dateOnlyToUtcIso(meta.startDate),
          endDate: dateOnlyToUtcIso(meta.endDate),
          status: meta.status,
          priority: meta.priority,
        });
        savedProjectId = project.id;
      }
      await createTasksRecursive(savedProjectId!, taskTree.getTasks(), null);
      const tasksRaw = await listTasksForProject(savedProjectId!);
      taskTree.setTasks(taskTreeToDrafts(buildTaskTree(tasksRaw), meta.startDate, meta.endDate));
      taskTree.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      saveBtn.disabled = false;
      saveBtn.removeAttribute('aria-busy');
      saveBtn.textContent = originalSaveText!;
    }
  });

  const saveExitOriginalContent = saveExitBtn.innerHTML;
  saveExitBtn.addEventListener('click', async () => {
    const meta = readMeta();
    if (!meta) return;
    await applyProjectDateChangeIfConfirmed(meta);
    if (!validateDraftDepth(taskTree.getTasks())) return;
    const payloadStart = dateOnlyToUtcIso(meta.startDate);
    const payloadEnd = dateOnlyToUtcIso(meta.endDate);
    saveExitBtn.disabled = true;
    saveExitBtn.setAttribute('aria-busy', 'true');
    saveExitBtn.innerHTML =
      '<span class="add-project-btn-loading-spinner" aria-hidden="true"></span>Saving…';
    try {
      if (savedProjectId != null) {
        await updateProject(savedProjectId, {
          name: meta.name,
          description: meta.description,
          startDate: payloadStart,
          endDate: payloadEnd,
          status: meta.status,
          priority: meta.priority,
        });
        await createTasksRecursive(savedProjectId, taskTree.getTasks(), null);
      } else {
        const project = await createProject({
          name: meta.name,
          description: meta.description,
          startDate: dateOnlyToUtcIso(meta.startDate),
          endDate: dateOnlyToUtcIso(meta.endDate),
          status: meta.status,
          priority: meta.priority,
        });
        savedProjectId = project.id;
        await createTasksRecursive(savedProjectId, taskTree.getTasks(), null);
      }
      window.history.back();
    } catch (err) {
      saveExitBtn.disabled = false;
      saveExitBtn.removeAttribute('aria-busy');
      saveExitBtn.innerHTML = saveExitOriginalContent;
      alert(err instanceof Error ? err.message : 'Failed to save');
      return;
    }
    saveExitBtn.disabled = false;
    saveExitBtn.removeAttribute('aria-busy');
    saveExitBtn.innerHTML = saveExitOriginalContent;
  });

  if (editProjectId != null) {
    const archiveBtn = root.querySelector<HTMLButtonElement>('#add-project-archive');
    const deleteBtn = root.querySelector<HTMLButtonElement>('#add-project-delete');
    archiveBtn?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Archive project',
        message: 'Set this project and all its tasks to Done?',
        confirmLabel: 'Archive',
      });
      if (!confirmed) return;
      archiveBtn.disabled = true;
      try {
        await updateProject(editProjectId, { status: 'Done' });
        await setAllTasksInProjectStatus(editProjectId, 'Done');
        goToHome();
      } finally {
        archiveBtn.disabled = false;
      }
    });
    deleteBtn?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Delete project',
        message: 'Permanently delete this project and all its tasks?',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!confirmed) return;
      deleteBtn.disabled = true;
      try {
        await deleteProject(editProjectId);
        goToHome();
      } finally {
        deleteBtn.disabled = false;
      }
    });
  }

  addTaskBtn.addEventListener('click', () => taskTree.addRootTask());

  if (editProjectId == null) {
    const importBtn = root.querySelector<HTMLButtonElement>('#add-project-import');
    const importInput = root.querySelector<HTMLInputElement>('#add-project-import-input');
    importBtn?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        importInput.value = '';
        try {
          const { project, tasks } = parseImportFile(text);
          const startFormatted = formatDateDDMMYY(project.startDate);
          const endFormatted = formatDateDDMMYY(project.endDate);
          (metaForm.elements.namedItem('name') as HTMLInputElement).value = project.name;
          (metaForm.elements.namedItem('description') as HTMLTextAreaElement).value = project.description ?? '';
          (metaForm.elements.namedItem('status') as HTMLSelectElement).value = project.status;
          (metaForm.elements.namedItem('priority') as HTMLSelectElement).value = project.priority;
          metaStartInput.value = startFormatted;
          metaEndInput.value = endFormatted;
          metaDisplayEl.value = `${startFormatted} — ${endFormatted}`;
          const drafts = taskTreeToDrafts(buildTaskTree(tasks), startFormatted, endFormatted);
          if (!validateDraftDepth(drafts)) {
            return;
          }
          taskTree.setTasks(drafts);
          taskTree.refresh();
        } catch {
          alert('Invalid or unsupported export file.');
        }
      };
      reader.readAsText(file);
    });
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
