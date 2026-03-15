## Project distillation – `my-projects`

### 1. Problem & goal

- **Purpose**: Lightweight project management tool that visualizes projects on a Gantt timeline and lets you manage a hierarchical task tree per project.
- **Primary users**: Individual contributors or small teams who want a local, browser‑based planner without a backend service.
- **Core value**: Quickly see when projects run, adjust dates directly on the timeline, and organize work into tasks/subtasks stored locally in the browser.

### 2. High‑level architecture

- **Client‑only web app**: Built with TypeScript and bundled by Vite; everything runs in the browser.
- **Persistence layer**: Uses Dexie (IndexedDB wrapper) as the single source of truth for `Project` and `Task` entities (`src/db/schema.ts`).
- **Domain model**: Strongly typed `Project`/`Task`/`TaskTreeNode` types and tree builder live in `src/models/domain.ts`.
- **Data services**:
  - `src/services/projectService.ts`: CRUD + transactional delete for projects (also cascades task deletion).
  - `src/services/taskService.ts`: CRUD and tree‑aware delete for tasks, plus ordering logic.
- **UI/routing**:
  - `src/router.ts`: Hash‑based router that parses `#/` and `#/project/:id` and dispatches to views.
  - `src/views/ganttView.ts`: Gantt timeline overview of all projects with D3‑driven rendering and drag/resize.
  - `src/views/projectDetailsView.ts`: Per‑project details: metadata, hierarchical tasks, and inline add/edit/delete flows.
- **Styles & layout**: CSS in `src/styles/*.css` and compiled assets in `dist/`.

### 3. Data model distillation

- **Project** (`src/models/domain.ts`):
  - Identity & text: `id`, `name`, optional `description`.
  - Schedule: ISO strings `startDate`, `endDate`.
  - State: `status` (`NotStarted | InProgress | Blocked | Done`), `priority` (`Low | Medium | High | Critical`).
  - Audit: `createdAt`, `updatedAt`.
- **Task**:
  - Relationship: `projectId` (FK), optional `parentId` for nesting.
  - Planning: optional `startDate`, `endDate`, `status`, `priority`, and `order` for sibling sorting.
  - `buildTaskTree()` converts the flat task list to a `TaskTreeNode[]` hierarchy, sorted by `order`.
- **Database schema** (`src/db/schema.ts`):
  - Dexie database `pm_gantt_db` with `projects` and `tasks` tables, indexed by the fields above.
  - Classes mapped so Dexie records satisfy the domain interfaces.

### 4. Key user flows

- **Home / Gantt view** (`renderGanttView`):
  - Loads all projects via `listProjects()` and computes a time window (last month to three months ahead).
  - Uses D3 to:
    - Render a top date axis and row labels (project names).
    - Draw one bar per project, with a “today” line for orientation.
    - Attach drag behavior:
      - **Move bar**: shifts both `startDate` and `endDate` and persists via `updateProject`.
      - **Resize handles**: adjust start or end date independently with validation (start < end) and persist changes.
  - Clicking a bar navigates to `#/project/:id` (project details).
  - Floating action button opens a modal to create a new project.

- **Project details view** (`renderProjectDetailsView`):
  - Loads a single project (`getProject`) and its tasks (`listTasksForProject`), then builds a task tree.
  - Renders project metadata and a nested list of tasks/subtasks using `buildTaskTree`.
  - Actions per task (implemented via buttons with `data-task-id`/`data-action`):
    - **Add child**: prompts for title and creates a nested task with `parentId`.
    - **Edit**: prompts to update task title via `updateTask`.
    - **Delete**: cascades delete using `deleteTask`, including all descendants.
  - “Add task” at the top level creates a root task for the project.
  - “Back” button routes back to the Gantt overview.

### 5. Routing model

- **Route type** (`src/router.ts`):
  - `Route = { type: 'home' } | { type: 'project'; id: number }`.
- **Parsing**:
  - `parseRoute('#/')` → `{ type: 'home' }`.
  - `parseRoute('#/project/123')` → `{ type: 'project', id: 123 }` (if `id` is a valid number).
- **Navigation helpers**:
  - `goToHome()` sets `window.location.hash = '#/'`.
  - `goToProject(id)` sets `window.location.hash = '#/project/:id'`.
- **Attach router**:
  - `attachRouter(root)` listens to `hashchange` and dispatches:
    - `home` → `renderGanttView(root)`.
    - `project` → `renderProjectDetailsView(root, id)`.

### 6. Run, build, and deploy

- **Tooling**:
  - Vite (dev server and bundling).
  - TypeScript (~5.9) for type safety.
- **Scripts** (`package.json`):
  - `npm run dev` → Start Vite dev server.
  - `npm run build` → Type‑check (`tsc`) then build with Vite.
  - `npm run preview` → Preview the production build locally.
- **Artifacts**:
  - Production assets emitted under `dist/` (HTML, JS, CSS, icons).
  - Entire app is static and can be hosted on any static host (e.g., GitHub Pages, Vercel static, S3).

### 7. Edges, assumptions, and current limitations

- **Local‑only storage**: All data is in the browser’s IndexedDB via Dexie; no backend synchronization or multi‑user capabilities.
- **Simple validation**:
  - Task creation/edit flows currently rely on browser prompts and minimal validation.
  - Project and task date constraints ensure `startDate < endDate`, but there is no cross‑project conflict detection.
- **Time window**: Gantt visualization only covers a window from one month ago to three months ahead; items outside this range won’t be visible.

### 8. Good next steps

- **Improved task UI**: Replace prompt‑based interactions with inline forms or modals and richer task fields.
- **Filtering & search**: Allow filtering projects (by status/priority) and searching tasks.
- **Persisted settings**: Store and restore view preferences (e.g., zoom level, visible date window).
- **Export/import**: Add JSON or Markdown export/import for projects and tasks for backup and portability.
