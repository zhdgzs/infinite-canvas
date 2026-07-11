import { create } from "zustand";

import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { createCanvasProject, deleteCanvasProject, fetchCanvasProjects, updateCanvasProject } from "@/services/api/projects";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    loading: boolean;
    projects: CanvasProject[];
    loadProjects: () => Promise<void>;
    clearProjects: () => void;
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProject[]) => Promise<void>;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const projectSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
    hydrated: false,
    loading: false,
    projects: [],
    loadProjects: async () => {
        if (get().loading) return;
        set({ loading: true });
        try {
            set({ projects: await fetchCanvasProjects(), hydrated: true });
        } finally {
            set({ loading: false });
        }
    },
    clearProjects: () => {
        clearProjectSaveTimers();
        set({ hydrated: false, loading: false, projects: [] });
    },
    createProject: async (title = "未命名画布") => {
        const project = await createCanvasProject(title);
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },
    importProject: async (source) => {
        const project = await createCanvasProject(source.title || "导入画布", normalizeProject(source));
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },
    openProject: (id) => {
        return get().projects.find((item) => item.id === id) || null;
    },
    renameProject: async (id, title) => {
        const previous = get().projects.find((project) => project.id === id);
        if (!previous) return;
        const next = { ...previous, title: title.trim() || previous.title, updatedAt: new Date().toISOString() };
        set((state) => ({ projects: state.projects.map((project) => (project.id === id ? next : project)) }));
        await saveProject(id);
    },
    deleteProjects: async (ids) => {
        ids.forEach(clearProjectSaveTimer);
        set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)) }));
        await Promise.all(ids.map((id) => deleteCanvasProject(id)));
    },
    replaceProjects: async (projects) => {
        const created = await Promise.all(projects.map((project) => createCanvasProject(project.title || "导入画布", project)));
        set({ projects: created });
    },
    updateProject: (id, patch) => {
        set((state) => ({
            projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
        }));
        scheduleProjectSave(id);
    },
}));

function normalizeProject(source: Partial<CanvasProject>): CanvasProject {
    const now = new Date().toISOString();
    return {
        id: source.id || "",
        title: source.title || "导入画布",
        createdAt: source.createdAt || now,
        updatedAt: now,
        nodes: source.nodes || [],
        connections: source.connections || [],
        chatSessions: source.chatSessions || [],
        activeChatId: source.activeChatId || null,
        backgroundMode: source.backgroundMode || "lines",
        showImageInfo: source.showImageInfo || false,
        viewport: source.viewport || initialViewport,
    };
}

function scheduleProjectSave(id: string) {
    clearProjectSaveTimer(id);
    projectSaveTimers.set(id, setTimeout(() => void saveProject(id), 500));
}

async function saveProject(id: string) {
    clearProjectSaveTimer(id);
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (!project) return;
    const saved = await updateCanvasProject(project);
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === id ? saved : item)) }));
}

function clearProjectSaveTimer(id: string) {
    const timer = projectSaveTimers.get(id);
    if (timer) clearTimeout(timer);
    projectSaveTimers.delete(id);
}

function clearProjectSaveTimers() {
    Array.from(projectSaveTimers.keys()).forEach(clearProjectSaveTimer);
}
