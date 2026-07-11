import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import AuthPage from "@/pages/auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";

export function AuthGate({ children }: { children: ReactNode }) {
    const bootstrap = useAuthStore((state) => state.bootstrap);
    const bootstrapped = useAuthStore((state) => state.bootstrapped);
    const initialized = useAuthStore((state) => state.initialized);
    const loading = useAuthStore((state) => state.loading);
    const error = useAuthStore((state) => state.error);
    const user = useAuthStore((state) => state.user);
    const loadProjects = useCanvasStore((state) => state.loadProjects);
    const clearProjects = useCanvasStore((state) => state.clearProjects);
    const loadAssets = useAssetStore((state) => state.loadAssets);
    const clearAssets = useAssetStore((state) => state.clearAssets);
    const loadConfig = useConfigStore((state) => state.loadConfig);
    const clearConfig = useConfigStore((state) => state.clearConfig);
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        void bootstrap();
    }, [bootstrap]);

    useEffect(() => {
        if (!bootstrapped) return;
        if (!user) {
            clearProjects();
            clearAssets();
            clearConfig();
            return;
        }
        void Promise.all([loadProjects(), loadAssets(), loadConfig()]);
    }, [bootstrapped, clearAssets, clearConfig, clearProjects, loadAssets, loadConfig, loadProjects, user]);

    if (!bootstrapped) return <main className="flex h-dvh items-center justify-center bg-background text-sm text-stone-500">{loading ? "正在连接服务器..." : "正在初始化..."}</main>;
    if (error) return <main className="flex h-dvh items-center justify-center bg-background px-6 text-center text-sm text-red-500">{error}</main>;
    if (!initialized || !user) return <AuthPage />;
    return <>{children}</>;
}
