# 新增 Chrome 扩展规范

本目录中的每个一级子目录代表一个可以独立开发、构建和发布的 Chrome 扩展。

以后新增扩展时，只需提供以下两项信息：

1. 扩展名称与英文目录名。
2. 一句话说明扩展解决的问题。

其余目录、文件、命名和校验均按本文档执行，不需要再次逐项说明。

## 固定目录格式

新扩展必须使用小写 `kebab-case` 目录名，并创建完整的固定骨架：

```text
apps/<extension-slug>/
├── README.md
├── manifest.json
├── package.json
├── assets/
│   └── icons/
│       └── .gitkeep
├── src/
│   ├── background/
│   │   └── .gitkeep
│   ├── content/
│   │   └── .gitkeep
│   ├── options/
│   │   └── .gitkeep
│   └── popup/
│       └── .gitkeep
└── tests/
    └── .gitkeep
```

只有在目录尚无代码时才保留 `.gitkeep`。开始实现后，用真实文件替换它即可。

## 固定文件格式

### `package.json`

```json
{
  "name": "@powerless-toy/<extension-slug>",
  "version": "0.1.0",
  "private": true,
  "description": "<English one-line description>"
}
```

### `manifest.json`

骨架阶段只声明 Manifest V3 的最小元数据，不提前申请权限，也不引用尚未创建的脚本、页面或图标。

```json
{
  "manifest_version": 3,
  "name": "PowerLessToy <Extension Name>",
  "version": "0.1.0",
  "description": "<中文一句话说明>"
}
```

实现功能时才按需增加 `permissions`、`host_permissions`、`background`、`action`、`content_scripts`、`options_page` 和图标配置。

### `README.md`

每个扩展的 README 使用以下固定结构：

```markdown
# <Extension Name>

<中文一句话说明>。

## 状态

当前仅包含目录和 Manifest V3 最小清单，尚未实现业务功能。

## 规划范围

- <核心能力一>
- <核心能力二>

## 暂不包含

- <明确不在当前阶段实现的内容>
```

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `assets/icons` | 扩展图标及商店展示所需图像 |
| `src/background` | Service Worker、浏览器事件和跨页面状态 |
| `src/content` | 注入网页、读取或修改页面内容的脚本 |
| `src/options` | 持久化设置与配置界面 |
| `src/popup` | 点击浏览器工具栏图标后显示的界面 |
| `tests` | 单元测试、集成测试及必要测试夹具 |

不需要某一层时仍保留目录，避免不同扩展产生不同结构；确认长期不需要后，可在实现阶段连同架构说明一起调整。

## 共享代码规则

- 只被一个扩展使用的代码留在该扩展内部。
- 至少被两个扩展真实复用后，才移动到 `packages/shared`。
- 不在骨架阶段提前创建抽象层或添加运行依赖。

## 新增完成标准

- [ ] 目录名使用小写 `kebab-case`。
- [ ] 固定目录与文件全部存在。
- [ ] 包名为 `@powerless-toy/<extension-slug>`。
- [ ] Manifest 使用版本 3，名称、版本和描述完整。
- [ ] 骨架阶段未申请无依据的 Chrome 权限。
- [ ] 根目录 README 的扩展列表已更新。
- [ ] `pnpm check` 通过。
- [ ] 变更已提交到 Git。

仓库校验脚本会自动发现 `apps` 下的所有扩展目录，因此以后新增扩展时无需修改校验脚本中的名单。

