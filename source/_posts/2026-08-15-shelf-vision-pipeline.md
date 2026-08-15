---
title: 货架多模型视觉检测流水线：从一张图到机器人可读的结构化结果
date: 2026-08-15 10:30:00
permalink: /2026/08/15/shelf-vision-pipeline/
tags: [计算机视觉, YOLO, 实例分割, 异常检测, YOLOE, PatchCore, AprilTag, 实验室自动化, 视觉计算系列]
categories: [视觉计算]
---

实验室自动化里，机器人需要先“看懂”货架：哪里是底座，上面放了什么，放得对不对，有没有不该出现的东西。一张普通 RGB 照片本身不携带这些语义，而固定类别检测模型又无法回答“多出来的物品是什么”这种开放问题。这个项目把问题拆成多个可独立训练的检测模型加一套规则编排，最终输出一份机器人可以直接消费的结构化 JSON 和一张供人复核的叠加图。

<!-- more -->

## 项目概览

| 项目要素 | 内容 |
|---|---|
| 项目目的 | 输入一张货架图，输出底座/物体的实例级分割、物体-底座合规关系、异常/异物结论、从左到右编号与结构化 JSON。 |
| 核心输入 | 货架 RGB 图或图像目录；底座/物体/异常模型权重；YAML 业务规则 |
| 核心输出 | `result.json`（bases/objects/relations/anomaly/markers/warnings）+ `*_pipeline_overlay.jpg` 叠加图 + 批量 `run_summary.json` |
| 项目重点 | 感知（YOLO 分割）、异常（YOLOE 差分或 PatchCore）、规则（几何+业务映射）、纠正（AprilTag）分层解耦，改规则不必重训模型。 |

## 完整实现流程

| 阶段 | 处理 | 阶段产出 |
|---:|---|---|
| 1 | 配置合并与输入收集 | 待处理图片列表与统一配置 |
| 2 | YOLO 底座/物体实例分割 | `bases[]`、`objects[]` |
| 3 | 异常检测（yoloe / patchcore / off） | `anomaly{}` |
| 4 | 定位码检测与类别纠正（可选） | `markers[]`、`marker_corrections[]` |
| 5 | 物体-底座关系匹配 | `relations[]`、`warnings[]` |
| 6 | 匹配成功物体从左到右编号 | `relations[].label` |
| 7 | 导出 JSON + 可视化 | `result.json`、`*_pipeline_overlay.jpg` |

![货架多模型视觉检测流水线](/images/projects/shelf-vision-pipeline/shelf-vision-pipeline.png)

*图 1：根据仓库代码与 README 重绘的流水线结构。它说明系统如何组织，不表示某次运行的实验效果。*

## 一、为什么是“多模型 + 规则”，而不是一个万能模型

货架场景要回答的问题横跨三个层次：

1. **结构层**：底座（7 类）和目标物体（10 类）在哪——这是实例分割问题；
2. **合规层**：物体是否落在正确的底座上——这是几何与业务规则的组合；
3. **异常层**：有没有不在已知集合里的东西——这是开放集问题，固定类别模型无法直接覆盖。

把这三个层次放进同一个“万能模型”会同时放大标注成本、训练难度和换场景的代价。仓库因此选择模块化：底座和物体分开训练（也可用统一 17 类模型），异常检测后端可随时切换，业务规则写在外置 YAML 里。改一条“清洗柱只能放在 base1 上”的规则，只改配置，不碰代码，也不重训模型。

## 二、系统设计与主流程

主入口是 `pipeline/run_pipeline.py`。它对每张图按固定顺序执行，上一步的输出是下一步的输入，各 stage 之间通过字典传递数据，不共享全局状态。

| 模块 | 职责 |
|---|---|
| `stages/infer_yolo.py` | dual（底座+物体两模型）或 unified（17 类单模型）推理，统一为 `instances[]` 契约 |
| `stages/infer_yoloe_anomaly.py` + `diff_anomaly.py` | YOLOE 全物品检出，与已知区域做掩码差分，得到“未知物品” |
| `stages/infer_anomaly.py` + `refine_anomaly.py` | PatchCore 备选：正常特征记忆库打分 + 三步后处理 |
| `stages/correct_by_markers.py` | AprilTag 检测，按 `marker_rules.yaml` 几何规则纠正类别 |
| `stages/match_relations.py` | 判断每个物体是否在某个底座上、类名是否被允许，产生告警码 |
| `stages/number_objects.py` | 对合规物体按中心 x 从左到右、同类独立编号 |
| `export_json.py` / `visualize.py` | 组装 result.json，绘制绿/橙/红/品红语义叠加图 |

