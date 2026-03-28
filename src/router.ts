import { renderGanttView } from './views/ganttView';
import { renderProjectDetailsView } from './views/projectDetailsView';
import { renderAddProjectView } from './views/addProjectView';

type Route =
  | { type: 'home' }
  | { type: 'add-project'; editProjectId?: number }
  | { type: 'project'; id: number };

export interface AppContext {
  root: HTMLElement;
}

function parseRoute(hash: string): Route {
  const cleaned = hash.replace(/^#/, '');
  if (!cleaned || cleaned === '/') return { type: 'home' };

  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] === 'project' && parts[1] === 'update') {
    const editProjectId = parts[2] ? Number(parts[2]) : undefined;
    return {
      type: 'add-project',
      ...(Number.isNaN(editProjectId) ? {} : { editProjectId }),
    };
  }
  // Backward compatibility for existing deep links.
  if (parts[0] === 'add-project') {
    const editProjectId = parts[1] ? Number(parts[1]) : undefined;
    return {
      type: 'add-project',
      ...(Number.isNaN(editProjectId) ? {} : { editProjectId }),
    };
  }
  if (parts[0] === 'project' && parts[1]) {
    const id = Number(parts[1]);
    if (!Number.isNaN(id)) {
      return { type: 'project', id };
    }
  }

  return { type: 'home' };
}

function navigate(route: Route) {
  if (route.type === 'home') {
    window.location.hash = '#/';
  } else if (route.type === 'add-project') {
    window.location.hash = route.editProjectId
      ? `#/project/update/${route.editProjectId}`
      : '#/project/update';
  } else {
    window.location.hash = `#/project/${route.id}`;
  }
}

export function attachRouter(root: HTMLElement) {
  const ctx: AppContext = { root };

  const handle = () => {
    const route = parseRoute(window.location.hash || '#/');
    renderRoute(ctx, route);
  };

  window.addEventListener('hashchange', handle);
  if (!window.location.hash) {
    navigate({ type: 'home' });
  } else {
    handle();
  }
}

export function goToHome() {
  window.location.hash = '#/';
}

export function goToAddProject() {
  window.location.hash = '#/project/update';
}

export function goToEditProject(projectId: number) {
  window.location.hash = `#/project/update/${projectId}`;
}

export function goToProject(id: number) {
  window.location.hash = `#/project/${id}`;
}

async function renderRoute(ctx: AppContext, route: Route) {
  if (route.type === 'home') {
    await renderGanttView(ctx.root);
  } else if (route.type === 'add-project') {
    await renderAddProjectView(ctx.root, route.editProjectId);
  } else {
    await renderProjectDetailsView(ctx.root, route.id);
  }
}

