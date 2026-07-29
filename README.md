<p align="center">
  <img src="./docs/images/hero.svg" alt="Claude Code Dream Skin" width="880">
</p>

<p align="center">
  <strong>中文</strong> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/TQSY114514/claude-code-dream-skin/blob/master/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <img alt="Platform: Windows" src="https://img.shields.io/badge/Platform-Windows-blue.svg">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-34-47848F.svg">
  <img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg">
  <img alt="Method: CDP" src="https://img.shields.io/badge/Injection-CDP-ff45c8.svg">
</p>

<p align="center">
  <strong>给 Claude Code 桌面端换一张会呼吸的脸。</strong><br>
  外部主题 / 换肤工具 · 本机 CDP 注入 · 不修改官方安装包
</p>

<p align="center">
  一张图，一种心情 · 写代码，也要有氛围感
</p>

---

## 它做什么

通过 Chrome DevTools Protocol 向 Claude Desktop **外部注入** CSS 主题，不碰官方二进制、不破签名、不改配置。

- **CDP 外部注入** — 通过 `--remote-debugging-port` 建立 WebSocket，调用 `CSS.addStyleSheet` 应用主题
- **不修改官方文件** — app.asar / 签名 / 核心逻辑全部保留
- **CSS 变量系统** — 20+ 自定义属性控制每个视觉元素
- **多图层背景** — 背景图片 + 模糊 + 视差，首页突出氛围、任务页自动降干扰
- **17 款预设主题** — 从 Claude 标志性橙到哥特暗金、樱花粉紫、像素风
- **自定义导入** — 支持 `.zip` 主题包，Safe CSS 校验后入库
- **自动备份** — 切换前自动备份，一键恢复，最多 10 份
- **系统托盘** — 后台运行，右键切换，导航/刷新自动重注入
- **安全设计** — 不上传数据、不读 API Key、不改 Claude 配置

> 非 Anthropic 官方产品。Claude 及相关权利归其权利人。

## 预设主题

<p align="center">
  <img src="./docs/images/themes.svg" alt="17 款预设主题色板" width="880">
</p>

每款主题由 `accent` 色 + 背景色 + CSS 变量系统驱动，支持自定义背景图导入。

## 工作原理

<p align="center">
  <img src="./docs/images/architecture.svg" alt="CDP 外部注入工作原理" width="880">
</p>

1. **检测** — 扫描运行中的 Claude Desktop 进程（支持官网版 / Microsoft Store 包）
2. **启动** — 以 `--remote-debugging-port=9222` 重启 Claude
3. **连接** — 建立 CDP WebSocket（仅绑 `127.0.0.1`）
4. **注入** — 通过 `CSS.addStyleSheet` 应用主题 CSS
5. **监控** — 页面导航/刷新时自动重新注入
6. **备份** — 自动保存原始状态以便恢复

