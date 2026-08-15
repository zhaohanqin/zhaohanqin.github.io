---
title: YOLO 表格分割与 LCMS 孔板识别：一条训练管线，两个实验室视觉问题
date: 2026-08-04 10:25:00
permalink: /2026/08/04/object-recognition-perspective-exploration/
tags: [目标分割, YOLO, 透视变换, 单应矩阵, LCMS, 孔板检测, OpenCV, 视觉计算系列]
categories: [视觉计算]
---

实验室里有两类看似不同、却共享同一条训练管线的问题：一是相机斜拍桌面/屏幕，需要把梯形画面恢复成无畸变的正视图；二是 LCMS 微孔板（6 列 × 11 行 = 66 孔）需要逐孔判断空孔还是孔内有物体。前者依赖“实例分割 + 四边形估计 + 单应变换”，后者依赖“小目标实例分割 + 掩码去重 + 结构化计数”。

这个仓库（new_table_test）把两件事放进同一套 Ultralytics YOLO26-seg 数据与训练管线，但权重、推理脚本和透视模块彼此独立。从 GitHub 克隆后，不需要本地数据和权重就能在 `results/` 里看到两套“输入 → 中间过程 → 最终输出”的完整样例。

<!-- more -->

## 项目概览

| 项目要素 | 内容 |
|---|---|
| 项目目的 | ① 实验桌面/屏幕透视正视图（`table` 类）；② LCMS 66 孔板逐孔 hole/object 状态。两条业务线共用训练与数据管线。 |
| 核心输入 | 斜拍桌面/屏幕图、LCMS 孔板图、图像目录或视频；`yolo_table_best.pt` / `yolo_lcms_best.pt` 权重 |
| 核心输出 | ① front_view 正视图 + mask/quad/panel 中间图 + 元数据 JSON；② 孔板可视化图 + JSON（counts + 每孔坐标） |
| 项目重点 | 两条按需选用的业务线共享“数据转换 + 增强 + YOLO 训练”层；YOLO26-seg 负责实例感知，几何/去重把 mask 变成可交付结果。 |
| 入库样例 | `results/01_desktop_front_view/`（输入→mask→quad→正视图）与 `results/02_lcms_holes/`（输入→预标注→推理图+JSON） |

## 完整实现流程

| 阶段 | 处理 | 阶段产出 |
|---:|---|---|
| 1 | 抽帧 / LabelMe 标注 / Label Studio 转换 | YOLO 数据集（train/val/test + data.yaml） |
| 2 | 离线多边形增强（仿射/透视/HSV/shadow/lohole） | 扩增后的数据集 |
| 3 | YOLO26-seg 训练（TASK=table \| wells） | `yolo_table_best.pt` / `yolo_lcms_best.pt` |
| 4 | 目的1：图像/视频推理 → mask 还原原图 | mask / quad 叠加图 |
| 5 | 目的1：lite/full 后端估计四角 → 单应变换 | front_view 正视图 + 元数据 JSON |
| 6 | 目的2：模型预标注 → LabelMe 人工微调 | `*_prelabel.json` |
| 7 | 目的2：hole/object 推理 + mask 重合去重 | 可视化 JPG + counts/detections JSON |
| 8 | （可选）FastAPI `/infer` 接口 | HTTP 结构化结果 |

两条业务线只共享“数据转换 + 增强 + YOLO 训练”这一层，推理入口（`infer/image_seg_infer.py` 与 `LCMS_ABCDEF/infer_holes.py`）和权重互不共用。

## 如何运行与获得输出

想先看效果，直接打开仓库里的 `results/`（每套样例都有 README 逐文件说明）。要自己复现，需先把权重放到 `yolo_train/weights/`：

```bash
# 目的1：桌面/屏幕正视图
python infer/image_seg_infer.py --source data/real-images --save
# 目的2：LCMS 孔板
python LCMS_ABCDEF/infer_holes.py
python LCMS_ABCDEF/api_holes.py   # FastAPI，默认 0.0.0.0:6006
```

仓库没有统一 CLI 配置；按脚本顶部 `CONFIG`/`SETTINGS` 改路径后直接运行。`.gitignore` 刻意排除图片与权重，因此克隆后“缺什么”在根 README 里写得很清楚。

![mask 驱动的透视矫正流程](/images/projects/visual-computing-series/table-perspective-pipeline.png)

*图 1：目的1 主链路（分割 → 四边形 → 单应变换）。下文的样例 A 给出这条链的真实产物。*

## 为什么检测框不够

目标检测框始终是水平矩形。对旋转或强透视目标，它会包含大量背景，也无法提供目标的四个真实角点。透视矫正需要的是源平面上的四个对应点，而不是一个轴对齐框。

实例分割 mask 具有三项优势：

1. 描述目标实际轮廓，而不仅是外接矩形；
2. 可以通过轮廓、凸包和支撑线估计四条边；
3. 能识别目标是否贴边、缺角或被遮挡，并选择不同回退策略。

代价是 mask 边界也会受模型误差影响。边缘外扩几个像素、缺少一个角或把背景并入目标，都会改变估计四边形并传导到正视图。

