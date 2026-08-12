---
title: C12_VLM：面向实验室仪器 HMI 的视觉语言 GUI Agent
date: 2026-08-12 10:00:00
permalink: /2026/08/12/c12-vlm-gui-agent/
tags: [VLM, Qwen3-VL, GUI Agent, OmniParser, ScreenGraph, 屏幕理解, 实验室自动化, 视觉计算系列]
categories: [视觉计算]
mathjax: true
---

这是一个 **VLM（视觉语言模型）项目**，而且不是"给截图配文字说明"那种 VLM 项目——它的目标是把实验仪器屏幕变成一个机器人可以**感知、理解、规划、执行和验证**的可闭环任务环境。简单说：机器人用摄像头拍下色谱仪 HMI 屏幕，看懂当前界面和任务进度，决定下一步该点哪里，真正执行点击，再重新观察确认操作是否成功，直到整条实验流程（Auto Prime → 选方法 → 编辑梯度 → 确认参数 → 运行）自动完成。

本文基于项目说明文档梳理：先讲它真正解决的问题和核心设计思想，再沿着"感知 → 理解 → 规划 → 执行 → 验证"逐层拆解，最后给出当前评测数字与瓶颈。需要说明的是，本文是对项目文档的结构化解读，代码实现与评测产物尚未逐一核验，文中会明确标注哪些是文档确认、哪些是合理推断。

<!-- more -->

## 1. 项目定位：从"看懂屏幕"到"完成任务"

### 1.1 操作对象与输入输出

项目面向的是实验室色谱设备（如 CombiFlash NextGen）上的 PeakTrak 类 HMI 软件。这类界面和普通网页最大的区别是：**它不向外部暴露 DOM、Accessibility Tree 或控件 ID**，自动化系统只能拿到一张像素图。

系统的输入有两类：

- 机器人摄像头拍摄的真实仪器屏幕照片；
- 浏览器中 HMI 模拟器的截图。

两种输入统一归一化到 **1200×700** 的逻辑坐标系，后续的检测、标注、VLM 推理和点击映射都围绕这一坐标系工作。

系统输出三类结果：

1. **UI 结构化理解**：屏幕上有哪些元素、类型、文字、位置、是否可点击（ScreenGraph JSON）；
2. **下一步动作及点击位置**：该点哪个目标、动作类型、理由、坐标；
3. **多步工作流计划**：把"启动 Auto Prime → 选方法 → 编辑梯度 → 确认参数 → 运行"这样的任务级流程串起来。

### 1.2 三个递进目标

项目说明把最终目标分成三层：

| 层级 | 能力 | 说明 |
|---|---|---|
| Level 1 | 屏幕理解 | 机器人看到 HMI，能理解界面上有什么 |
| Level 2 | 自主操作 | 能选择下一步动作并点击正确控件 |
| Level 3 | 任务级实验自动化 | 多步推理、状态跟踪、自适应操作、验证闭环，直到完成实验工作流 |

真正有价值的是 Level 3。这也是为什么本文把它定位为"VLM GUI Agent / Robotics GUI Agent"，而不是"UI 检测器"或"截图问答"。

## 2. 核心问题：为什么不能只靠一种模型

如果系统直接拥有网页 DOM，自动化非常简单：找到 `button[name=Start]`，然后 `click()`。但真实仪器场景只有相机图像，Agent 不知道：

- 哪些区域是按钮、哪些文字属于按钮；
- 哪些是标签、哪些是数值显示、哪些是弹窗；
- 当前页面处于什么状态、下一步该选哪个控件；
- 控件真实坐标是多少、点击后有没有成功。

项目文档对三类能力做了非常清晰的对照：

| 能力 | 擅长 | 不擅长 |
|---|---|---|
| OmniParser / YOLO / OCR | 检测可点击区域、bbox、文字位置 | 语义决策（该点哪个、何时 wait） |
| VLM（Qwen3-VL） | 屏幕语义、弹窗状态、下一步动作 | 精确像素坐标（容易幻觉） |
| DOM / 模拟器 | 精确坐标、状态机、可复现 | 无法直接用于真机照片 |

结论是**各取所长、分层融合**：检测层给坐标，VLM 层给语义，Planner 把两者合并成统一的 `click_plan`。

## 3. 最核心的设计思想：语义与坐标分离

假设屏幕上有 `[Cancel]` 和 `[Start]` 两个按钮。最直接的做法是让 VLM 直接输出：

```json
{ "x": 640, "y": 350 }
```

但 VLM 擅长的是视觉语义、界面意图和任务推理，**像素级坐标回归并不稳定**。即使模型知道"Start 在页面中间偏右"，也不一定能稳定给出精确坐标。

