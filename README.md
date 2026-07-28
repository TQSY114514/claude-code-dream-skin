# Claude Code Dream Skin

<p align="center">
  <strong>中文</strong> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <strong>给 Claude Code 桌面端换一张会呼吸的脸。</strong><br>
  外部主题 / 换肤工具 · 不修改官方安装包
</p>

<p align="center">
  一张图，一种心情 · 写代码，也要有氛围感
</p>

## 它做什么

- **CDP 外部注入**：通过 Chrome DevTools Protocol 向 Claude Desktop 注入 CSS
- **不修改官方文件**：不修改 app.asar，不破解签名
- **CSS 变量系统**：20+ 自定义属性控制每个视觉元素
- **多图层背景**：背景图片 + 模糊 + 视差效果
- **17 款预设主题**：Default / Gothic Neon / Tokyo Night / Forest Mist / Sakura Dream / Midnight Glass / Aurora / Sunset Boulevard / Ocean Deep / Catppuccin Mocha / Dracula / Solarized Light / Rosé Pine / Cyberpunk / 超天酱 · INTERNET ANGEL / 超天酱 · INTERNET ANGEL · Pixel Cafe / Gothic Void Crusade
- **自定义导入**：支持 .zip 主题包导入
- **自动备份**：切换主题前自动备份，一键恢复
- **系统托盘**：后台运行，右键切换主题
- **安全设计**：不上传数据、不读 API Key、不改配置

## 工作原理

```
┌──────────────────────────────────────────────┐
│          Claude Code Desktop                 │
│  Electron 42.7.0  (Claude.exe)               │
│  ┌────────────────────────────────────┐       │
│  │  Main Process                      │       │
│  │  ┌─────────────┐  ┌────────────┐   │       │
│  │  │  Renderer 1 │  │ Renderer 2 │   │ ... │
│  │  │  (app.asar) │  │ (app.asar) │   │       │
│  │  └─────────────┘  └────────────┘   │       │
│  └────────────────────────────────────┘       │
└──────────────────────────────────────────────┘
         ▲                              ▲
         │ CDP WebSocket               │
         │ (--remote-debugging-port)   │
         │                              │
  ┌──────┴──────────────────────────────┴──────┐
  │   Dream Skin Manager  (Electron Tray App)  │
  │  ┌────────────────┐  ┌──────────────────┐  │
  │  │ Theme Engine   │  │ CDP Injector     │  │
  │  │ - 14 款预设主题 │  │ - 连接检测       │  │
  │  │ - 变量系统     │  │ - CSS 注入       │  │
  │  │ - 导入/导出    │  │ - 导航监控       │  │
  │  └────────────────┘  └──────────────────┘  │
  │  ┌────────────────┐                        │
  │  │ Backup Manager │                        │
  │  │ - 自动备份     │  ┌──────────────────┐  │
  │  │ - 一键恢复     │  │ Process Manager  │  │
  │  │ - 最多 10 份   │  │ - 自动检测 Claude │  │
  │  └────────────────┘  │ - 带 CDP 启动    │  │
  │                      └──────────────────┘  │
  └─────────────────────────────────────────────┘
```

1. **检测** — 扫描运行中的 Claude Desktop 进程
2. **启动** — 以 `--remote-debugging-port=9222` 重启 Claude
3. **连接** — 建立 CDP WebSocket 连接
4. **注入** — 通过 `CSS.addStyleSheet` 应用主题 CSS
5. **监控** — 页面导航/刷新时自动重新注入
6. **备份** — 自动保存原始状态以便恢复

## 快速开始

### 从源码运行

```bash
npm install
npm run build:assets   # 编译 runtime 主题资源（必需，否则注入会失败）
npm start
```

> 没运行 `build:assets` 也能启动，注入器会回退到源文件并在内存里即时编译，
> 但控制台会有警告，性能略差。打包发布前务必先跑一次。

### 检测顺序说明

`findClaudePath()` 现在按以下顺序检测 Claude Desktop（先匹配的优先）：

1. 手动保存的路径（设置页里填的）
2. `CLAUDE_DESKTOP_PATH` 环境变量
3. 正在运行的 `Claude.exe` 进程
4. **官网安装版**（`%LOCALAPPDATA%\Programs\Claude\Claude.exe` 等）
5. Microsoft Store 包（`Get-AppxPackage *Claude*`）
6. 开始菜单快捷方式
7. `WindowsApps` 目录扫描

Store 版的 Claude 因为 MSIX 沙箱限制，命令行参数会被吞掉，
必须走 COM 激活（`store-activate.ps1`）。官网安装版没这个问题，
直接 `Claude.exe --remote-debugging-port=9222` 就行。

### 构建安装包

```bash
npm run build-win
```

## 预设主题

| 主题 | 风格 |
|------|------|
| Default | 默认深色，Claude 标志性橙色 |
| Gothic Neon | 暗色紫青赛博朋克 |
| Tokyo Night | 东京夜景风格 |
| Forest Mist | 自然绿色调 |
| Sakura Dream | 樱花粉紫浪漫 |
| Midnight Glass | 玻璃拟态深蓝 |
| Aurora | 北极光青紫渐变 |
| Sunset Boulevard | 温暖紫橙渐变 |
| Ocean Deep | 深海蓝珊瑚色 |
| Catppuccin Mocha | 温暖奶昔柔彩 |
| Dracula | 官方 Dracula 紫粉 |
| Solarized Light | 精密配色亮色主题 |
| Rosé Pine | 优雅玫瑰松针 |
| Cyberpunk | 霓虹黄青洋红纯黑 |
| 超天酱 · INTERNET ANGEL | 粉青紫像素风，2560x1440 JPEG |
| 超天酱 · INTERNET ANGEL · Pixel Cafe | 同上，无损 PNG 版 |
| Gothic Void Crusade | 暗金哥特风 |

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

`theme.json`:
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

## 运行测试

```bash
npm test
```

## 安全设计

- 不修改官方安装包（app.asar）
- 不替换官方文件
- 不破解签名
- 不修改核心逻辑
- 全部修改可恢复
- 自动备份（最多 10 份）
- 不上传用户数据
- 不读取 API Key
- 不修改 Claude 配置
- 不修改模型设置

## 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | Electron 34 |
| 注入方式 | Chrome DevTools Protocol |
| 前端样式 | 原生 CSS + CSS Custom Properties |
| 打包 | electron-builder 25 |
| 主题压缩 | adm-zip |

## 许可证

MIT License

## 致谢

灵感来自 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) by Fei-Away 以及 [Codex Dream Skin (Internet Angel fork)](https://github.com/EmiyaKatuz/Codex-Dream-Skin) by EmiyaKatuz。

---

> 本项目与 Anthropic PBC 无任何关联。
