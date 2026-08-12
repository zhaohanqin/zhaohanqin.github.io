---
title: YOLO 系列模型与 YOLO26 核心模块：从整体框架到端到端检测
date: 2026-08-12 14:00:00
permalink: /2026/08/12/yolo-series-and-yolo26/
tags: [YOLO, 目标检测, Backbone, Neck, Head, YOLO26, C2f, 视觉原理系列]
categories: [视觉原理]
mathjax: true
---

YOLO（You Only Look Once）是目标检测里最常用的单阶段方法：对图像做一次前向，直接输出目标的类别、边界框和置信度。理解 YOLO 最好的顺序不是从某个版本的结构图开始背，而是先建立整体框架，再学习基础模块，最后看训练逻辑和版本演进。本文按这个顺序讲，并重点拆解 YOLO26 的端到端设计。

<!-- more -->

## 1. 整体思想：一次前向输出框和类别

单阶段检测不生成候选区域，直接在特征图上做密集预测：

```text
输入图像
  → CNN/Transformer 特征提取
  → 多尺度特征融合
  → 每个尺度上的密集预测
  → 置信度筛选 → NMS 或端到端 Top-K
  → 最终检测结果
```

输出包括类别、边界框（x1,y1,x2,y2）和置信度。YOLO 的目标是：在尽可能短的推理时间内，输出尽可能准确的位置和类别。

## 2. 现代 YOLO 的四大组成部分

```text
Input → Backbone → Neck → Head → Post-process
```

| 组件 | 作用 |
|---|---|
| Input | 输入图像（常见 640×640）+ 数据增强（Mosaic、MixUp、随机尺度、HSV 等） |
| Backbone | 特征提取：分辨率逐级降低、通道数和语义逐级升高 |
| Neck | 多尺度融合：把深层语义传给浅层、把浅层定位传给深层 |
| Head | 在融合特征上预测框和类别（现代多用解耦头） |
| Post-process | 解码、置信度筛选、NMS 或端到端 Top-K |

## 3. 张量、stride 与多尺度

特征图用 `[B, C, H, W]` 表示。stride 是特征图相对原图的下采样倍数，输入 640×640 时：

| 尺度 | 特征图 | stride | 适合 |
|---|---:|---:|---|
| P3 | 80×80 | 8 | 小目标（一个点对应 8×8 区域） |
| P4 | 40×40 | 16 | 中目标 |
| P5 | 20×20 | 32 | 大目标（感受野大、语义强） |

三个尺度共有 $80^2+40^2+20^2=8400$ 个预测点，这就是密集预测（dense prediction）：召回率高、小目标覆盖好，但一个目标可能被多个点预测出来，需要后处理去重。

## 4. Backbone：主干特征提取

Backbone 的典型数据流（以 640 输入为例）：

```python
x = Conv(image, stride=2)          # [B, 64, 320, 320]
x = Conv(x, stride=2)              # [B, 128, 160, 160]
x = C3k2(x)                        # [B, 128, 160, 160]
x = Conv(x, stride=2)              # [B, 256, 80, 80]
P3 = C3k2(x)                       # [B, 256, 80, 80]
x = Conv(P3, stride=2)             # [B, 512, 40, 40]
P4 = C3k2(x)                       # [B, 512, 40, 40]
x = Conv(P4, stride=2)             # [B, 1024, 20, 20]
P5 = C3k2(x)                       # [B, 1024, 20, 20]
P5 = SPPF(P5)
P5 = C2PSA(P5)
```

浅层特征更像边缘、纹理、角点，适合定位和小目标；深层特征更像部件、整体形状、语义，适合分类和大目标。

## 5. Neck：FPN 与 PAN

**FPN（自顶向下传语义）**：

```python
P5_up = Upsample(P5)
N4 = Fusion(Concat(P5_up, P4))
N4_up = Upsample(N4)
N3 = Fusion(Concat(N4_up, P3))
```

**PAN（自底向上传定位）**：

```python
N3_down = Downsample(N3)
N4_final = Fusion(Concat(N3_down, N4))
N4_down = Downsample(N4_final)
N5_final = Fusion(Concat(N4_down, P5))
```

Neck 最终输出 N3/N4/N5 三个尺度，分别送给 P3/P4/P5 检测头。