所以项目采用 Hybrid 方案：

```text
图片
+ OmniParser 给出的候选 GUI 元素（ScreenGraph）
+ 任务描述
        ↓
      Qwen3-VL
        ↓
      target_label = "Start"
        ↓
 从 ScreenGraph 查 bbox → center → click
```

问题从"在连续二维空间里画一个准确坐标"（画点题），变成"从已有候选元素中选择一个"（选择题）。这是整个架构的立足点。

## 4. 系统架构：四层 + 闭环

项目分为四层：**感知层（Perception）→ 理解层（Understanding）→ 规划层（Planning）→ 执行层（Execution）**，外面再套一个 Agent 闭环（Observe → Plan → Act → Verify）。

![C12_VLM 四层架构与 Agent 闭环](/images/projects/c12-vlm-gui-agent/c12-vlm-architecture.png)

*图：按项目文档重绘的四层架构与 Agent 闭环。虚线表示 replan/下一步的闭环回路。*

这套结构和经典机器人系统（感知 → 认知 → 规划 → 控制 → 反馈）高度一致，区别只是操作对象是实验仪器 GUI 而不是杯子或门。

## 5. 感知层：机器人怎样"看清"屏幕

### 5.1 屏幕归一化

真实相机照片不会是一张完美的截图，可能存在倾斜、透视、黑边、反光、曝光差异，屏幕也不一定在画面中央。因此第一步是屏幕提取与归一化：

```text
原始照片
  → scan_screen.py（CamScanner 增强 / HSV 兜底）
  → 1200×700 归一化屏幕图
  → run_omniparser.py
```

统一成 1200×700 之后，bbox、标注、VLM 中的元素坐标、点击映射就都在同一个逻辑坐标系里，不需要为不同分辨率维护不同的换算规则。

### 5.2 OmniParser：把屏幕变成结构化元素

感知层的核心是 Microsoft 开源的 OmniParser，链路为：

```text
PaddleOCR 文字框 → YOLO icon 检测 → Florence icon 描述 → ScreenGraph JSON
```

三个视觉能力的职责不同：

| 模块 | 回答的问题 | 示例 |
|---|---|---|
| PaddleOCR | 这里写了什么字 | Start、Cancel、Pressure |
| YOLO | 有没有图标/控件，在哪里 | 定位播放图标 bbox |
| Florence | 这个无文字图标看起来是什么 | "play icon"、"settings icon" |

Florence 是**局部图标描述器**，不是整页决策模型；它只负责给 YOLO 检出的无文字图标补充视觉语义，让后面的 Qwen3-VL 不必面对一堆匿名 bbox。

### 5.3 PSI OCR：专用状态读取

除了全屏 UI 解析，系统还有一条"专用状态读取"通路：对压力值这类出现在固定 ROI、格式稳定的数值，直接用固定区域裁剪 + PaddleOCR 读取，而不是每次都让 VLM 从整张图里猜。项目文档的定位是：

```text
OmniParser OCR → 页面有哪些文字（建 ScreenGraph）
PSI OCR       → 当前压力具体是多少（给 Planner/state）
Qwen3-VL      → 这个状态意味着什么、下一步做什么
```

能用稳定传统视觉方法解决的问题，不一定要全部交给 VLM。

### 5.4 专项视觉子项目

仓库还包含多个专项视觉项目：LCMS 屏幕分割（YOLO26s-seg + 黑边兜底）、色谱图表面板 ROI 提取（传统 CV）、Cloudflare 验证框点击（YOLO + VLM 对比）、管架场景分割（A_Guan_seg）。它们不是 Agent 主循环的一部分，但共同体现了"围绕实验室视觉与 GUI 感知逐步扩展"的脉络。

## 6. ScreenGraph：整个项目的统一中间表示

ScreenGraph 是把"真实 GUI 世界"变成"Agent 可理解世界"的中间层，一个元素大致是：

```json
{
  "id": 12,
  "type": "icon",
  "text": "OK",
  "bbox_xyxy": [600, 330, 680, 370],
  "center_xy": [640, 350],
  "clickable": true
}
```

它最重要的价值是**接口统一**：

```text
真实相机 → OmniParser → ScreenGraph
模拟器   → DOM 导出   → ScreenGraph（同一 schema）
```

上层 Agent 不需要关心元素来自真实视觉检测还是来自 DOM。模拟器因此可以**用 DOM ScreenGraph 直接替代真实 OmniParser**，省掉 GPU 上的 OCR/YOLO/Florence 推理，让 Agent 逻辑的开发与视觉感知的开发部分解耦。

## 7. 理解层：Qwen3-VL 到底做什么

