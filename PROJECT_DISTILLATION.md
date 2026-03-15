## Project distillation – `my-projects`

### 1. Problem & goal

- **Purpose**: Lightweight project management tool that visualizes projects on a Gantt timeline and lets you manage a hierarchical task tree per project.
- **Primary users**: Individual contributors or small teams who want a local, browser‑based planner without a backend service.
- **Core value**: Quickly see when projects run, adjust dates directly on the timeline, add/edit projects and tasks via dedicated forms, organize work in a Kanban-style project view, and export/import projects as JSON for backup and portability—all stored locally in the browser.

### 2. High‑level architecture

- **Client‑only web app**: Built with TypeScript and bundled by Vite; everything runs in the browser.
- **Persistence layer**: Uses Dexie (IndexedDB wrapper) as the single source of truth for `Project` and `Task` entities (`src/db/schema.ts`).
- **Domain model**: Strongly typed `Project`/`Task`/`TaskTreeNode` types and tree builder live in `src/models/domain.ts`.
- **Data services**:
  - `src/services/projectService.ts`: CRUD, `cloneProject` (copies project and full task tree), and transactional delete for projects (cascades task deletion).
  - `src/services/taskService.ts`: CRUD and tree‑aware helpers (`getDescendantTaskIds`, `getTaskWithDescendantsTree`, `formatSubtaskListForConfirm`, `hasDescendantWithStatusNotDone`, `setDescendantsStatus`, `setAllTasksInProjectStatus`) for status updates and confirmations.
  - `src/services/exportImportService.ts`: Export/import for backup and portability. `exportProjectToJson(projectId)` returns versioned JSON (project + tasks); `downloadJson(filename, jsonString)` triggers browser download; `parseImportFile(jsonString)` validates and returns `{ project, tasks }` for the first project in the file (version check, required fields, status/priority validation).
- **Theme**: `src/services/themeService.ts` — sun-position-based light/dark theme (geolocation when available; fallback 6:00–18:00 local), Gantt palette per theme, `initTheme()` called from `main.ts`.
- **UI/routing**:
  - `src/router.ts`: Hash‑based router for `#/`, `#/add-project`, `#/add-project/:editProjectId`, and `#/project/:id`; dispatches to the corresponding views.
  - `src/views/ganttView.ts`: Gantt timeline overview of all projects with D3‑driven rendering and drag/resize; FAB opens add-project.
  - `src/views/addProjectView.ts`: Add or edit project: metadata form, date range picker, hierarchical task tree (drafts), and submit that creates/updates project and tasks. On **Add project** only, an Import button lets the user select a JSON file (export format); the form and task tree are prefilled from the parsed data so the user can adjust and submit as a new project.
  - `src/views/projectDetailsView.ts`: Per‑project details: metadata sidebar (collapsible, preference in `localStorage`), Kanban columns (Not Started, In Progress, Done) with drag-and-drop to update task status, and actions: Clone, Edit, Export (downloads project + tasks as JSON).
- **UI components & utils**:
  - `src/ui/components/addProjectTaskTree.ts`: Task tree UI for add/edit project (drafts, nesting, dates).
  - `src/ui/components/confirmDialog.ts`, `src/ui/components/modal.ts`: Reusable dialog/modal.
  - `src/utils/dateRangePicker.ts`: Date range picker (e.g. vanilla-calendar-pro); `attachDateRangePicker`.
  - `src/utils/dateFormat.ts`: `formatDateDDMMYY`, `parseDDMMYY` for display and parsing.
- **Styles & layout**: CSS in `src/styles/*.css` (e.g. `main.css`, `gantt.css`, `project-details.css`, `add-project.css`); theme applied via `data-theme` on document root.

### 3. Data model distillation

- **Project** (`src/models/domain.ts`):
  - Identity & text: `id`, `name`, optional `description`.
  - Schedule: ISO strings `startDate`, `endDate`.
  - State: `status` (`NotStarted | InProgress | Blocked | Done`), `priority` (`Low | Medium | High | Critical`).
  - Audit: `createdAt`, `updatedAt`.
- **Task**:
  - Relationship: `projectId` (FK), optional `parentId` for nesting.
  - Identity & text: `title`, optional `description`.
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
  - Clicking a bar navigates to `#/project/:id`.
  - Floating action button navigates to `#/add-project` (new project).

