import { getProject, cloneProject } from '../services/projectService';
import {
  listTasksForProject,
  updateTask,
  hasDescendantWithStatusNotDone,
  setDescendantsStatus,
  getTaskWithDescendantsTree,
  formatSubtaskListForConfirm,
} from '../services/taskService';
import {
  exportProjectToJson,
  downloadJson,
} from '../services/exportImportService';
import type { Task, ProjectPriority } from '../models/domain';
import { goToHome, goToEditProject, goToProject } from '../router';
import { formatDateDDMMYY } from '../utils/dateFormat';

const KANBAN_STATUSES = ['NotStarted', 'InProgress', 'Done'] as const;

/** Inline SVG: priority icon (exclamation in circle — “needs attention”), colored via currentColor. */
function priorityIconSvg(priority: ProjectPriority): string {
  return `<svg class="kanban-card-priority-icon kanban-card-priority-${priority}" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5.25"/><path d="M7 4.5v3M7 9v.5"/></svg>`;
}

/** Inline SVG: subtasks / list indicator. */
function subtasksIconSvg(): string {
  return `<svg class="kanban-card-subtasks-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 3h8M2 7h8M2 11h5"/><path d="M11 5v6M9 7l2-2 2 2"/></svg>`;
}

/** Inline SVG: blocked status (circle with slash). */
function blockedIconSvg(): string {
  return `<svg class="kanban-card-blocked-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5.25"/><path d="M3.5 3.5l7 7"/></svg>`;
}

/** Inline SVG: late indicator (clock / overdue). */
function lateIconSvg(): string {
  return `<svg class="kanban-card-late-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5.25"/><path d="M7 3.5v3.5l2.5 2.5"/></svg>`;
}