主选模型是 `Qwen/Qwen3-VL-8B-Instruct`，并保留 Qwen2.5-VL-7B、Qwen2-VL-2B 做对比实验，以及 CogAgent-9B（GUI 专用 VLM，BF16 约 29GB 显存）做路线对照。

VLM 的职责被明确限定为两类（可以由同一个模型承担，区别在 Prompt、上下文和期望输出）：

1. **GUI 语义理解**："我现在看到的是什么界面？这个弹窗表示什么？有哪些关键控件？"
2. **任务条件规划**："为了完成当前任务，下一步应该做什么？"——需要把当前 GUI + ScreenGraph + 任务目标 + 状态一起作为上下文。

注意两点：

- **VLM 的输入不是两张图**。OmniParser 的结果不是作为第二路图像输入，而是以 **ScreenGraph JSON 文本嵌入 Prompt**，VLM 只看一张归一化图 + 文本上下文。
- **理解与规划不是两个模型**。同一个 Qwen3-VL 通过不同 Prompt 承担"这是什么界面"和"下一步做什么"两个任务。

## 8. 规划层：把语义变成坐标

VLM 输出的是语义目标（如 `target_label: "Start"`），而不是坐标。规划层 `fuse_planner` 做三源融合：

```text
PSI OCR（压力等专用状态）
+ VLM（recommended_next_action、弹窗语义）
+ OmniParser（可点击元素坐标）
        ↓
   plan.json（统一动作合同）
        ↓
   target_label → ScreenGraph 查 bbox → center_xy
```

`plan.json` 是"上层智能理解和下层机器人执行之间的统一动作合同"，例如：

```json
{
  "action": "click",
  "target_label": "Start",
  "center_xy": [640, 350],
  "bbox_xyxy": [600, 330, 680, 370],
  "reason": "Auto Prime dialog waiting for operator confirmation"
}
```

（具体 schema 以源码为准，这里只表达文档描述的结构。）

## 9. 执行层：点击怎么真正发生

执行层有三种方式：

1. **iframe 语义模拟**：在浏览器 HMI 模拟器里直接触发 DOM 点击，用于快速测试 Agent 推理、工作流和验证逻辑；
2. **PyAutoGUI 真实鼠标**：真机场景用本地 Click Agent（`127.0.0.1:9876`）+ `calib.json` 坐标映射完成真实点击；
3. **YOLO 专用点击**：针对特定验证框（如 Cloudflare）的专项路径。

为什么 PyAutoGUI 必须放在本地笔记本而不是 GPU 服务器？因为浏览器运行在本地，SSH 转发只是把服务器的 HTTP 服务转发过来，**服务器上的 PyAutoGUI 只能操作服务器的桌面，点不到用户笔记本的屏幕**。所以部署拓扑是：

```text
GPU 服务器（AutoDL）
  ├─ 静态 Pipeline UI :8767
  └─ VLM API :8768（Qwen3-VL 推理）
           │ HTTP
           ▼
本地笔记本
  ├─ 浏览器（HMI 模拟器 / 远程 Pipeline 页）
  └─ Click Agent 127.0.0.1:9876 → PyAutoGUI → 本地鼠标
```

坐标映射需要把 1200×700 的逻辑坐标换算到真实显示器坐标，考虑窗口边框、iframe 偏移、浏览器缩放等因素；`calib.json` 记录这些映射参数（具体字段与公式需源码确认）。

## 10. Agent 闭环：为什么验证比执行更重要

传统脚本是"点击 → sleep → 点击"，一旦页面卡顿、弹窗、点击错位或设备响应慢，后面所有步骤都会错。项目采用 Agent 闭环：

```text
Observe（截图 + ScreenGraph + sim_state）
  → Perception（Omni / DOM → click_targets）
  → VLM Plan（Qwen3-VL 输出 click_instruction）
  → Execute（iframe 或 PyAutoGUI）
  → Verify（label 匹配 / 禁点检查 / 门控 score）
  → 成功则推进任务，失败则 replan
```

验证环节不会默认"我点击了所以一定成功"，而是重新观察：点击以后页面变了吗？目标状态出现了吗？点到的是期望元素吗？这个元素当时是否允许点击？这套 Sense → Plan → Act → Feedback 的结构更接近机器人控制系统。

任务层面，工作流被理解成状态机：主界面 → 点击 Auto Prime → 确认弹窗 → 点击 Start → Priming → 等待 → 完成。每一步都要重新 Observe-Understand-Act-Verify，因此比固定脚本更能适应页面变化和延迟。

## 11. 两条主 Pipeline