## 6. 基础模块

### Conv 模块

YOLO 里的 `Conv` 通常是 `Conv2d + BatchNorm + SiLU`。BatchNorm 稳定训练、加速收敛，推理时可与卷积融合提速；SiLU 在负半轴保留平滑梯度，比 ReLU 更适合深层网络。

### Bottleneck 与残差

```python
hidden = Conv1x1(x)
out = Conv3x3(hidden)
y = x + out      # 只有形状相同才能 Add
```

残差让网络更容易学习"在原特征上补充什么"，缓解梯度传播。注意：**Bottleneck 不一定严格压缩通道**，名字叫瓶颈，实际实现可能不同。

### CSP 思想

Cross Stage Partial：输入拆两路，一路深加工、一路保留，最后拼接：

```python
a = ConvA(x); b = ConvB(x)
a2 = Blocks(a)
y = ConvOut(Concat(a2, b))
```

减少重复计算和重复梯度、保留直接信息。**Concat 是通道维拼接（通道数相加），Add 是逐元素相加（形状必须相同）**，Concat 不等于融合，真正的融合由后续卷积完成。

### C3 / C2f / C3k / C3k2

| 模块 | 数据流特点 | 常见语境 |
|---|---|---|
| CSP | 拆两路 + Concat | YOLOv4 之后 |
| C3 | CSP + Bottleneck，拼接深加工最终输出和旁路 | YOLOv5 |
| C2f | 拼接多个中间输出（y0/y1/y2/... 全部 Concat） | YOLOv8 |
| C3k | C3 外壳 + 可配置卷积核 | YOLO11/YOLO26 相关 |
| C3k2 | C2f 外壳 + 可替换内部块（Bottleneck/C3k/注意力） | YOLO11/YOLO26 相关 |

C2f 比 C3 的优势是**中间特征复用更充分、梯度路径更多**：

```python
u = cv1(x)
y0, y1 = Split(u)
y2 = Bottleneck1(y1); y3 = Bottleneck2(y2); y4 = Bottleneck3(y3)
cat = Concat(y0, y1, y2, y3, y4)     # 5 × 128 = 640 通道
out = cv2(cat)
```

### SPP 与 SPPF

SPP 并行做 5×5、9×9、13×13 池化后拼接，扩大感受野。SPPF 用连续三次 5×5 池化近似：

```python
p1 = MaxPool5x5(x1)
p2 = MaxPool5x5(p1)
p3 = MaxPool5x5(p2)
cat = Concat(x1, p1, p2, p3)
```

三次 5×5 的有效感受野约等于 5/9/13——更简单、更快、效果接近。

### PSA 与 C2PSA

PSA 是位置敏感注意力（Q 想找什么、K 有什么、V 能提供什么，相似度加权），补充卷积不擅长的远距离关系。PSABlock 通常由 Attention + FFN + 残差组成。**C2PSA 只让部分通道做注意力**，因为注意力计算成本高，只在低分辨率深层特征上做部分通道更划算。

### DWConv 深度可分离卷积

普通 3×3 卷积：64 输入 → 128 输出，参数量 $64\times128\times3\times3=73728$。深度可分离拆成两步：每通道独立 3×3（$64\times9=576$）+ 1×1 通道融合（$64\times128=8192$），共 8768，大幅减少参数。代价是通道交互弱，需要 1×1 补充。

## 7. 检测头与边界框表示

### Coupled vs Decoupled Head

- **Coupled Head**：分类和回归共享特征分支，简单但任务间可能互相干扰；
- **Decoupled Head**：分类分支和回归分支分开（分类重语义、回归重几何），现代 YOLO 常用。

### Anchor-based 与 Anchor-free

Anchor-based 在每个位置预设若干框模板，模型预测相对模板的偏移；Anchor-free 不预设宽高模板，直接预测预测点到框四边的距离 l、t、r、b：

```text
x1 = (xa - l) × stride
y1 = (ya - t) × stride
x2 = (xa + r) × stride
y2 = (ya + b) × stride
```

注意：**Anchor-free 不代表没有预测点**，它仍然基于 grid point 预测。

### 三种框表示