## YOLO mask 如何恢复到原图尺寸

Ultralytics 结果可能提供两种 mask 表示：

- `masks.xy`：已经映射到原图坐标的多边形点；
- `masks.data`：模型推理分辨率上的 mask tensor。

代码优先使用多边形，在原图大小的空白 mask 上调用 `fillPoly`；若不可用，再尝试用 Ultralytics 的 `scale_masks` 恢复尺寸，最后还有 OpenCV resize 回退。这个顺序避免把低分辨率 mask 直接当原图坐标。不同回退路径可能产生不同边界，因此元数据中应记录实际使用的 mask 来源。

## 从四个角点到单应矩阵

平面目标上的点可用齐次坐标表示。透视变换满足：

$$
[x',\,y',\,w']^T=H\,[x,\,y,\,1]^T,\qquad (u,v)=\left(\frac{x'}{w'},\,\frac{y'}{w'}\right)
$$

`H` 是 `3 x 3` 单应矩阵，整体尺度不影响映射，因此有 8 个自由度。四组不共线的点对恰好提供 8 个独立约束。

项目先按左上、右上、右下、左下顺序排列源四边形，再根据边长或可选物理宽高比确定目标矩形尺寸，最后调用 OpenCV：

```text
H = getPerspectiveTransform(source_quad, destination_rect)
front = warpPerspective(image, H, output_size)
```

这个方法依赖“目标近似平面”。若屏幕弯曲、纸张卷曲或物体本身有显著三维形变，一个全局单应矩阵无法同时校正所有区域。

## lite 与 full 两种几何后端

**lite 后端**流程更直接：选择最大可用 mask → 清理并找主轮廓 → 凸包 → `approxPolyDP` 尝试四顶点 → 失败回退 `minAreaRect` → 排序角点计算 H。它适合目标完整入画、接近正视、轮廓较干净的情况。

**full 后端**包含更多几何候选与评分：保留最大连通域、填洞和 mask 收缩；从轮廓/凸包估计自由四边形；通过支撑线构造外包四边形；识别轮廓是否接触图像边界；对缺失边或角进行支撑线补全与混合；比较候选四边形对 mask 的覆盖、IoU、长宽比等。

支撑线的直觉：对某个方向的单位法向量 `n`，轮廓点投影 `n dot p` 的最小/最大值定义两条支撑线。多组方向的支撑线相交，可以构成包住轮廓的平行四边形或自由四边形。当目标角点因遮挡消失时，直接从轮廓寻找四个顶点会失败；支撑线仍可能利用可见边方向推断交点。

目标被图像边界裁切时，mask 轮廓会沿图像边形成一条“假边”。full 后端会检测这种接触，并把自由四边形与支撑线补角结果组合，避免把图像边界误当目标真实边界。这是一组工程启发式，不是已经证明在所有贴边场景正确。

## 样例 A：桌面斜拍 → 透视正视图

仓库在 `results/01_desktop_front_view/` 里入库了一套完整过程。输入是一张 4096×3072 的斜拍桌面照片，YOLO26-seg 检出 1 个 `table` 实例（conf≈0.98），full 几何后端以 `fallback_support_lines_enclosing` 方法拟合四边形，最终输出约 3637×1896 的正视图。

![原始斜拍输入](/images/projects/new-table-test/table-00-input.jpg)

*图 2：样例 A 输入：斜拍桌面原图（4096×3072）。*

![YOLO 分割掩码叠加](/images/projects/new-table-test/table-01-mask-overlay.jpg)

*图 3：YOLO26-seg 的 `table` 掩码半透明叠加（n_det=1）。*

![拟合四边形](/images/projects/new-table-test/table-02-quad-overlay.jpg)

*图 4：full 后端拟合的四边形（本例 method=`fallback_support_lines_enclosing`）。*

![透视正视图](/images/projects/new-table-test/table-03-front-view.jpg)

*图 5：单应变换后的正视图（约 3637×1896），梯形畸变被去除。*

该样例的元数据（`05_meta.json`）记录了可追溯的关键值：

| 项 | 值 |
|---|---|
| 检出 | 1 个 `table`，conf≈0.9816 |
| 四边形方法 | `fallback_support_lines_enclosing`（full 后端） |
| 输出尺寸 | 约 3637 × 1896 px |
| YOLO 耗时 | 约 0.02 s |
| 透视耗时 | 约 1.12 s |

这些数字只是“该次样例在该机器/配置下”的记录，不是跨数据集的性能结论。README 还说明了 `04_panel.jpg` 是左侧四边形叠加/右侧正视图的对照拼图，`annotation_example_labelme/` 是训练阶段的标注格式示例。

## 样例 B：LCMS 66 孔逐孔状态

`results/02_lcms_holes/` 演示第二条业务线：输入一张 1706×1279 的孔板照片，先由 `prelabel/run.py` 用当前模型生成 LabelMe 多边形预标注（供人工微调），再由 `infer_holes.py` 做最终推理、去重与计数。

![LCMS 孔板输入](/images/projects/new-table-test/lcms-00-input.jpg)

*图 6：样例 B 输入：LCMS 微孔板照片（1706×1279）。*

![LCMS 推理可视化](/images/projects/new-table-test/lcms-02-infer.jpg)

*图 7：推理可视化：空孔（hole）与孔内物体（object）的框/掩码与计数标题。*

最终 JSON（`03_infer.json`）的关键数值：

| 项 | 值 |
|---|---|
| 物理板型 | 6 列 × 11 行 = 66 孔 |
| 推理配置 | conf=0.10，iou=0.5，imgsz=1280 |
| 去重 | 同类 mask 重合 ≥0.90 去重；before=66，removed=0 |
| 计数 | hole=58，object=8，total=66 |

`total=66` 与物理孔位数一致，且去重前后数量不变；但这是一张样例的“该次记录”，没有独立人工标注做正确率对照，不能外推为模型在任意孔板上的精度。`01_prelabel.json` 与 `03_infer.json` 的区别也值得注意：前者是给人改的 LabelMe 多边形，后者是给程序读的框/中心点/计数。

## 数据管线如何为两条业务线服务

两条业务线共用 `tools/dataset/` 与 `yolo_train/yolo.py`：

| 工具 | 输入 | 输出/作用 |
|---|---|---|
| 视频抽帧 | MP4 等视频 | 带间隔控制的训练候选帧 |
| LabelMe 转换 | 图片 + 同名 JSON | YOLO segmentation polygon 标签 |
| Label Studio 转换 | 导出标注 | YOLO 数据集结构 |
| 数据划分 | 标注条目 | train/val/test 与 data YAML |
| 多边形增强 | YOLO mask 标签 | 同步变换图像与实例 polygon |
| 伪标转 LabelMe | 模型预测 | 可人工复核/修改的 JSON |

增强脚本对图像和 polygon 同步执行翻转、90 度旋转、仿射/透视变换和光度变化，并针对真实拍摄域偏移增加了两种策略：`shadow`（侧光渐变暗区）和 `lohole`（按 hole 多边形压暗/降饱和，模拟低对比空孔）。孔洞密排时几何幅度收得很紧（旋转 ±10°、平移 6%），并设 `min_mask_area_ratio=0.00015`，避免小孔被滤掉。

YOLO 脚本支持 `train、val、predict` 三种模式，训练时保存 run ID、模型配置、data YAML、超参、平台信息、train log 与 best weight 副本。权重与完整数据集不在仓库（`.gitignore` 排除），`yolo_train/weights/` 需要按根 README 自行准备；换机器时还要改 `TASK_PRESETS[*].data_yaml` 中的绝对路径。

## 当前结果边界

2026-08-15 的提交为两条业务线各入库了一套“输入 → 中间过程 → 最终输出”样例（`results/`），因此本文可以展示真实效果图与结构化数值。但仍不能声称：

- full/lite 谁更准：两套样例没有受控的几何精度对比；
- 正视化改善了 OCR 或下游识别：没有原图/正视图的下游对照实验；
- 孔板识别准确率：只有 1 张样例，且无独立人工标注；
- 实时性能：耗时数字只代表该次样例的机器与配置。

## 怎样评估“矫正是否正确”

只看正视图“像不像矩形”不够。建议建立四层指标：

1. **分割层**：mask IoU、边界 F-score；
2. **角点层**：四角像素误差和角点重投影误差；
3. **几何层**：正视图边缘直线度、长宽比误差、内部网格畸变；
4. **下游层**：相同 OCR/检测器在原图与正视图上的准确率变化。

full/lite 对比必须使用同一 YOLO mask，才能把差异归因于几何后端。视频需要增加时序指标：角点抖动、输出边缘抖动、透视失败率和回退连续性。

## 当前工程风险

- 没有依赖清单或 lockfile，OpenCV/Ultralytics 行为无法锁定；
- 空 mask、极小 mask、自交四边形和近共线角点需要系统化测试；
- 目标不是严格平面时，全局单应变换会产生不可避免的局部误差；
- 视频没有明确的时序稳定策略；
- 权重与完整数据集不在仓库，复现需本机准备；
- 部分脚本默认路径仍含机器相关信息，换机器必须改。

## 下一步

两套样例已经把“输入 → 中间过程 → 输出”的证据链补齐。下一步最有价值的是把样例扩展成受控评测：为每张图保存人工 polygon、full/lite 四边形与角点误差，在固定硬件和分辨率下比较运行时间，并用相同下游 OCR 评估正视化收益；孔板一侧则需要多张带人工标注的图片来报告逐孔准确率，而不只是一个 66 孔样例。

这个项目展示了一个值得复用的设计：一条数据/训练管线，支撑两个不同的业务目标。深度学习负责实例感知，传统几何负责把 mask 变成正视图，掩码去重负责把 YOLO26 end2end 的重复检出整理成逐孔结果。两者都以明确的数据契约（mask/四边形/instances JSON）连接，比让一个黑盒直接输出“答案图”更容易检查和替换。

系列导航：上一篇：[从 CC 面板截图到结构化数据](/2026/08/04/cc-instrument-panel-structured-data/)；下一篇：[货架多模型视觉检测流水线](/2026/08/15/shelf-vision-pipeline/)
