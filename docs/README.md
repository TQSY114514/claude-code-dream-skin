# Claude Code Dream Skin — 项目文档

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动应用

```bash
npm start
```

这会在 `~/.claude-dream-skin/` 目录下初始化配置文件，并从 `themes/` 目录复制内置主题。

### 3. 应用主题

1. 启动 Claude Desktop（正常启动即可）
2. 在 Dream Skin 界面选择主题，点击 **Apply**
3. 点击 **Restart Claude with CDP** 重启 Claude 以启用主题注入
4. 主题会自动注入到 Claude Desktop 窗口

## 项目结构

```
D:\ClaudeDreamSkin\
├── src/
│   ├── main/
│   │   ├── index.js           # Electron 主进程入口
│   │   ├── preload.js         # Context Bridge（暴露 window.cds API）
│   │   ├── theme/
│   │   │   └── index.js       # ThemeEngine — 主题管理核心
│   │   ├── injector/
│   │   │   └── index.js       # CDPInjector — CSS 注入引擎
│   │   ├── process-manager/
│   │   │   └── index.js       # ProcessManager — 进程查找与管理
│   │   └── tray/
│   │       └── index.js       # SkinManager — 托盘 + 窗口管理
│   └── renderer/
│       ├── index.html         # 4 标签页 UI
│       ├── styles/main.css    # 管理面板样式
│       └── app.js             # 渲染进程交互逻辑
├── themes/                    # 内置主题（14 个）
│   ├── default/               # Claude 签名橙
│   ├── gothic-neon/           # 赛博朋克紫+青
│   ├── tokyo-night/           # 东京夜色
│   ├── forest-mist/           # 自然绿意
│   ├── sakura-dream/          # 樱花粉紫
│   ├── midnight-glass/        # 深蓝玻璃态
│   ├── aurora/                # 北极光
│   ├── sunset-blvd/           # 日落大道
│   ├── ocean-deep/            # 深海蓝
│   ├── catppuccin/            # 经典 Mocha 配色
│   ├── dracula/               # 官方 Dracula
│   ├── solarized-light/       # Solarized 亮色
│   ├── rose-pine/             # 玫瑰松针
│   └── cyberpunk/             # 霓虹赛博
├── tools/
│   └── cdp-inspect.js         # CDP DOM 检测工具
├── test/
│   └── runner.js              # 20 个自动化测试
└── package.json
```

## 主题格式

每个主题是一个目录，包含：

```
themes/<theme-name>/
├── theme.json    # 元数据
└── style.css     # CSS 变量 + 注入规则
```

### theme.json

```json
{
  "name": "Theme Name",
  "displayName": "Display Name",
  "author": "Author",
  "version": "1.0.0",
  "description": "Description",
  "colors": {
    "accent": "#FF6B35",
    "bg": "#0d0d0f",
    "surface": "#141417",
    "text": "#e8e8ec",
    "muted": "#6e6e80"
  }
}
```

### style.css 结构

1. **`:root` 变量定义** — 12 个设计令牌（bg, panel, surface, text, muted, accent, border, radius, font-family, font-mono, line-height, transition）
2. **`.dream-skin-active` 容器样式** — scrollbar, selection
3. **各区域注入规则** — sidebar, messages, markdown, code, input, buttons

## 技术架构

```
┌─────────────────────────────────────────────────┐
│              Claude Desktop (Electron)            │
│  ┌───────────┐  ┌──────────────────────────┐     │
│  │ 主窗口     │  │ 渲染进程                  │     │
│  │ (Renderer)│  │ ┌─────┐ ┌─────┐ ┌─────┐ │     │
│  │           │  │ │Chat │ │Side │ │Input│ │     │
│  │           │  │ └─────┘ └─────┘ └─────┘ │     │
│  └─────┬─────┘  └──────────────────────────┘     │
│        │ CDP (port 9222)                          │
│  ┌─────┴─────┐                                   │
│  │ CDP 服务  │                                   │
│  └───────────┘                                   │
└─────────────────────────────────────────────────┘
        ▲
        │ chrome-remote-interface
        │
┌───────┴───────────────────────────────────────────┐
│          Dream Skin (本应用)                       │
│  ┌────────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ ProcessMgr │  │Injector  │  │  ThemeEngine  │ │
│  │ (进程管理)  │→ │ (CDP注入)│← │ (主题管理)    │ │
│  └────────────┘  └──────────┘  └───────────────┘ │
│  ┌────────────┐  ┌──────────┐                      │
│  │ Tray Icon  │  │ Renderer │ (UI 管理面板)        │
│  └────────────┘  └──────────┘                      │
└───────────────────────────────────────────────────┘
```

## CDP 注入流程

1. **ProcessManager** 找到 Claude.exe 路径和用户数据目录
2. 以 `--remote-debugging-port=9222` 重启 Claude
3. **CDPInjector** 通过 `chrome-remote-interface` 连接 CDP
4. 对每个页面 target，使用 `Target.attachToTarget` 创建 session
5. 在 session 中调用 `CSS.addStyleSheet` 注入主题 CSS
6. 调用 `Runtime.evaluate` 注入 JS guard 防止重复
7. 监听 `Page.frameNavigated` 和 `Page.domContentEventFired` 自动重注入

## 安全特性

- ✅ 不修改 app.asar
- ✅ 不修改官方安装文件
- ✅ 不绕过签名
- ✅ 不读取 API Key
- ✅ 不修改 Claude 配置
- ✅ 自动备份（切换主题前自动创建，保留最近 10 个）
- ✅ 一键恢复默认
- ✅ 所有操作通过 CDP 进行（外部注入，无文件修改）

## 测试

```bash
npm test
```

覆盖：ThemeEngine（12）、ProcessManager（3）、CSS 校验（3）、CDPInjector（2），共 20 个测试。

## CDP DOM 检测（手动测试）

当你需要检测 Claude Desktop 的实际 CSS 类名时，在 PowerShell 运行：

```powershell
cd D:\ClaudeDreamSkin
node tools/cdp-inspect.js
```

脚本会：
1. 关闭 Claude Desktop
2. 以 CDP 模式重启
3. 注入彩色测试 CSS
4. 等待 60 秒供你观察
5. 导出 DOM 结构到 `~/.claude-dream-skin/inspect/`
6. 恢复原状

详见 `tools/cdp-inspect.js` 的注释。

## 手动测试 CDP 注入

在 PowerShell 中运行检测脚本后，你会看到 Claude Desktop 窗口上有彩色边框。观察哪个区域是什么颜色，然后告诉我，我可以据此精修 CSS 选择器。