| 表示 | 形式 | 用途 |
|---|---|---|
| xywh | 中心 + 宽高 | 通用 |
| xyxy | 左上 + 右下 | NMS/IoU 计算 |
| ltrb | 到四边距离 | Anchor-free YOLO 常见 |

## 8. 标签分配：One-to-Many 与 One-to-One

训练目标检测需要决定"一个 GT 由哪些预测点负责"，这就是标签分配。

- **One-to-Many**：一个 GT 分配给多个预测点。正样本多、监督密集、训练稳定、召回好，但推理容易产生重复框；
- **One-to-One**：一个 GT 只分配给一个预测点。输出更干净、适合端到端、减少 NMS 依赖，但正样本少、训练更难。

现代端到端 YOLO **同时使用二者**：训练时 One-to-Many 提供密集监督，One-to-One 学习唯一匹配；推理主要用 One-to-One Head。

## 9. NMS 与端到端检测

NMS（非极大值抑制）按分数排序，保留最高分框，删除与之高度重叠的同类框。它简单有效，但阈值敏感、密集遮挡下可能误删、部署不够友好。端到端检测的目标是让模型输出本身更接近最终结果——One-to-One 标签分配就是实现这一目标的关键。

## 10. YOLO26：端到端的一代

> 注意：YOLO26 不应理解为"从 YOLOv13 连续迭代到第 26 代"。YOLO 系列在 v4 之后分化出多个路线（v5 工程化、v6 工业部署、v7 E-ELAN、v8 anchor-free、v9 GELAN/PGI、v10 端到端、v11 多任务、YOLO26 强调端到端与推理简化）。以下内容以相关材料为准。

### 总体结构

```text
Input
  → Backbone: Conv + C3k2 + SPPF + C2PSA
  → Neck: PAN-FPN
  → Head: P3/P4/P5 解耦检测头
  → Training: One-to-Many + One-to-One 双头
  → Inference: 主要用 One-to-One Head
```

模型缩放与常见 YOLO 一致：n/s/m/l/x 五档，用 depth multiplier、width multiplier、max channels 控制。

### 双头与渐进式损失

训练时两个头同时监督：

$$L_{total}=\alpha(t)\,L_{o2m}+[1-\alpha(t)]\,L_{o2o}$$

训练前期 $\alpha(t)$ 大（多靠 One-to-Many 学得稳），后期降低（强化 One-to-One 的唯一匹配）。直观类比：老师前期多给提示让学生先学会找目标，后期考试只允许一个最准确答案。

### 移除 DFL

DFL（Distribution Focal Loss）把边界距离回归变成离散分布预测（如 reg_max=16 时每条边输出 16 个概率，用期望求距离），定位更细腻但输出通道多、计算重。YOLO26 相关材料设置 reg_max=1，直接输出 4 个边距，推理更轻；代价是边界精细建模能力下降，靠双头、STAL、优化器等策略补偿。

### STAL：小目标感知标签分配

小目标在特征图上只覆盖 1~2 个格点，标签分配严格时正样本不足。STAL 的做法是**在标签分配阶段临时扩大小目标的匹配范围**，让更多点成为正样本；回归仍然使用原始真实框——不是把小目标变大。

### MuSGD 优化器

Muon 关注大型矩阵权重**更新方向的几何结构**（减少方向冗余），MuSGD 理解为"对适合矩阵几何处理的大权重用 Muon、其他参数仍用 SGD"的混合策略。不要误解成"让所有权重变成正交矩阵"。

### 训练与推理流程

训练：输入+标注 → 增强 → Backbone → Neck → 双头输出 → 标签分配 → 分类/回归损失 → Progressive Loss 平衡 → MuSGD 更新。

推理：输入 → resize/pad → Backbone → Neck → 三尺度 Head → **主要用 One-to-One Head** → 解码 ltrb→xyxy → 置信度筛选 → Top-K。是否完全去掉 NMS 取决于具体实现，更严谨的理解是"One-to-One Head 让输出更接近 NMS 后的结果"。

### 其他任务头

YOLO 系列还支持实例分割（框+类别+mask prototype）、姿态估计（关键点）、OBB 旋转框（cx,cy,w,h,angle）、分类（全局池化+分类器）。

