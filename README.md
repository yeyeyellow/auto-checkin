# 自动签到

老王论坛与 2048 论坛的个人自动签到项目，使用 Node.js、Playwright 和 Chrome。当前经过实际验证的是 Windows 版本；Linux 自动化管线尚未实现。

## 目录

- `forum-checkin-lab/`：老王论坛签到、滑块验证、登录状态与服务器时间检查。
- `hjd2048-checkin/`：2048 论坛签到、每日回复及回复结果查证。
- `shared/`：运行器、并发互斥、故障恢复、原子文件写入、统计与 Windows 自动启动脚本。

两个论坛共同依赖 `shared/`，请保留整个仓库目录结构。

## Windows 安装与运行

当前本机验证环境：Node.js 24、系统 Chrome。依赖版本保存在各项目的 `package-lock.json` 中。

在仓库根目录安装依赖：

```powershell
npm --prefix forum-checkin-lab ci
npm --prefix hjd2048-checkin ci
```

首次使用需分别在本机独立浏览器窗口中手动登录：

```powershell
npm --prefix forum-checkin-lab run login
npm --prefix hjd2048-checkin run login
```

登录凭证保存在对应项目的 `session/` 下。仓库不包含现有账号的会话，新克隆的副本需要重新登录。

手动签到：

```powershell
npm --prefix forum-checkin-lab run checkin
npm --prefix hjd2048-checkin run checkin
```

安装当前用户登录后的自动启动与恢复任务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File forum-checkin-lab/install-startup.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File hjd2048-checkin/install-startup.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/install-recovery.ps1
```

默认在用户登录 Windows 后等待三分钟；恢复任务每五分钟检查当天登录开启的签到周期，不会自行创建跨日签到周期。生成的 `scheduled-checkin.vbs` 使用本机路径，由安装脚本重新生成，不纳入版本控制。

## 验证与运行记录

在 Windows 的仓库根目录执行离线回归测试：

```powershell
node --test --test-concurrency=1 shared/*.test.mjs forum-checkin-lab/*.test.mjs hjd2048-checkin/*.test.mjs
```

测试包含真实无头 Chrome 的本机页面测试和 Windows 互斥测试，不能原样在 Linux 上运行。测试不会向真实论坛提交签到或回复。

每个论坛的最新结果位于 `artifacts/last-result.json`，历史尝试位于 `artifacts/runs/`，当天控制记录位于 `artifacts/days/`。只有论坛本人状态经两次读取确认后才记为成功。详细机制见 [恢复说明](shared/README.md) 及两个论坛各自的 README。

## Linux 迁移待办

此仓库为后续在同一电脑的 Linux 系统上部署保留完整源码；直接克隆后执行签到仍会遇到 Windows 专用依赖。需要先完成：

1. 将浏览器路径改为按平台选择，或使用 Playwright 在 Linux 安装的 Chromium；登录、观察脚本和测试中的路径也需一并处理。
2. 替换 `shared/run-lock.mjs` 对 `powershell.exe` 和 Windows 系统互斥的依赖，保留并发排他、异常退出释放和超时保护。
3. 以 Linux 用户服务及定时器实现登录后延迟、当天周期与失败补试，保留成功后停止及跨日保护；Windows 的 `.ps1` / `.vbs` 调度入口不能直接使用。
4. 在 Linux 本机重新登录并生成会话；2048 的浏览器元数据与默认 User-Agent 也需要核对。登录命令需要可显示 Chrome 窗口的桌面环境。
5. 核对 Windows/Linux 双系统的硬件时钟解释方式和自动校时。2026-10-20 已观察到 Windows 开机后时间慢八小时，引起老王验证码 E003；老王签到现在会提前检查服务器时间偏差。
6. 在 Linux 上验证互斥、进程中断恢复、跨日边界和真实签到，再启用自动运行。

## 本机数据

`.gitignore` 排除全部 `session/`、`artifacts/`、依赖、缓存、环境变量文件和生成的本机启动入口。不会上传 Cookie、登录凭证、截图、页面快照或真实运行记录。请保持这些目录仅存放在可信本机环境中。