| 路径 | 场景 | 入口 | 特点 |
|---|---|---|---|
| 离线照片链 | 真机拍照评测、标注数据生产、VLM/Omni 联调 | `run_hybrid_scan_pipeline.sh` | 走完整 OmniParser，输出 ScreenGraph 用于评估 |
| 在线 Live Agent | HMI 模拟器 + VLM 逐步决策 | `vlm_pipeline.html` + VLM Server :8768 | 模拟器用 DOM graph，仅保留 VLM 决策 |

两条链共用 ScreenGraph schema：真机照片链从相机图像出发，在线链从模拟器 DOM 出发，但合流后（VLM → Planner → 执行 → 验证）的 Agent 逻辑完全一致。

## 12. 评测与当前瓶颈

项目建立了 GT40 v2 评测集：40 帧、1670 个元素，角色分为 `click_target`（可点击）、`value_display`（数值显示）、`field_label`（字段标签）、`dialog_chrome`（弹窗装饰）。这种标注比普通目标检测更有意义，因为它区分"可以点击"和"只是显示信息"。

项目说明文档记录的严格 curated GT 评测结果为：

| 指标 | 文档记录值 | 含义 |
|---|---:|---|
| click_target recall | ≈ 48.6% | 候选集只召回约一半真正需要点击的元素 |
| vlm_target_rate | ≈ 25.6% | 即使候选存在，VLM 正确选择目标的比例 |

这两个数字是当前系统最明显的瓶颈，且可以分层归因：

1. **候选召回是上限**：如果目标元素没有进入 ScreenGraph，VLM 再强也没有候选可选，Planner 无法 resolve，Agent 必然失败；
2. **语义选择是第二瓶颈**：候选存在不代表 VLM 选对，需要继续优化 Prompt、任务上下文、ScreenGraph 质量、元素命名、状态跟踪和历史；
3. **模拟器到真实的域差异**：模拟器是完美截图 + 完美 DOM，真实相机有透视、反光、模糊、OCR 噪声和漏检；
4. **坐标校准**：即使 VLM 决策正确、bbox 正确，1200×700 到物理屏幕的映射错误仍会点错；
5. **验证鲁棒性**：Verify 过弱会传播错误，过严会频繁拒绝正确动作，门控策略是系统稳定性的关键。

## 13. 技术栈一览

| 层 | 技术 |
|---|---|
| VLM | Qwen3-VL-8B（默认）、Qwen2.5-VL-7B、Qwen2-VL-2B、CogAgent-9B |
| 模型运行 | HuggingFace Transformers（>=4.57）、ModelScope 缓存 |
| OCR | PaddleOCR（OmniParser 文字 + PSI ROI 数值） |
| 检测/分割 | YOLO、YOLO-World、YOLO26s(-seg) |
| 图标描述 | Florence |
| 传统 CV | HSV、透视校正、CamScanner 增强、面板 ROI 提取 |
| GUI 自动化 | PyAutoGUI |
| 前端/服务 | HTML/JS/iframe/DOM、Python VLM Server（`POST /api/pipeline/step`） |
| 标注/评测 | Label Studio、GT40 v2、curated baseline |

## 14. 边界与下一步

### 当前能确定的（文档确认）

- 项目的定位是 VLM 驱动的 GUI Agent，核心设计是语义与坐标分离；
- ScreenGraph 是统一中间表示，真机与模拟器共用；
- 系统由四层架构 + Agent 闭环组成，有离线照片链与在线 Live Agent 两条管线；
- 文档记录的评测显示候选召回（~48.6%）与 VLM 目标选择（~25.6%）是当前两大瓶颈。

### 当前不能断言的（待核验）

- 各模块的源码实现、Prompt 具体格式、`plan.json`/`calib.json` 的真实 schema；
- VLM Server 的 Web 框架、模型量化与显存配置；
- 评测数字的独立复测结果（本文引用的是项目说明文档记录值）；
- 真实仪器上的端到端成功率。

### 最有价值的下一步

1. 拿到 C12_VLM 仓库源码，逐文件核验 `extract / fuse_planner / agent_loop / run_hmi_vlm_server / prompts / model_loader` 的实现与 schema；
2. 补充真实 HMI 截图、ScreenGraph 样例和 Agent 运行录屏，让文章从"架构解读"升级为"带真实产物"；
3. 独立复测 GT40 v2 指标，并把 recall 提升与 VLM 选择率提升分开评估；
4. 用已知屏幕/物体完成坐标校准与 Verify 门控的定量验证。

**相关阅读**：[多频外差相位展开：方法对比与塔形结构优化](/2026/08/10/multi-frequency-heterodyne/)（结构光相位解码的另一条路线）｜[FSM 频移结构光：从频率响应到投影坐标与三维点云](/2026/08/04/frequency-shift-phase-reconstruction/)（把屏幕/投影坐标变成三维点）。