### 数据契约：`instances[]`

所有检测器输出统一结构，主流程不需要关心模型内部差异：

```json
{
  "class_name": "Column_Cleaning",
  "conf": 0.88,
  "bbox_xyxy": [120, 80, 340, 260],
  "polygon_xy": [[120, 80], [340, 85], "..."],
  "center_xy": [230, 170]
}
```

## 三、三套关键算法

### 1. 结构感知：YOLO 实例分割

底座 7 类（`base1`~`base7`）、物体 10 类（硅胶柱、清洗柱、样品管、废液桶、蒸发器等）。默认 `dual` 模式分别跑 `yolo_base` 与 `yolo_object` 两个分割模型；`unified` 模式用单个 17 类模型一次推理后按类名拆分，减少推理次数，但当前文档标注为“尚在验证中”，生产默认仍是 dual。

分割结果经过实例去重（同类掩码高重叠时保留高置信度），再交给后续关系判断和异常排除。

### 2. 异常检测：差分与记忆库两条路

异物没有固定类别，无法靠监督 YOLO 枚举。仓库提供两个后端：

- **YOLOE 差分（默认）**：用 prompt-free 预训练模型检出图中“所有”物品，再与底座/物体掩码做差分。差分逻辑包含三条规则：与已知实例 IoU 过高的剔除、被异常框大面积盖住的已知实例整框剔除、挖空已知区域后剩余面积过小的丢弃，并做像素级互斥，保证底座/物体区域不会被标成异常。
- **PatchCore（备选）**：只用正常样本训练特征记忆库，推理得到全图异常分数图，再经过分数阈值、YOLO 已知区域排除、小连通域过滤三步后处理。仓库文档说明它通过子进程调用独立虚拟环境运行。

### 3. 关系匹配：几何规则 + 业务规则

“在底座上”不是一个单一的几何定义。俯视时物体插入底座，用**重合度**判定（交集面积 / 较小面积 ≥ 阈值）；仰视托举时物体在底座上方且掩码紧密相连，用**邻接规则**判定（水平对齐 + 物体在上 + 竖直间隙在阈值内）。

几何判定之后还要查映射表：`Column_Cleaning` 只允许在 `base1` 上。两者都通过才算 `matched`，否则产生独立告警码：

| 告警码 | 含义 |
|---|---|
| `object_not_on_base` | 物体不在任何底座上 |
| `object_base_mismatch` | 物体在底座上但类名不在允许列表 |
| `no_mapping_rule` | 该物体缺少映射规则 |

### 4. 定位码纠正（可选）

当 YOLO 在相似底座上可能认错时，AprilTag 提供绝对空间锚点。`marker_rules.yaml` 里按标签 ID 的空间关系（上方、左侧、某行、夹层）强制纠正 `class_name`，并可为每个物体输出相对参考定位码的像素偏移。当前配置默认关闭，作为新场景的后备能力。

## 四、输出契约与可视化语义

`result.json` 是最终交付物，字段结构如下：

| 字段 | 含义 |
|---|---|
| `bases[]` | 检出的底座实例（类名、置信度、bbox、多边形、中心） |
| `objects[]` | 检出的目标物体实例 |
| `relations[]` | 每个物体与底座的配对、`on_base`/`matched`、告警、编号标签 |
| `anomaly` | 异常结论（`pred_label`、实例、差分统计、热力图路径） |
| `markers[]` / `marker_corrections[]` | 定位码与类别纠正记录 |
| `warnings[]` | 全局告警文本 |
| `visualization_paths` | 叠加图与异常图路径 |

叠加图颜色语义：绿框=底座，橙框=合规物体，红框=有告警物体，品红=异常物品。

> 注意：README 中展示的 result.json 是**结构示例**，不是某次真实运行的产物；仓库通过 `.gitignore` 排除了运行输出。这一点在“训练证据与结果边界”一节有详细说明。

## 五、训练与数据闭环

### 数据工程