> ⚠️ **重要限制**：当前 Microsoft Store 版和官网下载版 Claude 都是 MSIX 包，沙箱会剥离 `--remote-debugging-port` 命令行参数，CDP 注入**无法工作**。详见下方[已知限制](#已知限制)。

## 快速开始

### 从源码运行

```bash
npm install
npm run build:assets   # 编译 runtime 主题资源（必需，否则注入会失败）
npm start
```

> 没运行 `build:assets` 也能启动，注入器会回退到源文件在内存里即时编译，但控制台会有警告。打包发布前务必先跑一次。

### 构建安装包

```bash
npm run build:win      # 生成 NSIS 安装包到 dist/
```

### 使用流程

1. 启动 Dream Skin Manager（托盘出现图标）
2. 在「Settings」标签页确认 Claude Desktop 已检测到
3. 点「Restart Claude with CDP」重启 Claude（首次会带 CDP 参数）
4. 在「Themes」标签页选择主题并应用
5. 切换/导入/恢复全部通过托盘右键菜单操作

## 主题格式

每个主题是一个目录：

```
themes/
├── default/
│   ├── theme.json        # 元数据 + 颜色配置
│   └── style.css         # CSS 自定义属性
├── midnight-glass/
│   ├── theme.json
│   ├── style.css
│   └── background.png    # 可选背景图片
```

`theme.json` 示例：

```json
{
  "name": "Midnight Glass",
  "displayName": "Midnight Glass",
  "author": "Your Name",
  "version": "1.0.0",
  "description": "深色玻璃拟态主题",
  "colors": {
    "accent": "#22d3ee",
    "bg": "#0a0e17",
    "panel": "#111827",
    "surface": "#1e293b",
    "text": "#e2e8f0",
    "muted": "#64748b"
  }
}
```

## 已知限制

### Microsoft Store / 官网 MSIX 版 Claude 暂不支持 CDP 注入

Anthropic 当前只分发 MSIX 格式的 Claude Desktop（包括官网下载的 `Claude Setup.exe`——它只是 MSIX 引导器，运行时下载并安装的还是 MSIX 包）。MSIX 沙箱会**剥离 `--remote-debugging-port` 命令行参数**，导致 Dream Skin 无法开启 CDP 端口。

**这不是 Dream Skin 的 bug，是 MSIX 的硬性限制**。我们已尝试所有可行路径，均无法绕过：

| 方案 | 结果 |
|------|------|
| 直接 `Claude.exe --remote-debugging-port=9222` | 参数被 MSIX 沙箱剥离，主进程命令行只剩纯 exe 路径 |
| `explorer.exe shell:AppsFolder\...` 启动 | 同上，且这种方式本身不支持传命令行参数 |
| COM 激活 `IApplicationActivationManager` | `ApplicationActivationManager` 是 WinRT 类，.NET Framework / PowerShell 5.1 的 `QueryInterface` 返回 `E_NOINTERFACE` |
| 配置文件 / 环境变量开启 CDP | Electron 只支持命令行参数开启 CDP，无替代方案 |

**与 Codex Dream Skin 的对比**：Codex Dream Skin 在相同版本的 Store 包上遇到完全相同的问题（见其 [issue #235](https://github.com/Fei-Away/Codex-Dream-Skin/issues/235) 和 [runtime-notes.md](https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/windows/references/runtime-notes.md)），他们也将当前能力定位为"诊断加固，不宣称受影响版本已恢复兼容"。

**临时方案**：如果你有旧版 NSIS 安装包（装到 `%LOCALAPPDATA%\Programs\Claude\` 的那种，非 WindowsApps 路径），可以直接用 NSIS 版，CDP 注入正常工作。

**等待修复**：需要 Anthropic 后续提供 NSIS 安装包，或在 MSIX 包中开放 CDP 配置项。在此之前，Dream Skin 的主题管理、SVG 资产、面板功能仍可正常使用，只是无法注入到 Claude 中。

---

## 安全设计

- 不修改官方安装包（app.asar）
- 不替换官方文件、不破解签名、不修改核心逻辑
- 全部修改可恢复，自动备份最多 10 份
- CDP 只绑 `127.0.0.1`，主题运行期间勿跑来路不明的本机程序
- 不上传用户数据、不读取 API Key、不修改 Claude 配置与模型设置

## 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | Electron 34 |
| 注入方式 | Chrome DevTools Protocol |
| 前端样式 | 原生 CSS + CSS Custom Properties |
| 打包 | electron-builder 25 |
| 主题压缩 | adm-zip |

## 运行测试

```bash
npm test
```

## 致谢

灵感来自 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) by Fei-Away 以及 [Codex Dream Skin (Internet Angel fork)](https://github.com/EmiyaKatuz/Codex-Dream-Skin) by EmiyaKatuz。

## 许可证

[MIT License](./LICENSE)

---

> 本项目与 Anthropic PBC 无任何关联。Claude 及相关权利归其权利人。