/** Returns today's date as YYYY-MM-DD for comparison with task startDate. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type KanbanStatus = (typeof KANBAN_STATUSES)[number];

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function statusLabel(s: string): string {
  const labels: Record<string, string> = {
    NotStarted: 'Not started',
    InProgress: 'In progress',
    Blocked: 'Blocked',
    Done: 'Done',
  };
  return labels[s] ?? s;
}

function priorityLabel(p: string): string {
  const labels: Record<string, string> = {
    Low: 'Low',
    Medium: 'Medium',
    High: 'High',
    Critical: 'Critical',
  };
  return labels[p] ?? p;
}

function groupTasksByKanbanStatus(tasks: Task[]): Record<KanbanStatus, Task[]> {
  const groups: Record<KanbanStatus, Task[]> = {
    NotStarted: [],
    InProgress: [],
    Done: [],
  };
  for (const task of tasks) {
    const status: KanbanStatus =
      task.status === 'Blocked' ? 'NotStarted' : task.status;
    if (groups[status]) {
      groups[status].push(task);
    }
  }
  for (const status of KANBAN_STATUSES) {
    groups[status].sort((a, b) => a.order - b.order);
  }
  return groups;
}

function hasSubtasks(taskId: number, allTasks: Task[]): boolean {
  return allTasks.some((t) => t.parentId === taskId);
}

function renderKanbanColumn(
  status: KanbanStatus,
  tasks: Task[],
  allTasks: Task[],
): string {
  const label = statusLabel(status);
  const cardsHtml = tasks
    .map(
      (t) => {
        const subtasks = hasSubtasks(t.id, allTasks);
        const priorityTitle = priorityLabel(t.priority);
        const showPriority = t.priority === 'High' || t.priority === 'Critical';
        const isBlocked = t.status === 'Blocked';
        const isLate =
          t.status === 'NotStarted' &&
          t.startDate != null &&
          t.startDate.trim() !== '' &&
          t.startDate < todayIso();
        const metaIcons = [
          isBlocked ? `<span class="kanban-card-blocked" title="Blocked">${blockedIconSvg()}</span>` : '',
          isLate ? `<span class="kanban-card-late" title="Late (start date passed)">${lateIconSvg()}</span>` : '',
          showPriority ? `<span class="kanban-card-priority" title="${escapeHtml(priorityTitle)} priority">${priorityIconSvg(t.priority)}</span>` : '',
          subtasks ? `<span class="kanban-card-subtasks" title="Has subtasks">${subtasksIconSvg()}</span>` : '',
        ].filter(Boolean).join('');
        const statusPart = isBlocked ? ', blocked' : '';
        const latePart = isLate ? ', late' : '';
        const priorityMod = t.priority === 'High' ? ' kanban-card--priority-high' : t.priority === 'Critical' ? ' kanban-card--priority-critical' : '';
        const cardClass = `kanban-card${isBlocked ? ' kanban-card--blocked' : ''}${isLate ? ' kanban-card--late' : ''}${priorityMod}`;
        return `
        <div class="${cardClass}" draggable="true" data-task-id="${t.id}" aria-label="Task: ${escapeHtml(t.title)}${statusPart}${latePart}${subtasks ? ', has subtasks' : ''}, priority ${priorityTitle}">
          <span class="kanban-card-title">${escapeHtml(t.title)}</span>
          ${metaIcons ? `<span class="kanban-card-meta">${metaIcons}</span>` : ''}
        </div>
      `;
      },
    )
    .join('');
  const emptyState =
    tasks.length === 0
      ? '<p class="kanban-empty">No tasks</p>'
      : '';
  return `
    <div class="kanban-column" data-status="${status}" aria-label="${escapeHtml(label)}, drop zone">
      <h3 class="kanban-column-title">${escapeHtml(label)}</h3>
      <div class="kanban-drop-zone" data-status="${status}">
        ${cardsHtml}
        ${emptyState}
      </div>
    </div>
  `;
}

export async function renderProjectDetailsView(
  root: HTMLElement,
  projectId: number,
) {
  const project = await getProject(projectId);
  if (!project) {
    root.innerHTML = `<div class="app-shell"><main class="app-main"><p>Project not found.</p><button class="btn" id="back-home">Back</button></main></div>`;
    root.querySelector<HTMLButtonElement>('#back-home')?.addEventListener(
      'click',
      () => goToHome(),
    );
    return;
  }

  const tasks = await listTasksForProject(projectId);
  const byStatus = groupTasksByKanbanStatus(tasks);

  const startDateFormatted = formatDateDDMMYY(project.startDate);
  const endDateFormatted = formatDateDDMMYY(project.endDate);
  const datesRange =
    startDateFormatted === endDateFormatted
      ? startDateFormatted
      : `${startDateFormatted} – ${endDateFormatted}`;
  const hasDescription = project.description != null && project.description.trim() !== '';

  const kanbanHtml = KANBAN_STATUSES.map((s) =>
    renderKanbanColumn(s, byStatus[s], tasks),
  ).join('');

  const metaVisible =
    localStorage.getItem('project-details-meta-visible') !== 'false';
  const shellClass = metaVisible
    ? 'app-shell project-details-shell'
    : 'app-shell project-details-shell meta-hidden';

  root.innerHTML = `
    <div class="${shellClass}">
      <main class="app-main project-details-main">
        <div class="project-details-title-row">
          <div class="project-details-app-bar-left">
            <button type="button" class="btn btn-link project-details-app-bar-back" id="appbar-back" aria-label="Go back">\u2039</button>
            <h1 class="project-details-name" id="project-details-title">${escapeHtml(project.name)}</h1>
          </div>
          <div class="project-details-app-bar-right">
            <div class="project-details-title-primary-actions">
              <button type="button" class="btn" id="edit-project">Edit</button>
              <button type="button" class="btn" id="clone-project">Clone</button>
            </div>
            <div class="project-details-title-menu">
              <button type="button" class="btn btn-link project-details-title-menu-button" id="project-more-actions" aria-haspopup="menu" aria-expanded="false" aria-controls="project-more-menu">\u22ef</button>
              <div class="project-details-title-menu-list" id="project-more-menu" role="menu" hidden>
                <button type="button" class="btn btn-secondary" id="export-project" role="menuitem">Export</button>
              </div>
            </div>
          </div>
        </div>
        <div class="project-details-columns">
          <aside class="project-details-col-meta project-details-readonly">
            <div class="project-details-col-meta-header">
              <p class="project-details-meta-caption" aria-hidden="true">Project info</p>
              <button type="button" class="btn btn-link project-details-expand-meta" id="expand-meta" aria-label="Show project details" aria-expanded="${!metaVisible}">\u203A</button>
            </div>
            <div class="project-details-col-meta-content">
              <dl class="project-details-dl">
                <dt>Dates</dt>
                <dd>${datesRange}</dd>
                <dt>Status</dt>
                <dd><span class="badge badge-status-${project.status}">${statusLabel(project.status)}</span></dd>
                <dt>Priority</dt>
                <dd><span class="badge badge-priority-${project.priority}">${priorityLabel(project.priority)}</span></dd>
                ${hasDescription ? `<dt>Description</dt><dd class="project-details-desc">${escapeHtml(project.description!.trim())}</dd>` : ''}
              </dl>
            </div>
            <button type="button" class="btn btn-link project-details-toggle-meta" id="toggle-meta" aria-label="Hide project details" aria-expanded="${metaVisible}">\u2039</button>
          </aside>
          <div class="project-details-tasks-section">
            <p class="project-details-meta-caption" aria-hidden="true">Project tasks</p>
            <div class="project-details-kanban">
              ${kanbanHtml}
            </div>
          </div>
        </div>
      </main>
    </div>
  `;

  const shell = root.querySelector<HTMLElement>('.project-details-shell');
  const toggleMetaBtn = root.querySelector<HTMLButtonElement>('#toggle-meta');
  const expandMetaBtn = root.querySelector<HTMLButtonElement>('#expand-meta');

  const setCollapsed = (collapsed: boolean) => {
    if (collapsed) {
      shell?.classList.add('meta-hidden');
      localStorage.setItem('project-details-meta-visible', 'false');
    } else {
      shell?.classList.remove('meta-hidden');
      localStorage.setItem('project-details-meta-visible', 'true');
    }
    toggleMetaBtn?.setAttribute('aria-expanded', String(!collapsed));
    expandMetaBtn?.setAttribute('aria-expanded', String(collapsed));
  };

  toggleMetaBtn?.addEventListener('click', () => setCollapsed(true));
  expandMetaBtn?.addEventListener('click', () => setCollapsed(false));


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

  const moreBtn = root.querySelector<HTMLButtonElement>('#project-more-actions');
  const moreMenu = root.querySelector<HTMLElement>('#project-more-menu');
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

  root.querySelector<HTMLButtonElement>('#edit-project')?.addEventListener(
    'click',
    () => goToEditProject(projectId),
  );

  const cloneBtn = root.querySelector<HTMLButtonElement>('#clone-project');
  cloneBtn?.addEventListener('click', async () => {
    if (!cloneBtn) return;
    const originalText = cloneBtn.textContent;
    cloneBtn.disabled = true;
    cloneBtn.textContent = 'Cloning…';
    try {
      const newProject = await cloneProject(projectId);
      goToProject(newProject.id);
    } catch (err) {
      cloneBtn.disabled = false;
      cloneBtn.textContent = originalText;
      alert(err instanceof Error ? err.message : 'Failed to clone project');
    }
  });

  const exportBtn = root.querySelector<HTMLButtonElement>('#export-project');
  exportBtn?.addEventListener('click', async () => {
    if (!exportBtn) return;
    const originalText = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting…';
    try {
      const jsonString = await exportProjectToJson(projectId);
      const sanitized = project.name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-|-$/g, '') || 'project';
      downloadJson(`${sanitized}-export.json`, jsonString);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export project');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = originalText!;
    }
  });

  attachKanbanDragDrop(root, projectId);
}

function attachKanbanDragDrop(root: HTMLElement, projectId: number): void {
  const cards = root.querySelectorAll<HTMLElement>('.kanban-card');
  const dropZones = root.querySelectorAll<HTMLElement>('.kanban-drop-zone');

  cards.forEach((card) => {
    card.addEventListener('dragstart', (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const id = card.getAttribute('data-task-id');
      if (id) e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('kanban-card-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('kanban-card-dragging');
      dropZones.forEach((z) => z.classList.remove('kanban-drop-zone-over'));
    });
  });

  dropZones.forEach((zone) => {
    zone.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      zone.classList.add('kanban-drop-zone-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('kanban-drop-zone-over');
    });
    zone.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      zone.classList.remove('kanban-drop-zone-over');
      const taskIdStr = e.dataTransfer?.getData('text/plain');
      const newStatus = zone.getAttribute('data-status') as KanbanStatus | null;
      if (!taskIdStr || !newStatus) return;
      const taskId = Number(taskIdStr);
      try {
        if (newStatus === 'Done') {
          const hasSubtasksNotDone = await hasDescendantWithStatusNotDone(taskId);
          if (hasSubtasksNotDone) {
            const tree = await getTaskWithDescendantsTree(taskId);
            const list = tree ? formatSubtaskListForConfirm(tree) : '';
            const taskName = tree?.title?.trim() || 'Untitled';
            const confirmed = window.confirm(
              list ? `${list}\n\n${taskName} has subtasks. Set them all to Done as well?` : 'This task has subtasks. Set them all to Done as well?',
            );
            if (!confirmed) return;
            await setDescendantsStatus(taskId, 'Done');
          }
          await updateTask(taskId, { status: 'Done' });
        } else {
          await updateTask(taskId, { status: newStatus });
        }
        await renderProjectDetailsView(root, projectId);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to update task');
      }
    });
  });
}