## 11. YOLOv1 到 YOLO26 的演进

| 版本 | Backbone/模块 | Neck/融合 | Head/标签 | 关键词 |
|---|---|---|---|---|
| v1 | 自定义 CNN | 无明显 Neck | 网格预测 | 单阶段开端 |
| v2 | Darknet-19 | Passthrough | Anchor-based | Anchor、BN、多尺度训练 |
| v3 | Darknet-53 | FPN 风格 | 三尺度 | 残差、三尺度检测 |
| v4 | CSPDarknet53 | SPP + PAN | Anchor-based | CSP、SPP、PAN、BoF/BoS |
| v5 | C3、SPPF | PAN-FPN | Anchor-based | 工程化、易部署 |
| v6 | RepBlock | Rep-PAN | Decoupled | 重参数化、部署 |
| v7 | ELAN/E-ELAN | PAN | 辅助头 | E-ELAN、RepConv |
| v8 | C2f、SPPF | PAN-FPN | Anchor-free、Decoupled | C2f、DFL |
| v9 | GELAN | 多尺度 | 改进训练信号 | PGI、GELAN |
| v10 | 现代模块 | 高效融合 | O2M + O2O | NMS-free |
| v11 | C3k2、C2PSA | PAN-FPN | 多任务头 | C3k2、注意力 |
| YOLO26 | C3k2、SPPF、C2PSA | PAN-FPN | 双头端到端 | STAL、MuSGD、端到端 |

演进主线：更强的特征提取 → 更高效的特征融合 → 更稳定的训练 → 更简洁的推理 → 更友好的部署。

## 12. 常见混淆点

1. **Bottleneck 一定压缩通道？** 不一定，关键是小型特征变换块 + 可能带残差；
2. **Concat 等于融合？** 不是，拼接后还要靠卷积真正融合；
3. **C2f 与 C3 最大区别？** C3 拼深加工最终输出 + 旁路，C2f 拼多个中间输出；
4. **C3k2 是固定模块？** 是灵活外壳，内部块可换；
5. **SPPF 为什么三次 5×5 代替 5/9/13？** 连续池化扩大有效感受野；
6. **One-to-One 是只输出一个框？** 不是，是训练目标让每个目标主要只有一个高分候选；
7. **One-to-Many 是重复框的唯一原因？** 不是，密集预测、相邻响应、多尺度重叠都是原因；
8. **DFL 是分类损失？** 不是，是边界框回归的分布式损失；
9. **STAL 会把小目标变大？** 不会，只临时扩大标签分配匹配范围；
10. **Anchor-free 没有点？** 有 grid point，只是没有预设宽高模板；
11. **Head 输出就是最终框？** 不是，还要解码、筛选、NMS/Top-K。

## 13. 学习路线建议

1. **整体框架**：stride、特征图、P3/P4/P5、FPN/PAN；
2. **基础模块**：Conv、BN、SiLU、Bottleneck、Residual、Concat、Add；
3. **现代模块**：CSP、C3、C2f、C3k2、SPPF、C2PSA、DWConv（用变量式数据流记，不背图）；
4. **检测头和框**：Anchor-based/free、ltrb/xyxy、Coupled/Decoupled、DFL；
5. **训练逻辑**：标签分配、O2M/O2O、NMS、端到端、STAL、Progressive Loss；
6. **版本演进**：看每代解决什么问题，不当作背诵题。

## 14. 总结

YOLO 的发展围绕三个问题：如何更高效地提取特征（Conv/CSP/C2f/C3k2）、如何更好融合多尺度信息（FPN/PAN/SPPF）、如何让训练和推理更稳定准确简单（O2M/O2O、DFL、STAL、MuSGD、端到端）。YOLO26 是这条主线上强调端到端的一代：双头监督保证学得稳、One-to-One 让推理更干净、小目标友好和推理简化贯穿始终。

**系列文章**：[图像通道与颜色空间](/2026/08/12/image-channels-rgb-hsv-lab/) ｜ [线结构光成像原理](/2026/08/12/line-structured-light-principle/) ｜ [OTSU 自动阈值分割](/2026/08/12/otsu-threshold-segmentation/) ｜ [图像边缘检测](/2026/08/12/image-edge-detection/)
