---
title: 化学色谱仪面板识别：视觉截图与 PeakTrak XML 两条路径的峰列表契约
date: 2026-08-04 10:20:00
permalink: /2026/08/04/cc-instrument-panel-structured-data/
tags: [工业视觉, 图像分割, OCR, 曲线追踪, 峰值检测, XML, 数据提取, 视觉计算系列]
categories: [视觉计算]
---

化学色谱（CC）过柱后，操作员需要把面板上的曲线、试管编号和峰位置读成机器可用的结构化数据，供 LC-MS first shooting 等下游流程消费。这个仓库（CC_result_recognition）提供两条互为补充的实现路径：**路径 A 纯视觉**，从仪器右侧面板截图出发；**路径 B PeakTrak XML**，直接解析仪器导出的运行文件（`.txt`/`.xml`，有运行文件时优先）。两条路径产出同一套 JSON 语义（`peak` + `rescale`），并且从 GitHub 克隆后即可在 `sample_results/` 看到两套“输入 → 中间过程 → 最终结果”的完整样例。

<!-- more -->

## 项目概览

| 项目要素 | 内容 |
|---|---|
| 项目目的 | 从 CC 过柱结果中自动提取结构化峰列表（峰位置、高度、percent、试管归属、rescale 建议），供 vision 服务与 LC-MS 下游使用。 |
| 核心输入 | 路径 A：仪器右侧面板截图（PNG/JPG）；路径 B：仪器导出的 PeakTrak `.txt`/`.xml`（`.txt` 内容即 XML） |
| 核心输出 | 路径 A：`*_result.png` + `*_result.json`；路径 B：`*_result.json` + `*_intermediate.json` + CWT 五联图；精简契约 `peak.curve_peaks.items` + `rescale` |
| 项目重点 | 两条路径在 `engine.peak` 汇合：视觉喂像素高度信号，XML 喂 AU 高度信号，用同一套 CWT 找峰，输出同语义 JSON。 |
| 入库样例 | `sample_results/vision/`（截图全流程）与 `sample_results/xml/`（PeakTrak 文件全流程） |

## 如何选择路径

```text
有 PeakTrak .txt/.xml 运行文件？→ 是，优先路径 B（曲线来自仪器数字，不依赖分割/OCR）
                              → 否，或需要截图复核 → 路径 A 视觉
```

视觉路径需要 YOLO/U-Net/PaddleOCR 权重（仓库不托管大模型），而 XML 路径不依赖任何分割/OCR 权重，改一下输入路径即可复现。两条路径都落到同一套字段语义，这是下游契约稳定的关键。

## 完整实现流程

**路径 A（视觉）**：输入缩放（720×1280 参考系）→ 表格分割与边界修正 → 红/蓝曲线分割追踪 → 试管编号 OCR → judge 判断 need_rescale → 按需 x 轴 OCR → y 轴 percent 映射 → CWT 峰检测、试管归属与结果压缩。

**路径 B（XML）**：`.txt`/`.xml` 读入规范化 → 解析 `<APs w1>`（红线）、`<SPs>`（梯度 %B）、`<TDs>`（试管收集区间）、`<Peaks>`（仪器对照）→ 复用 `engine.peak` 的 CWT 找峰 → 峰时间 ∩ TD 窗口得试管归属 → 峰顶 CV 在 SPs 上插值得 percent → 写 `*_result.json` / `*_intermediate.json` / CWT 五联图。

![CC 面板结构化解析流程](/images/projects/visual-computing-series/cc-panel-pipeline.png)

*图 1：根据主入口与对外契约重绘的视觉路径数据链。不同后端由配置选择，并非每次运行都会加载所有模型。*

## 为什么不能只做一次 OCR

OCR 擅长把局部文字图像变成字符串，却不能自动回答：

- 哪个矩形是主表格；
- 红线和蓝线分别经过哪些像素；
- 某个文字属于试管号、横轴还是纵轴；
- 纵轴数字和曲线高度如何对应；
- 峰属于哪个试管区间；
- 当前横轴范围是否需要重新建议。

项目因此把问题分成有明确输入输出的模块：表格/画布定位、红蓝曲线处理、试管 OCR、rescale 判定、percent 映射、peak 后处理。每一步的错误都会级联，但每一步也都能单独替换和检查。

## 表格定位：先建立可信的局部坐标系

路径 A 先缩放输入到统一参考尺寸，再定位右侧表格/曲线画布。当前代码支持 YOLO 表格实例分割（默认生产后端）、SAM3 文本提示分割，以及部分几何和后处理回退。定位结果不是最终框，而是经过边界修正的 mask 和 ROI；后续曲线追踪、OCR crop 和轴位置全部建立在这个局部坐标系上。

这解释了为什么表格模型的错误具有系统性：如果 ROI 向左偏移，曲线、刻度和试管区域的所有坐标都一起偏；如果只看最终峰数量，很难知道问题发生在最前面的区域定位。

## 红蓝曲线采用不同信息源

