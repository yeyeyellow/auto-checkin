# 老王论坛签到实验

依赖、登录会话和观察文件位于本目录，恢复运行器位于相邻的 `../shared`。使用 Node.js、Playwright 和本机 Chrome，不需要下载 Playwright 浏览器。最新恢复机制、补试策略和故障演练见 [恢复说明](../shared/README.md)。

## 运行

在 PowerShell 中：

```powershell
cd C:\Users\huangyaoyao\auto_checkin\forum-checkin-lab
npm run checkin
```

日常命令始终无头运行。每次从论坛服务器读取状态；已签到时再次读取确认并跳过，不依赖本机日期缓存。

2026-10-20 修复：未签到时先比较电脑 UTC 时间与论坛响应的服务器时间，包含缓存时长和网络往返误差。偏差超过一分钟时记录 `CLOCK_SKEW`，提示处理并转入每 30 分钟检查，不获取或提交验证码；已签到仍可正常确认。Windows 开机从硬件时钟读回错误时间、且自动校时服务停止时，会导致验证码连续返回 E003。可在管理员 PowerShell 中运行相邻的 `../shared/repair-clock.ps1`：备份服务状态、设置 Windows Time 自动启动、立即同步并保存结果；不修改时区或论坛凭证。修复后执行 `npm run checkin` 立即重新核实。

2026-10-12 更新：运行前先检查本站网页可访问性。网络、加载超时和验证码失败会持续补试，取消六次上限；成功后停止。自动补试仅属于 Windows 登录后开启的当天周期，跨日不自行开始新签到，详见相邻恢复说明。

首次登录或登录过期时：

```powershell
npm run login
```

这一个命令显示独立 Chrome 窗口，手动登录后检测账号状态、保存会话并自动关闭。最长等待十分钟，不需要在代码或聊天里提供密码，不读取个人 Chrome 配置。`session/state.json` 含登录凭证，请只保存在本机。

默认命令对未签到账号先快速尝试最多十轮，失败后间隔 20 秒；每轮获取新滑块并最多提交一次验证，成功立即停止。十轮仍失败后由恢复任务按分钟级补试。原实验命令仍可使用，行为与默认命令相同：

```powershell
npm run checkin:experimental
```

已签到不尝试验证码。自动化会等待验证码页面加载、确认属于 `k_misign` 签到表单、比较拼图内部与完整背景，通过浏览器鼠标事件拖动一次。绿色描边不参与图像匹配；轨迹包含少量纵向变化及末端修正。服务端验证成功后才点击外层提交。定位置信度不足、组件改变或表单无法确认时立即停止。不会修改验证结果变量，也不会直接构造验证请求。

只有提交后两次重新加载论坛签到页均显示本账号已签到，才输出“签到成功”。验证码成功本身不代表签到成功。提交可返回正常的 HTTP 302 跳转，程序继续核实论坛状态。

## 结果

终端输出中文结果及 JSON；最近结果保存在 `artifacts/last-result.json`。

- `SUCCESS` / 签到成功：退出码 0。
- `ALREADY_SIGNED` / 今日已签到：退出码 0。
- `LOGIN_EXPIRED` / 登录过期：退出码 2。
- `VERIFICATION_FAILED` / 验证失败：退出码 3，附具体失败原因。
- `ERROR` / 运行失败：退出码 4，包括网络异常、页面改变或无法确定状态，不伪装成登录过期。
- `BUSY` / 已有程序运行：退出码 5，避免重复提交。

Windows 系统互斥负责并发保护，进程退出或重启后自动释放；旧的 `run.lock` 文件不再参与运行判断。

## 已实测与限制（更新于 2026-10-06，香港时间）

