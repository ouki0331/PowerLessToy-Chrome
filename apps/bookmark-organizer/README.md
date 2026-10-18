# Bookmark Organizer

在 Chrome 新标签页中按分类、项目或主题组织并访问常用链接。

## 状态

核心 MVP 产品定义已达到 `Ready for Delivery`；结构化文件导入仍处于 `Defining`，当前均未实现。

产品规格：[`docs/product/bookmark-organizer.md`](../../docs/product/bookmark-organizer.md)

UI/UX 指引：[`docs/product/bookmark-organizer-ui.md`](../../docs/product/bookmark-organizer-ui.md)

## 规划范围

- 用完整书签工作台替代 Chrome 默认新标签页
- 管理可增删的分类、分组和带环境标识的链接
- 普通点击当前页打开，`Ctrl/Command+点击`在新标签页打开

## 后续导入需求

- 需要支持从用户准备的结构化文件批量导入分类、分组和链接。
- 候选格式为 JSON 或 XML，当前推荐 JSON 作为主格式，但正式 Schema 尚未确认。
- 导入前必须完成全量校验并展示分类、分组、链接及错误摘要；用户确认前不得写入现有数据。
- 合并/替换策略、重复链接处理、版本字段和 XML 兼容性仍需单独完成产品定义。
- 该能力编号为 `DATA-IMPORT-001`，当前状态为 `Defining / Not built`，不属于当前可直接实现的 MVP。

## 暂不包含

- 账号、云端或跨设备同步
- 读取、导入或修改 Chrome 原生书签
- 搜索、自动抓取网站信息或链接统计
- 当前 MVP 的结构化文件导入

## UI 实现要求

- 新标签页 UI 必须遵循仓库中的 Bookmark Organizer UI/UX 指引。
- 实现 agent 应使用已安装的 Impeccable 技能，并采用 `Operate` 模式进行设计与验证。
- 工作型界面可以克制，但不能以默认组件堆叠、视觉状态缺失或低质量空状态作为简化手段。