项目没有假设两条曲线必须由同一种模型处理。红线（主信号，峰检测依赖它）可用 U-Net、颜色过滤或 SAM3；蓝线（辅信号，percent 回填和可视化用）可用 U-Net 或 SAM3。U-Net 路径把问题当成二值分割，再将 mask 后处理成单值轨迹。

曲线处理阶段只负责恢复轨迹，不在这里直接决定峰。把“分割”和“峰解释”分开，可以独立检查曲线是否正确，也能在不重训分割模型的情况下调整峰检测策略。

## OCR 兼容性为什么成为工程问题

项目经历过 PaddleOCR 2.x 风格调用与 3.x 环境不兼容的问题，最终统一到一条显式链路：

```text
文字检测模型 → bbox → 按 bbox 裁剪 crop → 文字识别模型 → token + 位置 + 置信信息
```

检查到的版本约定为 PaddlePaddle 3.3.0、PaddleOCR 3.4.0，试管、纵轴和横轴复用同一兼容入口，避免三个模块各自维护旧 API。默认固定在 CPU 并关闭 MKL-DNN 是当时环境的稳定性选择，不代表 CPU 永远比 GPU 更适合 OCR。

## `need_rescale` 与 percent 映射

试管编号 OCR 后，`judge` 模块检查编号递增性、重复/重叠等结构信号，只有 `need_rescale=true` 时才进一步读取横轴并计算推荐范围。`need_rescale` 不是图像质量分数，只表达当前规则下是否需要横轴范围处理。

纵轴 OCR 提供若干配对点（图像纵坐标 `y_i` 与百分比 `p_i`），后处理建立像素位置到百分比的映射。如果 `0%` 位置无法确定，后面的峰高度与 percent 就失去参考——这也是此前“peak=0”的根因之一：不是峰算法突然失效，而是 y/x 轴 OCR 链路为空。这个排障过程说明，端到端视觉系统的错误常发生在模块边界。

## 峰值检测与稳定 JSON 契约

峰模块以纵轴 `0%` 位置为参考，把曲线高度信号用连续小波变换（CWT）寻找候选峰，再结合峰宽、显著性、percent 映射和试管边界做后处理。两条路径共用 `engine/peak.py` 的 `detect_peaks_wavelet`：视觉喂像素高度，XML 喂 AU 高度。

精简契约至少保留：

```json
{
  "peak": {
    "curve_peaks": {
      "items": [
        { "peak_index": 0, "height": 0.0, "percent_value": 0.0 }
      ]
    }
  },
  "rescale": {
    "need_rescale": false
  }
}
```

这是字段结构示意；仓库 `sample_results/` 里的 `*_result.json` 给出了真实值。compact 后的关键字段不能随算法重构任意改变，否则下游服务会被破坏。

## 样例 A：视觉路径（`sample_results/vision/`）

这套样例从面板截图 `1.png` 出发，保留了每一步的中间产物。下面按流水线顺序展示其中几张：

![CC 面板输入截图](/images/projects/cc-instrument-panel/vision-1-input.png)

*图 2：输入：仪器右侧色谱面板截图。*

![表格 mask](/images/projects/cc-instrument-panel/vision-1-table-mask.png)

*图 3：Step 1 表格分割 mask/ROI 可视化。*

![试管 OCR](/images/projects/cc-instrument-panel/vision-1-tube-ocr.png)

*图 4：Step 4 底部试管编号 OCR 框与识别结果（本例 15 管）。*

![y 轴条带](/images/projects/cc-instrument-panel/vision-1-y-axis.png)

*图 5：Step 7 y 轴 percent 条带（用于像素 y ↔ 溶剂 % 映射）。*

![试管架可视化](/images/projects/cc-instrument-panel/vision-1-rack-vis.png)

*图 6：Step 1b 左侧试管架 RACK:A 分色可视化（1×15 管：purple=2、teal=6、blue=7）。*

![最终结果](/images/projects/cc-instrument-panel/vision-1-result.png)

*图 7：最终可视化：峰标注、曲线叠加、试管框。*

该样例 `1_result.json` 的关键值：

| 项 | 值 |
|---|---|
| CWT 峰数 | 3 |
| percent_value | ≈21.6 / 26.1 / 29.5 |
| rescale | `need_rescale=false`（judge.stats.tubes=15） |
| 试管架 | RACK:A，1×15，purple=2 / teal=6 / blue=7 |

## 样例 B：PeakTrak XML 路径（`sample_results/xml/`）

这套样例来自运行文件 `22810592904-054-1.txt`（内容即 XML，另有 PDF 对照与规范化后的 `.xml`）。它不需要 GPU/OCR 权重即可复现。

![红线提取](/images/projects/cc-instrument-panel/xml-1-red-curve.png)

*图 8：从 `<AP w1>` 抽取的 UI 红线。*

![CWT 五联图](/images/projects/cc-instrument-panel/xml-1-cwt-pipeline.png)