- 无头 Chrome 可以访问论坛，HTTP 200。
- `/sign.php` 跳转到 `plugin.php?id=k_misign:sign`，签到插件为 `k_misign`。
- 独立手动登录后，可在无头 Chrome 中复用会话。
- 已签到专用页面标记为 `.qdleft .btnvisted`；同时核实非零账号 ID、退出登录入口、没有可点击签到按钮。
- 站点使用定制 TNCode，图片为 240×450，分为背景、拼图块、完整背景三个 240×150 区域，拼图块宽 50。
- 在未登录的登录页观察同一 TNCode 组件：初始显示完整图，按住滑块才显示缺口；已保存 `captcha-before.png`、`captcha-during.png`，未松开鼠标、未提交验证码。
- 2026-10-06 实测：登录会话仍有效，开始时未签到，已完成无头自动滑块验证及外层提交。通过验证的挑战定位偏移为 121 像素，服务端接受浏览器拖动轨迹。
- 外层表单为 `v2_captcha_form`，提交按钮为 `submit-btn`，操作为 `plugin.php?id=k_misign:sign&operation=qiandao`。外层提交返回 HTTP 302，此后两次读取论坛签到页均确认账号已签到。
- 此次实验先遇到验证码入口检查过早、绿色描边干扰图片匹配、服务端行为异常 E005、302 被误报为失败，均已根据实测修正。最终签到成功确认来自论坛页面，不依赖 HTTP 状态或验证码成功提示。
- 已实测完整无头签到，尚不能保证每天、所有图片及后续论坛版本都成功。每轮最多提交一次验证码；暂时故障先按十轮、20 秒策略补试，失败证据分别保存到 `artifacts/runs/<运行编号>/`。
- 自动定位的回归测试覆盖绿色描边、重复背景和未知尺寸；账号状态测试覆盖未登录、未签到、已签到及矛盾状态。

## 研究命令

```powershell
npm run probe
npm run research
npm run inspect:captcha
node inspect-sign.mjs
npm test
node checkin.mjs --no-session
```

`probe` 观察公开首页；`research` 读取当前会话签到页及公开脚本；`inspect:captcha` 观察登录页验证码并拖动 40 像素，关闭浏览器前不松开鼠标，不向验证码服务提交。`inspect-sign` 观察当前会话签到页及验证入口，保存挑战图并计算定位，不提交验证或签到。观察文件可能包含账号信息，不应提交或公开。

## Chrome 打开时触发

暂未修改 Chrome 快捷方式或系统任务计划；目前采用下文的用户登录启动项。完整签到已验证，也可以作为后续 Chrome 触发入口。实现时可用专用启动脚本启动普通 Chrome，同时后台运行本项目的无头签到命令；只修改快捷方式不能覆盖所有打开 Chrome 的方式。现有程序会每次核实论坛状态并通过锁避免并发。

## 登录 Windows 后自动运行

已选择：当前用户登录 Windows 后等待 180 秒，再静默执行签到。通过当前用户的启动文件夹中的 `LaowangForumCheckin.vbs` 启动，PowerShell 窗口隐藏，Chrome 保持无头模式，不依赖 Codex 或终端保持打开。

启动入口指向本目录的 `run-checkin.ps1`。最近结果保存在 `artifacts/last-result.json`，每次后台运行追加到 `artifacts/startup.log`。已签到会跳过；登录过期则记录失败，需要手动执行 `npm run login` 更新会话。不要移动或删除本项目目录，否则启动入口会失效。

2026-10-08 根据 Windows 重启事件确认运行被打断与旧空锁残留的时间一致。修复后已完成签到并两次复查；随后改用 Windows 自动释放的互斥，加入超时保护、每 5 分钟到期检查和逐步日志；2026-10-12 取消原六次尝试上限，详见相邻 `shared/README.md`。

Windows 可能略微延迟处理启动项，因此 3 分钟从此启动入口运行时开始计时。此设置针对用户登录，不会在锁屏后解锁或单纯从睡眠恢复时重复触发。

重新安装或关闭自动启动：

```powershell
# 当前项目目录中重新安装
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-startup.ps1 -Mode Logon
# 关闭自动启动，保留项目与会话
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\remove-startup.ps1
```
