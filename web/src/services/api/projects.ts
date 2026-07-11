import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api/client";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type PageResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

type RemoteProjectSummary = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
};

type RemoteProject = RemoteProjectSummary & {
    data: unknown;
};

type ProjectData = Omit<CanvasProject, "id" | "title" | "createdAt" | "updatedAt">;

const initialViewport = { x: 0, y: 0, k: 1 };

export async function fetchCanvasProjects() {
    const list = await apiGet<PageResult<RemoteProjectSummary>>("/api/projects?page=1&pageSize=500");
    const projects = await Promise.all(list.items.map((item) => apiGet<RemoteProject>(`/api/projects/${encodeURIComponent(item.id)}`)));
    return projects.map(remoteProjectToCanvasProject);
}

export async function createCanvasProject(title: string, project?: Partial<CanvasProject>) {
    const created = await apiPost<RemoteProject>("/api/projects", {
        title,
        data: project ? canvasProjectToData({ ...emptyCanvasProject(), ...project, title }) : undefined,
    });
    return remoteProjectToCanvasProject(created);
}

export async function updateCanvasProject(project: CanvasProject) {
    const updated = await apiPut<RemoteProject>(`/api/projects/${encodeURIComponent(project.id)}`, {
        title: project.title,
        data: canvasProjectToData(project),
    });
    return remoteProjectToCanvasProject(updated);
}

export async function deleteCanvasProject(id: string) {
    await apiDelete(`/api/projects/${encodeURIComponent(id)}`);
}

function remoteProjectToCanvasProject(project: RemoteProject): CanvasProject {
    const data = isProjectData(project.data) ? project.data : emptyCanvasProjectData();
    return {
        ...emptyCanvasProject(),
        ...data,
        id: project.id,
        title: project.title || "未命名画布",
        createdAt: normalizeDate(project.createdAt),
        updatedAt: normalizeDate(project.updatedAt),
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        connections: Array.isArray(data.connections) ? data.connections : [],
        chatSessions: Array.isArray(data.chatSessions) ? data.chatSessions : [],
        activeChatId: data.activeChatId || null,
        backgroundMode: data.backgroundMode || "lines",
        showImageInfo: Boolean(data.showImageInfo),
        viewport: data.viewport || initialViewport,
    };
}

function canvasProjectToData(project: CanvasProject): ProjectData {
    return {
        nodes: stripRuntimeMediaContent(project.nodes),
        connections: project.connections,
        chatSessions: project.chatSessions,
        activeChatId: project.activeChatId,
        backgroundMode: project.backgroundMode,
        showImageInfo: project.showImageInfo,
        viewport: project.viewport,
    };
}

function stripRuntimeMediaContent(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (!node.metadata?.storageKey || !isMediaNode(node.type)) return node;
        const { content: _content, ...metadata } = node.metadata;
        return { ...node, metadata };
    });
}

function isMediaNode(type: CanvasNodeData["type"]) {
    return type === CanvasNodeType.Image || type === CanvasNodeType.Video || type === CanvasNodeType.Audio;
}

function emptyCanvasProject(): CanvasProject {
    const now = new Date().toISOString();
    return {
        id: "",
        title: "未命名画布",
        createdAt: now,
        updatedAt: now,
        ...emptyCanvasProjectData(),
    };
}

function emptyCanvasProjectData(): ProjectData {
    return {
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: initialViewport,
    };
}

function isProjectData(value: unknown): value is Partial<ProjectData> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeDate(value: string) {
    return value ? new Date(value).toISOString() : new Date().toISOString();
}
