import { create } from "zustand";

import { cleanupUnusedImages } from "@/services/image-storage";
import { cleanupUnusedMedia } from "@/services/file-storage";
import { createAsset, deleteAsset, fetchAssets, updateAsset as updateRemoteAsset } from "@/services/api/assets";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string; durationMs?: number } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    loading: boolean;
    assets: Asset[];
    loadAssets: () => Promise<void>;
    clearAssets: () => void;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => Promise<void>;
    cleanupImages: (extra?: unknown) => void;
};

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    loading: false,
    assets: [],
    loadAssets: async () => {
        if (get().loading) return;
        set({ loading: true });
        try {
            set({ assets: await fetchAssets(), hydrated: true });
        } finally {
            set({ loading: false });
        }
    },
    clearAssets: () => set({ hydrated: false, loading: false, assets: [] }),
    addAsset: async (asset) => {
        const created = await createAsset(asset);
        set((state) => ({ assets: [created, ...state.assets] }));
        return created.id;
    },
    updateAsset: async (id, patch) => {
        const previous = get().assets.find((asset) => asset.id === id);
        if (!previous) return;
        const optimistic = { ...previous, ...patch, updatedAt: new Date().toISOString() } as Asset;
        set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? optimistic : asset)) }));
        const saved = await updateRemoteAsset(id, patch);
        set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? saved : asset)) }));
    },
    removeAsset: async (id) => {
        set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
        get().cleanupImages({ assets: get().assets });
        await deleteAsset(id);
    },
    replaceAssets: async (assets) => {
        const created = await Promise.all(assets.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...asset }) => createAsset(asset)));
        set({ assets: created });
    },
    cleanupImages: (extra) => {
        window.setTimeout(async () => {
            const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
            await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
            await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
        }, 0);
    },
}));
