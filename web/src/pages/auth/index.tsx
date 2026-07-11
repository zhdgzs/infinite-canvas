import { useEffect, useState } from "react";
import { App, Button, Form, Input } from "antd";
import { KeyRound, LockKeyhole, UserRound } from "lucide-react";

import { ApiError } from "@/services/api/client";
import { useAuthStore } from "@/stores/use-auth-store";

type AuthFormValues = {
    username: string;
    password: string;
};

export default function AuthPage() {
    const { message } = App.useApp();
    const initialized = useAuthStore((state) => state.initialized);
    const loading = useAuthStore((state) => state.loading);
    const login = useAuthStore((state) => state.login);
    const registerAdmin = useAuthStore((state) => state.registerAdmin);
    const [form] = Form.useForm<AuthFormValues>();
    const [submitting, setSubmitting] = useState(false);
    const title = initialized ? "登录无限画布" : "初始化管理员";
    const description = initialized ? "使用管理员账号进入服务端持久化工作区。" : "创建第一个账号后，公开注册入口会自动关闭。";

    useEffect(() => {
        form.setFieldValue("username", initialized ? "" : "admin");
    }, [form, initialized]);

    const submit = async (values: AuthFormValues) => {
        setSubmitting(true);
        try {
            initialized ? await login(values) : await registerAdmin(values);
            message.success(initialized ? "登录成功" : "初始化完成");
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : "操作失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-5 py-10 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
            <section className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm md:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.75fr)] dark:border-stone-800 dark:bg-stone-900">
                <div className="hidden min-h-[520px] flex-col justify-between border-r border-stone-200 bg-stone-950 p-8 text-white md:flex dark:border-stone-800">
                    <div>
                        <div className="flex items-center gap-3">
                            <span
                                className="size-8 bg-white"
                                style={{
                                    mask: "url(/logo.svg) center / contain no-repeat",
                                    WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                }}
                            />
                            <span className="text-lg font-semibold">无限画布</span>
                        </div>
                        <h1 className="mt-16 max-w-md text-4xl font-semibold leading-tight">服务端数据源已启用</h1>
                        <p className="mt-5 max-w-md text-sm leading-6 text-stone-300">画布、素材、生成记录和文件资源将保存到服务器，浏览器只保留必要缓存和设备级偏好。</p>
                    </div>
                    <div className="grid gap-3 text-sm text-stone-300">
                        <div className="flex items-center gap-2">
                            <KeyRound className="size-4" />
                            <span>httpOnly 会话 Cookie</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <LockKeyhole className="size-4" />
                            <span>管理员账号控制访问</span>
                        </div>
                    </div>
                </div>

                <div className="flex min-h-[520px] flex-col justify-center p-6 sm:p-8">
                    <div className="mb-8">
                        <div className="mb-5 flex size-12 items-center justify-center rounded-lg bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950">
                            <UserRound className="size-5" />
                        </div>
                        <h2 className="text-2xl font-semibold">{title}</h2>
                        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{description}</p>
                    </div>
                    <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                        <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                            <Input autoComplete="username" prefix={<UserRound className="mr-1 size-4 text-stone-400" />} placeholder="admin" />
                        </Form.Item>
                        <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }, { min: 8, message: "密码至少需要 8 位" }]}>
                            <Input.Password autoComplete={initialized ? "current-password" : "new-password"} prefix={<LockKeyhole className="mr-1 size-4 text-stone-400" />} placeholder="至少 8 位" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading || submitting} block>
                            {initialized ? "登录" : "创建管理员"}
                        </Button>
                    </Form>
                </div>
            </section>
        </main>
    );
}