*图 9：CWT 五联图：原始 → 网格/基线 → height 信号 → 找峰（candidates=5、kept=5）。*

![中间 UV 核对图](/images/projects/cc-instrument-panel/xml-1-intermediate-uv.png)

*图 10：按 `*_intermediate.json` 重绘的红线核对图。*

该样例 `*_result.json` 的关键值：

| 项 | 值 |
|---|---|
| 运行信息 | 2022-09-22；AP 点数 2508，TD 管数 38 |
| CWT 峰数 | 5（candidates=5、kept=5，rejected=[]） |
| percent_value | ≈11.2 / 67.4 / 100 / 100 / 100 |
| rescale | `need_rescale=false`（XML 路径恒 false，reason=`no_screenshot_ocr`） |
| 试管推荐 | 38 管中 35 管有组分；11/12/13 因“有 TD 收集窗但未落入任何仪器峰”被排除 |

两条样例的差异也说明了路径选择的意义：视觉路径多了 OCR 与 rescale 判断（面向没有运行文件的场景），XML 路径直接用仪器数字曲线与梯度，天然没有 OCR 不确定性。

## 已保存的资源基准与专家对比（限定引用）

仓库保留了一份 2026-07-14 的受控基准文档（RTX 4090、Python 3.10、8 张测试图、OCR 关闭、蓝线均为 ResNet34 U-Net）：

![CC 后端资源基准](/images/projects/visual-computing-series/cc-benchmark.png)

*图 11：仓库基准文档记录的受限对比。数字只适用于上述 8 图、OCR 关闭和指定硬件/后端条件。*

| 指标 | A：SAM3 + SAM3 | B：YOLO + color filter | 文档记录的差异 |
|---|---:|---:|---:|
| 峰值 GPU 显存 | 2665 MiB | 899 MiB | -1766 MiB |
| 峰值进程 RSS | 4137 MiB | 1789 MiB | -2348 MiB |
| 8 图总耗时 | 25.375 s | 13.025 s | -12.35 s |
| 稳态单图均值 | 2.656 s | 1.317 s | 约 2 倍 |

另一份统计文档记录了 11 个可比 MED 样本上“首选峰/送检优先级”的对比：Top-1 一致率 100%（11/11）、平均 Spearman rho≈0.946、平均 L1≈0.636。

这两组结果都只能按原文档条件引用：原始 CSV/输入图未随仓库入库，无法在本次审计中重算；样本量小，不能推断普遍准确率。它们适合作为已有内部实验记录，并指明下一次应补齐原始结果包。

## 训练记录能说明什么

仓库保留了表格分割训练 CSV（160 个 epoch）与蓝线 U-Net 训练日志/权重。这些文件证明训练过程曾输出指标，但数据来源、划分、随机种子、最佳 checkpoint 选择和独立测试协议并不完整，因此本文不把某个 epoch 的 mAP 当成最终系统准确率。

## 降级输出与可运维性

红线处理失败时，项目提供降级 PNG/JSON 路径，让单图失败不会直接中断整个批处理。这是一种可运维设计，但仍需真实失败夹具验证：降级结果能否被下游正确区分、清理中间文件后是否保留足够诊断信息、不同失败是否有稳定错误码。

## 技术栈

| 层次 | 技术 | 用途 |
|---|---|---|
| 深度学习 | PyTorch、YOLO、SAM3、ResNet34 U-Net | 表格与曲线分割的可替换后端 |
| OCR | PaddleOCR / PaddlePaddle | 试管号和横纵轴文字 |
| 图像处理 | OpenCV、NumPy | ROI、颜色过滤、曲线追踪、坐标映射、绘图 |
| 信号处理 | CWT 与规则后处理 | 峰候选、峰宽、高度和归属（两条路径共用） |
| XML | peaktrak_parser / peaktrak_txt_io | 路径 B 读入、规范化与节点抽取 |
| 工程契约 | CLI、JSON、降级输出 | 与下游服务保持稳定接口 |

## 下一步怎样形成完整证据链

`sample_results/` 已补齐“输入 → 中间过程 → 输出”的视觉与 XML 双路径样例。下一步是建立三层评测：模块级（表格 IoU、曲线像素误差、OCR 准确率、轴拟合残差）、结构级（峰数量/位置/归属误差）、业务输出级（优先级 Top-k、排序相关与失败样本分类）。每个结果包都应保存代码提交、后端组合、模型哈希、OCR 开关、环境与完整 JSON，并让资源基准与质量评测在同一开关下分别报告。

这个项目的核心价值，是把一个复杂仪器结果拆成两条可替换、可降级、可通过稳定契约交付的路径。现在，克隆仓库就能看到两条路径各自的真实产物；下一步需要让每个数字都能被重新计算。

系列导航：上一篇：[从 TLC 图像到 Rf](/2026/08/04/tlc-rf-recognition/)；下一篇：[YOLO 表格分割与 LCMS 孔板识别](/2026/08/04/object-recognition-perspective-exploration/)
