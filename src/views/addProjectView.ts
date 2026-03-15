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
import { formatDateDDMMYY, parseDDMMYY } from '../utils/dateFormat';
import { attachDateRangePicker } from '../utils/dateRangePicker';

function setDefaultDates(): { start: string; end: string } {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 30);
  return {
    start: today.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
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
        startDate: startIso ? new Date(startIso + 'T00:00:00').toISOString() : undefined,
        endDate: endIso ? new Date(endIso + 'T00:00:00').toISOString() : undefined,
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

  const metaVisible = localStorage.getItem('project-details-meta-visible') !== 'false';
  const shellClass = metaVisible
    ? 'app-shell add-project-shell project-details-shell'
    : 'app-shell add-project-shell project-details-shell meta-hidden';

  root.innerHTML = `
    <div class="${shellClass}">
      <main class="app-main project-details-main add-project-main">
        <div class="project-details-title-row">
          <h1 class="project-details-name" id="add-project-title">${escapeHtml(pageTitle)}</h1>
        </div>
        <div class="project-details-columns">
          <aside class="project-details-col-meta">
            <div class="project-details-col-meta-header">
              <p class="project-details-meta-caption" aria-hidden="true">Project info</p>
              <button type="button" class="btn btn-link project-details-expand-meta" id="add-project-expand-meta" aria-label="Show project details" aria-expanded="${!metaVisible}">\u203A</button>
            </div>
            <div class="project-details-col-meta-content">
              <form class="add-project-form add-project-meta-form" id="add-project-meta-form">
                <section class="add-project-section add-project-meta">
                  <label>
                    <span>Project name</span>
                    <input name="name" type="text" id="add-project-name" class="add-project-name-h1" required placeholder="Project name" value="${escapeHtml(metaPrefill.name)}" />
                  </label>
                  <label>
                    <span>Description</span>
                    <textarea name="description" rows="3" placeholder="Optional description">${escapeHtml(metaPrefill.description)}</textarea>
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
                    <span>Dates</span>
                    <input type="text" id="add-project-meta-date-range-display" placeholder="DD/MM/YY — DD/MM/YY" value="${metaPrefill.startDate} — ${metaPrefill.endDate}" />
                    <input name="startDate" type="hidden" />
                    <input name="endDate" type="hidden" />
                  </label>
                </section>
              </form>
            </div>
            <div class="project-details-col-meta-actions">
              ${editProjectId == null ? '<input type="file" accept=".json,application/json" id="add-project-import-input" style="display:none" aria-hidden="true" /><button type="button" class="btn btn-secondary" id="add-project-import">Import</button>' : ''}
              <button type="button" class="btn" id="add-project-save">Save</button>
              <button type="button" class="btn btn-secondary" id="add-project-save-exit">Save & Exit</button>
              ${editProjectId != null ? '<button type="button" class="btn btn-secondary add-project-action-archive" id="add-project-archive">Archive</button><button type="button" class="btn btn-danger" id="add-project-delete">Delete</button>' : ''}
            </div>
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

  const shell = root.querySelector<HTMLElement>('.project-details-shell');
  const expandMetaBtn = root.querySelector<HTMLButtonElement>('#add-project-expand-meta');

  const setCollapsed = (collapsed: boolean) => {
    if (collapsed) {
      shell?.classList.add('meta-hidden');
      localStorage.setItem('project-details-meta-visible', 'false');
    } else {
      shell?.classList.remove('meta-hidden');
      localStorage.setItem('project-details-meta-visible', 'true');
    }
    expandMetaBtn?.setAttribute('aria-expanded', String(collapsed));
  };

  expandMetaBtn?.addEventListener('click', () => setCollapsed(false));

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
    const startDate = parseDDMMYY(String(data.get('startDate') ?? ''));
    const endDate = parseDDMMYY(String(data.get('endDate') ?? ''));
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

  saveBtn.addEventListener('click', async () => {
    const meta = readMeta();
    if (!meta) return;
    const originalSaveText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    saveBtn.textContent = 'Saving…';
    try {
      if (savedProjectId != null) {
        await updateProject(savedProjectId, {
          name: meta.name,
          description: meta.description,
          startDate: new Date(meta.startDate + 'T00:00:00').toISOString(),
          endDate: new Date(meta.endDate + 'T00:00:00').toISOString(),
          status: meta.status,
          priority: meta.priority,
        });
      } else {
        const project = await createProject({
          name: meta.name,
          description: meta.description,
          startDate: new Date(meta.startDate + 'T00:00:00').toISOString(),
          endDate: new Date(meta.endDate + 'T00:00:00').toISOString(),
          status: meta.status,
          priority: meta.priority,
        });
        savedProjectId = project.id;
      }
      await createTasksRecursive(savedProjectId!, taskTree.getTasks(), null);
      const tasksRaw = await listTasksForProject(savedProjectId!);
      taskTree.setTasks(taskTreeToDrafts(buildTaskTree(tasksRaw), meta.startDate, meta.endDate));
      taskTree.refresh();
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
    saveExitBtn.disabled = true;
    saveExitBtn.setAttribute('aria-busy', 'true');
    saveExitBtn.innerHTML =
      '<span class="add-project-btn-loading-spinner" aria-hidden="true"></span>Saving…';
    try {
      if (savedProjectId != null) {
        await updateProject(savedProjectId, {
          name: meta.name,
          description: meta.description,
          startDate: new Date(meta.startDate + 'T00:00:00').toISOString(),
          endDate: new Date(meta.endDate + 'T00:00:00').toISOString(),
          status: meta.status,
          priority: meta.priority,
        });
        await createTasksRecursive(savedProjectId, taskTree.getTasks(), null);
      } else {
        const project = await createProject({
          name: meta.name,
          description: meta.description,
          startDate: new Date(meta.startDate + 'T00:00:00').toISOString(),
          endDate: new Date(meta.endDate + 'T00:00:00').toISOString(),
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