- **Add / Edit project view** (`renderAddProjectView`):
  - **New project**: Default dates (today → +30 days), empty task list; “Add project” title.
  - **Edit project** (`#/add-project/:id`): Loads project and tasks, builds task tree and converts to drafts; “Edit project” title.
  - Form: name, description, date range (via `attachDateRangePicker`), status, priority.
  - Task tree: add/remove/reorder nested tasks with optional per-task dates; `createAddProjectTaskTree` / `taskTreeToDrafts`; on submit, creates or updates project and tasks (including recursive create for children).
  - Navigation: back to home or, after edit, to project details.

- **Project details view** (`renderProjectDetailsView`):
  - Loads project (`getProject`) and tasks (`listTasksForProject`), groups by Kanban status (Not Started, In Progress, Done; Blocked tasks shown in Not Started with icon).
  - Renders collapsible metadata sidebar (status, priority, dates, description) and Clone, Edit, Export buttons; meta visibility stored in `localStorage` (`project-details-meta-visible`).
  - Kanban board: three columns with draggable task cards; drop updates task `status` via `updateTask`. Moving to Done can prompt to set all descendants to Done (using `hasDescendantWithStatusNotDone`, `setDescendantsStatus`, `getTaskWithDescendantsTree`, `formatSubtaskListForConfirm`).
  - “Edit” goes to `#/add-project/:id`; “Clone” calls `cloneProject` then navigates to the new project’s details; “Export” downloads the project and its tasks as a JSON file (same format used by Import on Add project).

### 5. Routing model

- **Route type** (`src/router.ts`):
  - `Route = { type: 'home' } | { type: 'add-project'; editProjectId?: number } | { type: 'project'; id: number }`.
- **Parsing**:
  - `parseRoute('#/')` → `{ type: 'home' }`.
  - `parseRoute('#/add-project')` → `{ type: 'add-project' }`.
  - `parseRoute('#/add-project/123')` → `{ type: 'add-project', editProjectId: 123 }` (if numeric).
  - `parseRoute('#/project/123')` → `{ type: 'project', id: 123 }` (if `id` is a valid number).
- **Navigation helpers**:
  - `goToHome()` → `#/`.
  - `goToAddProject()` → `#/add-project`.
  - `goToEditProject(projectId)` → `#/add-project/:projectId`.
  - `goToProject(id)` → `#/project/:id`.
- **Attach router**:
  - `attachRouter(root)` listens to `hashchange` and dispatches:
    - `home` → `renderGanttView(root)`.
    - `add-project` → `renderAddProjectView(root, editProjectId)`.
    - `project` → `renderProjectDetailsView(root, id)`.

### 6. Run, build, and deploy

- **Tooling**:
  - Vite (dev server and bundling).
  - TypeScript (~5.9) for type safety.
- **Scripts** (`package.json`):
  - `npm run dev` → Start Vite dev server.
  - `npm run build` → Type‑check (`tsc`) then build with Vite.
  - `npm run preview` → Preview the production build locally.
- **Dependencies** (notable): `dexie`, `d3`, `@types/d3`, `vanilla-calendar-pro`.
- **Artifacts**:
  - Production assets emitted under `dist/` (HTML, JS, CSS, icons).
  - Entire app is static and can be hosted on any static host (e.g. GitHub Pages, Vercel static, S3).

### 7. Edges, assumptions, and current limitations

- **Local‑only storage**: All data is in the browser’s IndexedDB via Dexie; no backend synchronization or multi‑user capabilities.
- **Simple validation**:
  - Project and task date constraints ensure `startDate < endDate` where applicable; no cross‑project conflict detection.
- **Time window**: Gantt visualization only covers a window from one month ago to three months ahead; items outside this range are not visible.
- **Project details**: Task management is status-focused (Kanban drag-and-drop); full task add/edit/delete and hierarchy are done in the Add/Edit project flow, not on the project details Kanban view.

### 8. Good next steps

- **Task CRUD on project details**: Add inline or modal add/edit/delete for tasks (and subtasks) from the Kanban view without going to Edit project.
- **Filtering & search**: Filter projects by status/priority on the Gantt; search tasks within a project.
- **Persisted Gantt settings**: Store and restore view preferences (e.g. zoom level, visible date window).
- **Export/import**: Full-app or multi-project export/import; Markdown export; import that merges into existing DB (current import only prefills the Add project form).
