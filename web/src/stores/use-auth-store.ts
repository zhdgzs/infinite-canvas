import { create } from "zustand";

import { apiGet, apiPost } from "@/services/api/client";

export type AuthUser = {
    id: string;
    username: string;
    role: string;
};

type AuthStore = {
    initialized: boolean;
    bootstrapped: boolean;
    loading: boolean;
    error: string;
    user: AuthUser | null;
    bootstrap: () => Promise<void>;
    registerAdmin: (payload: { username: string; password: string }) => Promise<void>;
    login: (payload: { username: string; password: string }) => Promise<void>;
    logout: () => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
    initialized: false,
    bootstrapped: false,
    loading: false,
    error: "",
    user: null,
    bootstrap: async () => {
        if (get().loading) return;
        set({ loading: true, error: "" });
        try {
            const setup = await apiGet<{ initialized: boolean }>("/api/setup/status");
            if (!setup.initialized) {
                set({ initialized: false, user: null, bootstrapped: true });
                return;
            }
            try {
                const me = await apiGet<{ user: AuthUser | null }>("/api/auth/me");
                set({ initialized: true, user: me.user, bootstrapped: true });
            } catch {
                set({ initialized: true, user: null, bootstrapped: true });
            }
        } catch (error) {
            set({ bootstrapped: true, user: null, error: error instanceof Error ? error.message : "无法连接服务器" });
        } finally {
            set({ loading: false });
        }
    },
    registerAdmin: async (payload) => {
        set({ loading: true, error: "" });
        try {
            const result = await apiPost<{ user: AuthUser }>("/api/setup/register", payload);
            set({ initialized: true, user: result.user, bootstrapped: true });
        } finally {
            set({ loading: false });
        }
    },
    login: async (payload) => {
        set({ loading: true, error: "" });
        try {
            const result = await apiPost<{ user: AuthUser }>("/api/auth/login", payload);
            set({ initialized: true, user: result.user, bootstrapped: true });
        } finally {
            set({ loading: false });
        }
    },
    logout: async () => {
        set({ loading: true, error: "" });
        try {
            await apiPost("/api/auth/logout");
            set({ user: null, initialized: true, bootstrapped: true });
        } finally {
            set({ loading: false });
        }
    },
}));
