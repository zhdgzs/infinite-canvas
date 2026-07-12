import { App, Button, Collapse, Form, Input, Modal, Progress, Segmented, Select, Switch, Tabs } from "antd";
import { CircleAlert, Cloud, ExternalLink, HardDrive, KeyRound, Link2, Plus, RefreshCw, Save, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";

import { ModelPicker } from "@/components/model-picker";
import { refreshAiChannelModels } from "@/services/api/ai-config";
import { debugStorageBackend, fetchStorageConfig, saveStorageConfig, type S3BackendDraft, type StorageConfig } from "@/services/api/storage-config";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { createModelChannel, defaultBaseUrlForApiFormat, filterModelsByCapability, modelOptionLabel, modelOptionsFromChannels, normalizeModelOptionValue, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
    { label: "OpenAI", value: "openai" },
    { label: "Gemini", value: "gemini" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的素材",
};
const codexSetupSteps = [
    { title: "方式一：在 Codex 中使用插件", text: "先在 Codex App 安装 Infinite Canvas 插件，再通过插件启动画布，插件会自动启动本地 Canvas Agent 并带上连接信息。" },
    { title: "方式二：直接运行 Agent", text: "不使用 Codex 插件时，在终端运行下面命令，再回到网页里连接或手动填入 Local URL 和 Connect token。", command: "npx -y @basketikun/canvas-agent" },
];
const codexPluginRemoveCommand = "codex plugin remove infinite-canvas";
const codexMcpRemoveCommand = "codex mcp remove infinite-canvas";

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

const hiddenConfigTabs = new Set<ConfigTabKey>(["webdav"]);

function visibleConfigTab(tab: ConfigTabKey): ConfigTabKey {
    return hiddenConfigTabs.has(tab) ? "channels" : tab;
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels", onDirtyChange }: { showDoneButton?: boolean; initialTab?: ConfigTabKey; onDirtyChange?: (dirty: boolean) => void }) {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(visibleConfigTab(initialTab));
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const [storage, setStorage] = useState<StorageConfig | null>(null);
    const [savedStorage, setSavedStorage] = useState<StorageConfig | null>(null);
    const [deletedStorageIds, setDeletedStorageIds] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [debuggingStorageId, setDebuggingStorageId] = useState("");
    const [debugUrl, setDebugUrl] = useState("");
    const runtimeConfig = useConfigStore((state) => state.config);
    const savedConfig = useConfigStore((state) => state.savedConfig);
    const [config, setConfig] = useState(runtimeConfig);
    const webdav = useConfigStore((state) => state.webdav);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const saveConfigDraft = useConfigStore((state) => state.saveConfigDraft);
    const discardConfigChanges = useConfigStore((state) => state.discardConfigChanges);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const agentUrl = useAgentStore((state) => state.url);
    const agentToken = useAgentStore((state) => state.token);
    const agentConnected = useAgentStore((state) => state.connected);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentActivity = useAgentStore((state) => state.activity);
    const agentConnectError = useAgentStore((state) => state.connectError);
    const agentConfirmTools = useAgentStore((state) => state.confirmTools);
    const user = useAuthStore((state) => state.user);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const disconnectAgent = useAgentStore((state) => state.disconnectAgent);
    const modelOptions = config.models.map((model) => ({ label: modelOptionLabel(config, model), value: model }));
    const webdavReady = Boolean(webdav.url.trim());
    const [savedAgent, setSavedAgent] = useState(() => ({ url: agentUrl, token: agentToken, confirmTools: agentConfirmTools }));
    const isAdmin = user?.role === "admin";
    const dirty = useMemo(
        () => JSON.stringify(config) !== JSON.stringify(savedConfig) || JSON.stringify(storage) !== JSON.stringify(savedStorage) || agentUrl !== savedAgent.url || agentToken !== savedAgent.token || agentConfirmTools !== savedAgent.confirmTools,
        [agentConfirmTools, agentToken, agentUrl, config, savedAgent, savedConfig, savedStorage, storage],
    );
    const blocker = useBlocker(dirty);
    useEffect(() => setActiveTab(visibleConfigTab(initialTab)), [initialTab]);
    useEffect(() => setConfig(runtimeConfig), [runtimeConfig]);
    useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
    useEffect(() => {
        if (!isAdmin) return;
        void fetchStorageConfig().then((value) => {
            setStorage(value);
            setSavedStorage(value);
        }).catch((error) => message.error(error instanceof Error ? error.message : "读取存储配置失败"));
    }, [isAdmin, message]);
    useEffect(() => {
        const guard = (event: BeforeUnloadEvent) => {
            if (!dirty) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
    }, [dirty]);

    const saveConfig = (nextConfig: AiConfig) => {
        setConfig(nextConfig);
    };

    const updateConfig = <K extends keyof AiConfig,>(key: K, value: AiConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));

    const saveAllConfig = async () => {
        setSaving(true);
        const failures: string[] = [];
        try {
            await saveConfigDraft(config);
        } catch (error) {
            failures.push(`AI 配置：${error instanceof Error ? error.message : "保存失败"}`);
        }
        if (isAdmin && storage) {
            try {
                const saved = await saveStorageConfig(storage.activeBackendId, storage.backends.filter((item) => item.type === "s3") as S3BackendDraft[], deletedStorageIds);
                setStorage(saved);
                setSavedStorage(saved);
                setDeletedStorageIds([]);
            } catch (error) {
                failures.push(`存储配置：${error instanceof Error ? error.message : "保存失败"}`);
            }
        }
        try {
            const normalizedUrl = agentUrl.trim().replace(/\/$/, "");
            localStorage.setItem("canvas-agent-url", normalizedUrl);
            localStorage.setItem("canvas-agent-token", agentToken);
            localStorage.setItem("canvas-agent-confirm-tools", String(agentConfirmTools));
            setAgentState({ url: normalizedUrl });
            setSavedAgent({ url: normalizedUrl, token: agentToken, confirmTools: agentConfirmTools });
        } catch (error) {
            failures.push(`Codex 配置：${error instanceof Error ? error.message : "保存失败"}`);
        }
        setSaving(false);
        if (failures.length) return message.error(failures.join("；"));
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const discardChanges = () => {
        discardConfigChanges();
        setConfig(savedConfig);
        setStorage(savedStorage);
        setDeletedStorageIds([]);
        setAgentState({ ...savedAgent, connectError: "" });
    };
    useEffect(() => {
        if (blocker.state !== "blocked") return;
        Modal.confirm({
            title: "放弃未保存的修改？",
            content: "离开配置页面后，本次尚未保存的修改将丢失。",
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => {
                discardChanges();
                blocker.proceed();
            },
            onCancel: () => blocker.reset(),
        });
    }, [blocker.state]);

    const updateChannels = (channels: ModelChannel[]) => {
        const nextConfig = withChannels(config, channels);
        saveConfig(nextConfig);
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateChannel(channel.id, { apiFormat, baseUrl });
    };

    const addChannel = () => {
        updateChannels([...config.channels, createModelChannel({ name: `渠道 ${config.channels.length + 1}` })]);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || (!channel.apiKey.trim() && !channel.hasApiKey)) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const remote = await refreshAiChannelModels(channel);
            updateChannels(config.channels.map((item) => (item.id === channel.id ? { ...item, models: remote.models, hasApiKey: remote.hasApiKey, apiKeyMasked: remote.apiKeyMasked } : item)));
            message.success(`${channel.name} 模型列表已更新`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const refreshAllModels = async () => {
        setLoadingChannelId("all");
        try {
            const runnable = config.channels.filter((channel) => channel.baseUrl.trim() && (channel.apiKey.trim() || channel.hasApiKey));
            if (!runnable.length) {
                message.error("请先填写至少一个渠道的 Base URL 和 API Key");
                return;
            }
            const entries = await Promise.all(runnable.map(async (channel) => [channel.id, await refreshAiChannelModels(channel)] as const));
            const modelMap = new Map(entries);
            updateChannels(config.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id)?.models || [], hasApiKey: modelMap.get(channel.id)?.hasApiKey, apiKeyMasked: modelMap.get(channel.id)?.apiKeyMasked } : channel)));
            message.success("模型列表已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter(Boolean));
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个素材，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : "WebDAV 同步失败");
            message.error(error instanceof Error ? error.message : "WebDAV 同步失败");
        } finally {
            setSyncingWebdav(false);
        }
    };

    const updateAgentConfig = (patch: { url?: string; token?: string }) => {
        setAgentState({ ...patch, connectError: "" });
    };

    const updateStorageBackend = (id: string, patch: Partial<S3BackendDraft>) => {
        setStorage((current) => current ? { ...current, backends: current.backends.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);
    };

    const addStorageBackend = () => {
        const id = `draft_${Date.now()}`;
        setStorage((current) => current ? {
            ...current,
            backends: [...current.backends, { id, name: `S3 后端 ${current.backends.filter((item) => item.type === "s3").length + 1}`, type: "s3", endpoint: "", publicEndpoint: "", region: "us-east-1", bucket: "", accessKeyId: "", secretAccessKey: "", objectPrefix: "", forcePathStyle: true, isActive: false, hasSecretAccessKey: false, secretAccessKeyMasked: "", fileCount: 0, isIdentityLocked: false }],
        } : current);
    };

    const deleteStorageBackend = (id: string) => {
        setStorage((current) => current ? { ...current, backends: current.backends.filter((item) => item.id !== id) } : current);
        if (!id.startsWith("draft_")) setDeletedStorageIds((current) => [...new Set([...current, id])]);
    };

    const testStorageBackend = async (backend: StorageConfig["backends"][number]) => {
        setDebuggingStorageId(backend.id);
        setDebugUrl("");
        try {
            const result = await debugStorageBackend(backend as S3BackendDraft);
            setDebugUrl(result.url);
            message.success("服务端连接、写入和读取测试成功，请打开临时链接验证公开地址");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "S3 调试失败");
        } finally {
            setDebuggingStorageId("");
        }
    };

    const toggleAgentConnection = () => (agentEnabled ? disconnectAgent({ connectError: "" }) : connectAgent());

    return (
        <>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                                            <CircleAlert className="size-3.5 shrink-0" />
                                            <span className="font-semibold">重要：</span>
                                            <span>新增或拉取模型后，需要到“模型”Tab 选择可选项才会显示。</span>
                                            <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold text-amber-900 dark:text-amber-100" onClick={() => setActiveTab("models")}>
                                                去模型设置
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <Button icon={<RefreshCw className="size-4" />} loading={Boolean(loadingChannelId)} onClick={() => void refreshAllModels()}>
                                            拉取全部
                                        </Button>
                                        <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                            新增渠道
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    {config.channels.map((channel) => (
                                        <section key={channel.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                    <div className="mt-1 text-xs text-stone-500">
                                                        {apiFormatLabel(channel.apiFormat)} · 已保存 {channel.models.length} 个模型
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 gap-2">
                                                    <Button size="small" loading={loadingChannelId === channel.id} onClick={() => void refreshChannelModels(channel)}>
                                                        拉取模型
                                                    </Button>
                                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                                </div>
                                            </div>
                                            <div className="grid gap-4 md:grid-cols-2">
                                                <Form.Item label="渠道名称" className="mb-0">
                                                    <Input value={channel.name} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="调用格式" className="mb-0">
                                                    <Select value={channel.apiFormat} options={apiFormatOptions} onChange={(value: ApiCallFormat) => updateChannelApiFormat(channel, value)} />
                                                </Form.Item>
                                                <Form.Item label="Base URL" className="mb-0">
                                                    <Input value={channel.baseUrl} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="API Key" className="mb-0">
                                                    <Input.Password value={channel.apiKey} placeholder={channel.apiKeyMasked || "API Key"} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="模型列表" className="mb-0 md:col-span-2">
                                                    <Select mode="tags" showSearch allowClear maxTagCount="responsive" placeholder="输入模型名，或点击拉取模型" value={channel.models} onChange={(models) => updateChannel(channel.id, { models })} />
                                                </Form.Item>
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="text-sm font-semibold">默认模型和可选项</div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500">可选项决定各处下拉框展示哪些模型；同名模型会以括号里的渠道名区分。</div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                            <Select
                                                mode="tags"
                                                showSearch
                                                allowClear
                                                maxTagCount="responsive"
                                                placeholder={config.models.length ? `请选择或输入${group.optionsLabel}` : "先到渠道里填写或拉取模型"}
                                                value={config[group.modelsKey]}
                                                options={modelOptions}
                                                onChange={(models) => updateCapabilityModels(group, models)}
                                            />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "生成偏好",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音" className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式" className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速" className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label="默认音频指令" className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                WebDAV 同步
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">同步画布、我的素材和本地媒体文件，不包含 AI API Key；浏览器会直接连接 WebDAV 服务。</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="WebDAV 地址" className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="远程目录" extra={`会在该目录下分业务目录保存，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/`} className="mb-4">
                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="用户名" className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="密码 / 应用密码" className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            测试连接
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? "同步中" : "立即同步"}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "storage",
                        label: "存储",
                        children: isAdmin ? (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="mb-4 border-b border-stone-200 pb-4 dark:border-stone-800">
                                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4" />默认文件存储</div>
                                    <Segmented
                                        value={storage?.activeBackendId === "local" ? "local" : "s3"}
                                        options={[{ label: "本地磁盘", value: "local" }, { label: "S3 / MinIO", value: "s3" }]}
                                        onChange={(value) => {
                                            if (!storage) return;
                                            if (value === "local") return setStorage({ ...storage, activeBackendId: "local" });
                                            const first = storage.backends.find((item) => item.type === "s3" && !item.id.startsWith("draft_"));
                                            if (!first) return message.warning("请先新增并保存一个 S3 后端，再将其设为默认");
                                            setStorage({ ...storage, activeBackendId: first.id });
                                        }}
                                    />
                                    <Form.Item label="本地磁盘目录" className="mb-0 mt-4" extra="由 UPLOAD_DIR 和 Docker volume 管理，页面不可修改。">
                                        <Input readOnly value={storage?.localUploadDir || "正在读取..."} />
                                    </Form.Item>
                                    {storage && storage.activeBackendId !== "local" ? (
                                        <Form.Item label="默认 S3 后端" className="mb-0 mt-4">
                                            <Select value={storage.activeBackendId} options={storage.backends.filter((item) => item.type === "s3" && !item.id.startsWith("draft_")).map((item) => ({ value: item.id, label: item.name }))} onChange={(activeBackendId) => setStorage({ ...storage, activeBackendId })} />
                                        </Form.Item>
                                    ) : null}
                                </section>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div><div className="text-sm font-semibold">S3 兼容后端</div><div className="mt-1 text-xs text-stone-500">支持 AWS S3 与 MinIO。新增后端保存后不会自动成为默认。</div></div>
                                    <Button icon={<Plus className="size-4" />} onClick={addStorageBackend}>新增后端</Button>
                                </div>
                                <Collapse
                                    items={(storage?.backends || []).filter((item) => item.type === "s3").map((backend) => {
                                        const identityLocked = backend.isIdentityLocked;
                                        return {
                                            key: backend.id,
                                            label: <div className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{backend.name}</span><span className="text-xs text-stone-500">{backend.bucket || "未配置 Bucket"} · {backend.fileCount} 个文件{backend.id === storage?.activeBackendId ? " · 当前默认" : ""}</span></div>,
                                            children: (
                                                <div>
                                                    <div className="grid gap-4 md:grid-cols-2">
                                                        <Form.Item label="后端名称" className="mb-0"><Input value={backend.name} onChange={(event) => updateStorageBackend(backend.id, { name: event.target.value })} /></Form.Item>
                                                        <Form.Item label="Region" className="mb-0"><Input value={backend.region || ""} placeholder="us-east-1" onChange={(event) => updateStorageBackend(backend.id, { region: event.target.value })} /></Form.Item>
                                                        <Form.Item label="服务端 Endpoint" className="mb-0"><Input value={backend.endpoint || ""} placeholder="http://minio:9000" onChange={(event) => updateStorageBackend(backend.id, { endpoint: event.target.value })} /></Form.Item>
                                                        <Form.Item label="浏览器公开 Endpoint" className="mb-0" extra="调试成功后由你打开临时链接验证，服务端不会请求此地址。"><Input value={backend.publicEndpoint || ""} placeholder="https://s3.example.com" onChange={(event) => updateStorageBackend(backend.id, { publicEndpoint: event.target.value })} /></Form.Item>
                                                        <Form.Item label="Bucket" className="mb-0"><Input disabled={identityLocked} value={backend.bucket || ""} onChange={(event) => updateStorageBackend(backend.id, { bucket: event.target.value })} /></Form.Item>
                                                        <Form.Item label="对象前缀" className="mb-0"><Input disabled={identityLocked} value={backend.objectPrefix || ""} placeholder="infinite-canvas" onChange={(event) => updateStorageBackend(backend.id, { objectPrefix: event.target.value })} /></Form.Item>
                                                        <Form.Item label="Access Key" className="mb-0"><Input value={backend.accessKeyId || ""} onChange={(event) => updateStorageBackend(backend.id, { accessKeyId: event.target.value })} /></Form.Item>
                                                        <Form.Item label="Secret Key" className="mb-0"><Input.Password value={backend.secretAccessKey || ""} placeholder={backend.secretAccessKeyMasked || "Secret Key"} onChange={(event) => updateStorageBackend(backend.id, { secretAccessKey: event.target.value })} /></Form.Item>
                                                    </div>
                                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                                                        <div className="flex items-center gap-2"><Switch checked={backend.forcePathStyle} onChange={(forcePathStyle) => updateStorageBackend(backend.id, { forcePathStyle })} /><span className="text-sm">Path-style</span></div>
                                                        <div className="flex gap-2">
                                                            <Button icon={<Wifi className="size-4" />} loading={debuggingStorageId === backend.id} onClick={() => void testStorageBackend(backend)}>调试连接</Button>
                                                            <Button danger icon={<Trash2 className="size-4" />} disabled={identityLocked || backend.id === storage?.activeBackendId} onClick={() => deleteStorageBackend(backend.id)}>删除</Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ),
                                        };
                                    })}
                                />
                                {debugUrl ? <div className="mt-4 flex items-center gap-2 border-t border-stone-200 pt-4 dark:border-stone-800"><Input readOnly value={debugUrl} /><Button icon={<ExternalLink className="size-4" />} onClick={() => window.open(debugUrl, "_blank", "noopener,noreferrer")}>打开临时链接</Button></div> : null}
                            </Form>
                        ) : null,
                    },
                    {
                        key: "codex",
                        label: "Codex",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Link2 className="size-4" />
                                                连接本地 Codex
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">用于画布 Agent 连接本机 Codex 插件启动的 Canvas Agent。</div>
                                        </div>
                                        <div className={agentConnectError ? "text-xs text-red-600" : "text-xs text-stone-500"}>{agentConnectError ? "连接失败" : agentConnected ? agentActivity || "已连接" : agentEnabled ? "连接中" : "未连接"}</div>
                                    </div>
                                    <div className="mb-4 grid gap-2 md:grid-cols-2">
                                        {codexSetupSteps.map((step, index) => (
                                            <div key={step.title} className="rounded-md border border-stone-200 p-3 dark:border-stone-800">
                                                <div className="text-xs font-semibold text-stone-500">连接方式 {index + 1}</div>
                                                <div className="mt-1 text-sm font-medium">{step.title}</div>
                                                <div className="mt-1 text-xs leading-5 text-stone-500">{step.text}</div>
                                                {step.command ? <code className="mt-2 block overflow-x-auto rounded bg-stone-100 px-2 py-1.5 text-[11px] text-stone-700 dark:bg-stone-900 dark:text-stone-200">{step.command}</code> : null}
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                                        <div className="font-semibold">Codex 插件提醒</div>
                                        <div className="mt-1">只有安装 Codex 插件或手动添加 MCP 后，工具列表才会进入 Codex 上下文并增加 token 消耗；仅运行 `npx -y @basketikun/canvas-agent` 启动本地 Agent 不会安装 MCP。</div>
                                        <code className="mt-2 block overflow-x-auto rounded bg-white/70 px-2 py-1.5 text-[11px] text-amber-900 dark:bg-black/20 dark:text-amber-100">移除插件：{codexPluginRemoveCommand}</code>
                                        <code className="mt-1 block overflow-x-auto rounded bg-white/70 px-2 py-1.5 text-[11px] text-amber-900 dark:bg-black/20 dark:text-amber-100">移除手动 MCP：{codexMcpRemoveCommand}</code>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="Local URL" className="mb-4">
                                            <Input prefix={<Link2 className="mr-1 size-4 text-stone-400" />} value={agentUrl} placeholder="http://127.0.0.1:17371" onChange={(event) => updateAgentConfig({ url: event.target.value })} />
                                        </Form.Item>
                                        <Form.Item label="Connect token" className="mb-4">
                                            <Input.Password prefix={<KeyRound className="mr-1 size-4 text-stone-400" />} value={agentToken} placeholder="自动发现，或手动填入 Connect token" onChange={(event) => updateAgentConfig({ token: event.target.value })} />
                                        </Form.Item>
                                    </div>
                                    {agentConnectError ? <div className="mb-3 rounded-md border border-red-200 px-3 py-2 text-xs text-red-600 dark:border-red-900/60">{agentConnectError}</div> : null}
                                    <div className="mb-3 flex justify-end">
                                        <Button type={agentEnabled ? "default" : "primary"} icon={<Wifi className="size-4" />} onClick={toggleAgentConnection}>
                                            {agentConnected ? "断开" : agentEnabled ? "取消连接" : "连接"}
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <ShieldCheck className="size-4 text-stone-500" />
                                            <div>
                                                <div className="text-sm font-medium">执行画布操作前确认</div>
                                                <div className="mt-0.5 text-xs text-stone-500">关闭后，本地 Codex 可直接执行画布工具调用。不再需要人工确认</div>
                                            </div>
                                        </div>
                                        <Switch checked={agentConfirmTools} onChange={(confirmTools) => setAgentState({ confirmTools })} />
                                    </div>
                                </section>
                            </Form>
                        ),
                    },
                ].filter((item) => !hiddenConfigTabs.has(item.key as ConfigTabKey) && (item.key !== "storage" || isAdmin))}
            />
            <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-stone-200 bg-background py-3 dark:border-stone-800">
                {dirty ? <Button onClick={discardChanges}>放弃修改</Button> : null}
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={() => void saveAllConfig()}>{showDoneButton ? "保存" : "保存全部配置"}</Button>
            </div>
        </>
    );
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const discardConfigChanges = useConfigStore((state) => state.discardConfigChanges);
    const [dirty, setDirty] = useState(false);
    const close = () => {
        if (!dirty) return setConfigDialogOpen(false);
        Modal.confirm({
            title: "放弃未保存的修改？",
            content: "关闭后，本次尚未保存的配置修改将丢失。",
            okText: "放弃修改",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => {
                discardConfigChanges();
                setAgentStateFromStorage();
                setDirty(false);
                setConfigDialogOpen(false);
            },
        });
    };
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、模型选择和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            destroyOnHidden
            onCancel={close}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} onDirtyChange={setDirty} />
        </Modal>
    );
}

function setAgentStateFromStorage() {
    useAgentStore.setState({
        url: localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
        token: localStorage.getItem("canvas-agent-token") || "",
        confirmTools: localStorage.getItem("canvas-agent-confirm-tools") !== "false",
        connectError: "",
    });
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = keepOrSuggest(config.imageModels, filterModelsByCapability(models, "image"), models);
    const videoModels = keepOrSuggest(config.videoModels, filterModelsByCapability(models, "video"), models);
    const textModels = keepOrSuggest(config.textModels, filterModelsByCapability(models, "text"), models);
    const audioModels = keepOrSuggest(config.audioModels, filterModelsByCapability(models, "audio"), models);
    return {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function keepOrSuggest(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = uniqueModels(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

function normalizeDefaultModel(value: string, options: string[]) {
    if (options.includes(value)) return value;
    return options[0] || value;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? "Gemini" : "OpenAI";
}

function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {item.stage}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
