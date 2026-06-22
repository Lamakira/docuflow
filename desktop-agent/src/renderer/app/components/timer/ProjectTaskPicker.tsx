import React, { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { Project, Task, formatTime } from '../../types';

export function ProjectTaskPicker() {
  const { state, startTimer } = useAgent();
  const bridge = window.agentBridge;
  const apiBase = state.agentState?.apiBase ?? null;
  const timer = state.agentState?.timer;

  // Track the last known elapsed per taskId so the row of the just-left task
  // shows its correct value immediately on switch, without waiting for the 1.5s refresh.
  const taskElapsedRef = useRef<Map<string, number>>(new Map());
  if (timer?.taskId && timer.status !== 'stopped') {
    taskElapsedRef.current.set(timer.taskId, timer.elapsedToday ?? 0);
  }

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(false);

  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // New-project inline form state
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  // New-task inline form state
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);
  const newTaskInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bridge.getProjects().then((r) => {
      setProjectsLoading(false);
      if (r.ok) setProjects(r.data);
      else setProjectsError(true);
    });
  }, []);

  useEffect(() => {
    setShowNewTask(false);
    setNewTaskName('');
    setCreateTaskError(null);
    if (!selectedProjectId) {
      setTasks([]);
      setTasksError(false);
      return;
    }
    setTasksLoading(true);
    setTasksError(false);
    setTasks([]);
    bridge.getTasks({ crmProjectId: selectedProjectId }).then((r) => {
      setTasksLoading(false);
      if (r.ok) setTasks(r.data);
      else setTasksError(true);
    });
  }, [selectedProjectId]);

  // Silently refresh task durations when the active timer entry changes
  useEffect(() => {
    if (!selectedProjectId) return;
    const t = setTimeout(() => {
      bridge.getTasks({ crmProjectId: selectedProjectId }).then((r) => {
        if (r.ok) setTasks(r.data);
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [timer?.entryId]);

  // Focus the project input when the form opens
  useEffect(() => {
    if (showNewProject) {
      setTimeout(() => newProjectInputRef.current?.focus(), 50);
    }
  }, [showNewProject]);

  // Focus the task input when the form opens
  useEffect(() => {
    if (showNewTask) {
      setTimeout(() => newTaskInputRef.current?.focus(), 50);
    }
  }, [showNewTask]);

  function openNewTaskForm() {
    setShowNewTask(true);
    setNewTaskName('');
    setCreateTaskError(null);
  }

  function cancelNewTask() {
    setShowNewTask(false);
    setNewTaskName('');
    setCreateTaskError(null);
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    const name = newTaskName.trim();
    if (!name || !selectedProjectId) return;
    setCreatingTask(true);
    setCreateTaskError(null);
    const result = await bridge.createTask({ crmProjectId: selectedProjectId, name });
    setCreatingTask(false);
    if (result.ok && result.data) {
      setTasks((prev) => [...prev, result.data]);
      setShowNewTask(false);
      setNewTaskName('');
    } else {
      setCreateTaskError(result.error ?? 'Failed to create task');
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const filteredProjects = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  async function handleStartTask(task: Task) {
    if (!selectedProject) return;
    setStarting(task.id);
    setStartError(null);
    const result = await startTimer({
      crmProjectId: selectedProject.id,
      projectName: selectedProject.name,
      taskId: task.id,
      taskName: task.name,
      // Pass already-known today total so elapsedToday is correct immediately,
      // without waiting ~30s for the server start response (avoids 0→jump UX).
      taskDurationToday: task.durationToday ?? 0,
    });
    setStarting(null);
    if (!result.ok) {
      setStartError(result.error ?? 'Failed to start timer');
      setTimeout(() => setStartError(null), 3000);
    }
  }

  function openNewProjectForm() {
    setShowNewProject(true);
    setNewProjectName('');
    setCreateProjectError(null);
  }

  function cancelNewProject() {
    setShowNewProject(false);
    setNewProjectName('');
    setCreateProjectError(null);
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    setCreateProjectError(null);
    const result = await bridge.createProject({ name });
    setCreatingProject(false);
    if (result.ok && result.data) {
      const created: Project = { id: result.data.id, name: result.data.name, status: result.data.status };
      setProjects((prev) => [...prev, created]);
      setSelectedProjectId(created.id);
      setShowNewProject(false);
      setNewProjectName('');
    } else {
      setCreateProjectError(result.error ?? 'Failed to create project');
    }
  }

  return (
    <div className="picker-main">
      {/* Two-column: Projects | Tasks */}
      <div className="picker-cols">
        {/* Left: Projects */}
        <div className="picker-col picker-col--projects">
          <div className="picker-col__header">
            <span>Projects</span>
            <button
              className="picker-new-btn"
              title="New project"
              onClick={openNewProjectForm}
            >
              +
            </button>
          </div>

          {/* Inline new-project form */}
          {showNewProject && (
            <form className="picker-new-project-form" onSubmit={handleCreateProject}>
              <input
                ref={newProjectInputRef}
                className="picker-new-project-input"
                type="text"
                placeholder="Project name…"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                disabled={creatingProject}
                maxLength={120}
              />
              <div className="picker-new-project-actions">
                <button
                  type="submit"
                  className="picker-new-project-confirm"
                  disabled={creatingProject || !newProjectName.trim()}
                >
                  {creatingProject ? '…' : 'Create'}
                </button>
                <button
                  type="button"
                  className="picker-new-project-cancel"
                  onClick={cancelNewProject}
                  disabled={creatingProject}
                >
                  Cancel
                </button>
              </div>
              {createProjectError && (
                <div className="picker-new-project-error">{createProjectError}</div>
              )}
            </form>
          )}

          <div className="picker-search">
            <input
              className="picker-search__input"
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="picker-col__list">
            {projectsLoading && (
              <div className="picker-col__empty">Loading…</div>
            )}
            {projectsError && (
              <div className="picker-col__empty">
                Failed to load
                {apiBase && (
                  <a
                    href="#"
                    style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.72rem' }}
                    onClick={(e) => { e.preventDefault(); window.agentBridge.openExternal(`${apiBase}/crm`); }}
                  >
                    Open web app
                  </a>
                )}
              </div>
            )}
            {!projectsLoading && !projectsError && filteredProjects.length === 0 && (
              <div className="picker-col__empty">{search ? 'No match' : 'No projects yet'}</div>
            )}
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                className={`picker-project-item${selectedProjectId === project.id ? ' picker-project-item--selected' : ''}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                {project.name}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Tasks */}
        <div className="picker-col picker-col--tasks">
          <div className="picker-col__header">
            <span>Tasks</span>
            {selectedProjectId && (
              <button
                className="picker-new-btn"
                title="New task"
                onClick={openNewTaskForm}
              >
                +
              </button>
            )}
          </div>

          {/* Inline new-task form */}
          {showNewTask && selectedProjectId && (
            <form className="picker-new-project-form" onSubmit={handleCreateTask}>
              <input
                ref={newTaskInputRef}
                className="picker-new-project-input"
                type="text"
                placeholder="Task name…"
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                disabled={creatingTask}
                maxLength={120}
              />
              <div className="picker-new-project-actions">
                <button
                  type="submit"
                  className="picker-new-project-confirm"
                  disabled={creatingTask || !newTaskName.trim()}
                >
                  {creatingTask ? '…' : 'Create'}
                </button>
                <button
                  type="button"
                  className="picker-new-project-cancel"
                  onClick={cancelNewTask}
                  disabled={creatingTask}
                >
                  Cancel
                </button>
              </div>
              {createTaskError && (
                <div className="picker-new-project-error">{createTaskError}</div>
              )}
            </form>
          )}

          <div className="picker-col__list">
            {!selectedProjectId && (
              <div className="picker-col__empty">← Select a project</div>
            )}
            {selectedProjectId && tasksLoading && (
              <div className="picker-col__empty">Loading…</div>
            )}
            {selectedProjectId && tasksError && (
              <div className="picker-col__empty">Failed to load tasks</div>
            )}
            {selectedProjectId && !tasksLoading && !tasksError && tasks.length === 0 && (
              <div className="picker-col__empty">
                No tasks yet — click + to add one.
              </div>
            )}
            {tasks.map((task) => {
              const isActiveTask =
                timer?.status !== 'stopped' &&
                timer?.taskId === task.id;
              // Active task: use elapsedToday — entry elapsed clamped to the current local day.
              // Inactive task: prefer the last locally-known elapsedToday when available
              // (covers the 1.5s gap before the server refresh catches up after a switch);
              // fall back to server durationToday once it reflects the stopped entry.
              const localElapsed = taskElapsedRef.current.get(task.id) ?? 0;
              const displayTime = isActiveTask
                ? (timer?.elapsedToday ?? 0)
                : Math.max(task.durationToday ?? 0, localElapsed);
              return (
                <button
                  key={task.id}
                  className="picker-task-item"
                  disabled={starting === task.id}
                  onClick={() => handleStartTask(task)}
                >
                  <span className="picker-task-item__name">{task.name}</span>
                  {starting === task.id && <span className="picker-task-item__loading">…</span>}
                  {displayTime > 0 && (
                    <span className={`picker-task-item__time${isActiveTask ? ' picker-task-item__time--active' : ''}`}>
                      {formatTime(displayTime)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {startError && <div className="picker-error">{startError}</div>}
    </div>
  );
}