`dataset_builder/` 把“视频抽帧 → 模型预标注 → LabelMe 微调 → LabelMe→YOLO 转换 → 离线增强 → 训练”做成闭环。预标注环节让新批次图片先用已有模型生成可编辑的 LabelMe 多边形，人工只改错漏，显著降低从零标注的成本。离线增强除常规仿射/透视/HSV 外，还针对低对比度空孔和侧光阴影做了专门策略。

### 仓库内可核验的训练日志

仓库没有包含底座/物体 dual 权重，但跟踪了两轮 **yolo_unified（17 类）训练日志**，位于 `detectors/yolo_unified/outputs/train/`，可作为“统一模型训练确实进行过”的工件证据：

| 运行 | 训练配置 | 数据 | 记录到的验证集指标（results.csv） |
|---|---|---|---|
| `2026804133759` | yolo26l-seg 预训练、300 轮、imgsz=1280、batch=4 | `unified_data_yolo_dataset_augmented` | 最后记录轮（epoch 300）：Box mAP50≈0.91、mAP50-95≈0.85；Mask mAP50≈0.89、mAP50-95≈0.77 |
| `2026804094925` | 同参数族 | 同数据集 | 日志记录到 epoch 211（计划 300 轮，patience=100）：Box mAP50≈0.91；Mask mAP50≈0.90 |

这些数值来自仓库内 `results.csv` 的直接读取，只能说明**该次训练在其验证数据划分上**的记录结果，不能外推为货架场景的通用精度。理由有三：统一数据集由 base/object 模型互相补标注生成（存在伪标注成分）；训练与验证划分未在仓库内提供独立说明；模型权重与真实测试集不在仓库。项目文档也明确 unified 当前不是生产默认。

此外，`models/patchcore/latest_checkpoint.txt` 指向一次 PatchCore 训练的检查点路径，证明该训练发生过，但检查点本体未入库，无法据此引用任何效果。

## 六、如何运行

仓库不托管权重与数据，克隆后需自备：

```bash
pip install -r requirements.txt
# PatchCore 可选：按 detectors/patchcore/README.md 建立独立虚拟环境

# 训练底座/物体（先改各 detectors 的 config）
cd detectors/yolo_base && python train.py
cd detectors/yolo_object && python train.py

# 运行主流程
python pipeline/run_pipeline.py --input path/to/images
```

配置按 `run_pipeline.py` 顶部 `CONFIG` 与 `configs/pipeline.yaml` 合并（CONFIG 覆盖 YAML），CLI 参数可覆盖两者（以 `_merge_pipeline_cfg` 的实际逻辑为准）。常用开关：`yolo_mode`（dual/unified）、`anomaly.backend`（yoloe/patchcore/off）、`marker_correction_enabled`、`allow_missing_models`。

## 七、限制与下一步

- **端到端结果待补充**：仓库内没有真实运行的 result.json 与叠加图，文章无法展示实际效果；需要先在本地放置权重跑通，并把一份精简样例放入仓库。
- **dual 模型效果未公开**：底座/物体权重的训练指标与运行表现不在仓库，无法断言生产路径精度。
- **统一模型“尚在验证”**：训练日志存在，但 README 明确生产默认仍是 dual。
- **泛化能力需迭代**：提交历史中记录了“现阶段模型的泛化能力还是比较差的，后续还要针对性地做出改进”等表述，这与训练日志并存，说明项目当前处于数据/模型持续迭代阶段。
- **定位码纠正默认关闭**：新场景未启用，效果待实测。

## 相关项目

这个项目是实验室自动化视觉生态中的一环，与另外三个仓库共享同一套“YOLO 分割 + 几何规则 + 数据闭环”方法论：

- [TLC 薄层色谱 Rf 自动测定](/2026/08/04/tlc-rf-recognition/)：TLC 板的分割、透视展开与泳道/Rf 计算；
- [YOLO 表格/屏幕分割与透视正视化](/2026/08/04/object-recognition-perspective-exploration/)：桌面/屏幕的 mask 到正视图，以及 LCMS 66 孔逐孔状态；
- [化学色谱仪面板识别](/2026/08/04/cc-instrument-panel-structured-data/)：从面板截图或 PeakTrak 文件提取峰列表，供下游 LC-MS first shooting 消费。

四者共同回答“实验室里‘看到了什么、放得对不对、读出了什么’”，并以结构化 JSON 对接下游系统。

系列导航：上一篇：[YOLO 表格分割与 LCMS 孔板识别](/2026/08/04/object-recognition-perspective-exploration/)
