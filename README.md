# PowerLessToy

PowerLessToy 是一个 Chrome 工具扩展集合，目标是让浏览器中的信息整理、页面清理和消息查看更简单。

当前仓库只完成项目骨架，不包含实际业务功能。

## 扩展

| 扩展 | 目录 | 规划用途 |
| --- | --- | --- |
| Bookmark Organizer | `apps/bookmark-organizer` | 在新标签页按分类和分组管理常用链接 |
| Element Remover | `apps/element-remover` | 选取并移除网页中的指定元素 |
| Message Center | `apps/message-center` | 接收、保存并展示消息 |

## 仓库结构

```text
.
├── apps/                       # 三个独立 Chrome 扩展
│   ├── bookmark-organizer/
│   ├── element-remover/
│   └── message-center/
├── packages/
│   └── shared/                 # 可复用类型、工具和 UI（预留）
├── docs/
│   └── architecture.md         # 架构约定
└── scripts/
    └── validate-workspace.mjs  # 骨架一致性检查
```

每个扩展都采用 Manifest V3，并预留以下分层：

- `src/background`：Service Worker 与浏览器级事件
- `src/content`：注入页面的脚本
- `src/popup`：工具栏弹窗
- `src/options`：设置页
- `assets/icons`：扩展图标
- `tests`：扩展测试

以后新增扩展时统一遵循 [`apps/README.md`](apps/README.md) 中的固定目录、文件模板、权限规则和完成清单。

## 本地检查

```bash
pnpm check
```

该命令会检查工作区定义、三个扩展的清单文件，以及约定的目录是否齐全。

## 当前状态

- [x] Monorepo 与三个扩展目录骨架
- [x] Manifest V3 最小清单
- [x] 共享包预留目录
- [x] 自动结构校验
- [x] Bookmark Organizer 产品定义
- [x] Bookmark Organizer UI/UX 指引
- [ ] 书签整理功能
- [ ] Bookmark Organizer 结构化文件导入定义
- [ ] 页面元素选取与移除功能
- [ ] 消息接收与展示功能
