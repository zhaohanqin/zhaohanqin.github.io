---
title: 图像边缘检测：从一阶导数到 Canny、LoG 与 DoG
date: 2026-08-12 13:00:00
permalink: /2026/08/12/image-edge-detection/
tags: [边缘检测, Sobel, Canny, Laplacian, LoG, DoG, 视觉原理系列]
categories: [视觉原理]
mathjax: true
---

边缘是图像中亮度、颜色或纹理发生明显变化的位置。检测边缘有两类数学思路：**一阶导数找梯度幅值峰值**，**二阶导数找响应的零交叉**。本文用一排像素讲清楚一阶/二阶导数，然后逐个拆解 Sobel、Canny、Laplacian、LoG、DoG，最后给出不同任务的选择建议。

<!-- more -->

## 1. 从一排像素理解一阶导数和二阶导数

假设一排像素亮度为 `20 20 20 20 200 200 200 200`，第 4、5 个像素之间发生跳变，这就是一条边缘。

### 一阶导数：亮度变化了多少

离散差分 $D_1(i)=I(i+1)-I(i)$：

```text
原始亮度：20  20  20  20  200  200  200  200
相邻差值： 0   0   0  180    0    0    0
```

平坦区域差值为 0，边缘处出现大差值。**一阶导数通过峰值寻找边缘**——Sobel、Prewitt、Scharr 和 Canny 的梯度计算都属于这一类。

### 二阶导数：坡度本身是否在变化

二阶差分 $D_2(i)=I(i-1)-2I(i)+I(i+1)$，也就是"右侧变化量 − 左侧变化量"。在理想跳变两侧会得到 `+180 → 0 → -180`，这就是**零交叉**。

真实边缘是平滑的 S 形曲线：一阶导数是峰（在边缘处达极值），二阶导数在峰前为正、峰处为 0、峰后为负，因此在边缘处发生零交叉。

$$\boxed{\text{一阶导数：边缘处达到极值}}$$
$$\boxed{\text{二阶导数：边缘处发生零交叉}}$$

## 2. 图像梯度

二维梯度：

$$I_x=\frac{\partial I}{\partial x},\quad I_y=\frac{\partial I}{\partial y},\quad
\nabla I=[I_x,\ I_y]^T$$

梯度幅值 $G=\sqrt{I_x^2+I_y^2}$（可近似 $|I_x|+|I_y|$），方向 $\theta=\operatorname{atan2}(I_y,I_x)$。梯度告诉我们：哪里变化、变化多强、朝哪个方向、从暗到亮还是从亮到暗。

## 3. 一阶梯度算子

| 算子 | 核特点 | 特点 |
|---|---|---|
| Roberts | 2×2 对角核 | 计算量最小，对噪声极敏感，边缘易断裂 |
| Prewitt | 3×3 均匀核 | 比 Roberts 稳，输出边缘较粗 |
| Sobel | 3×3 加权核 | 含轻度平滑，快、能算梯度方向，输出较粗、保留纹理响应 |
| Scharr | 3×3 改进核 | 小核下旋转对称性更好，梯度方向估计更准 |

Sobel 核：

$$G_x=\begin{bmatrix}-1&0&1\\-2&0&2\\-1&0&1\end{bmatrix},\quad
G_y=\begin{bmatrix}-1&-2&-1\\0&0&0\\1&2&1\end{bmatrix}$$

$G_x$ 突出垂直边缘，$G_y$ 突出水平边缘。Sobel 输出的是连续值梯度图（$G_x,G_y,G$），要保留方向信息应使用 float 类型，取绝对值会丢失正负方向。

## 4. Canny：一套完整的边缘检测系统

Canny 不是单个卷积核，而是一个流程：

```text
原图 → 高斯平滑 → 计算梯度 → 非极大值抑制 → 双阈值 → 滞后连接 → 二值边缘图
```

- **高斯平滑**：求导会放大噪声，先滤波；
- **梯度**：通常用 Sobel 计算 $G$ 和 $\theta$；
- **非极大值抑制**：沿梯度方向比较，只保留局部最大，把宽边缘细化到接近单像素；
- **双阈值**：$G\ge T_h$ 强边缘，$T_l\le G<T_h$ 弱边缘，$G<T_l$ 非边缘；
- **滞后连接**：与强边缘相连的弱边缘保留，孤立弱边缘删除。

### Sobel 与 Canny 的区别

| 对比 | Sobel | Canny |
|---|---|---|
| 层级 | 一阶梯度算子 | 完整检测系统 |
| 输出 | 连续值梯度图（强度+方向） | 二值边缘图 |
| 边缘宽度 | 较粗 | 细（单像素级） |
| 抗噪/连续性 | 有限 | 高斯平滑+双阈值+连接，更好 |

一句话：**Sobel 描述图像如何变化，Canny 判断哪些变化应该被保留为边缘**。

## 5. Laplacian：二阶导数算子

$$\nabla^2 I = \frac{\partial^2 I}{\partial x^2}+\frac{\partial^2 I}{\partial y^2}=I_{xx}+I_{yy}$$

四邻域核：

$$\begin{bmatrix}0&1&0\\1&-4&1\\0&1&0\end{bmatrix}$$

它本质上在比较"中心像素与周围平均亮度的差异"。注意：均匀渐变（如 `80 100 120`）一阶导数非零，但二阶导数为 0——**Laplacian 检测的是梯度的变化，不是梯度本身**。因此 $\sqrt{I_x^2+I_y^2}\neq I_{xx}+I_{yy}$。

Laplacian 对多方向边缘都有响应，但**强烈放大噪声**、出现正负双响应、不提供方向，单独用不如 Canny 稳定。

## 6. LoG：高斯拉普拉斯

$$R_{LoG}=\nabla^2(G_\sigma*I)=(\nabla^2 G_\sigma)*I$$

两种等价实现：先高斯平滑再 Laplacian，或直接用 LoG 核（"墨西哥帽"）卷积。$\sigma$ 同时决定平滑强度和观察尺度：

- 小 $\sigma$：保留细节、检测小结构、对噪声敏感；
- 大 $\sigma$：抑制噪声、关注大尺度轮廓、定位更模糊。

LoG 通过**零交叉**检测边缘：邻域内符号从正变负（或反之），且 $\max-\min>T$ 过滤弱小响应。

## 7. DoG：高斯差分

$$R_{DoG}=G_{\sigma_1}*I-G_{\sigma_2}*I,\qquad \sigma_2=k\sigma_1$$

两个不同尺度的高斯模糊结果相减，缓慢变化的背景相互抵消，特定尺度范围的结构被突出——DoG 是一种**带通滤波**。在边缘两侧，小尺度结果与大尺度结果的大小关系发生反转，因此同样出现零交叉。

DoG 近似尺度归一化 LoG：

$$\frac{\partial G_\sigma}{\partial\sigma}=\sigma\nabla^2G_\sigma
\;\Rightarrow\;
G_{k\sigma}-G_\sigma\approx (k-1)\sigma^2\nabla^2G_\sigma$$

| 对比 | LoG | DoG |
|---|---|---|
| 计算 | 高斯平滑后求 Laplacian | 两个高斯尺度相减 |
| 导数形式 | 显式二阶导数 | 近似二阶导数 |
| 边缘定位 | 零交叉 | 零交叉 |
| 典型用途 | 边缘、Blob | SIFT、Blob、多尺度特征 |

注意：LoG/DoG 结果含负数，**必须用 float 类型**，uint8 会截断负值、丢失零交叉信息。

## 8. 如何选择算法

| 需求 | 推荐 |
|---|---|
| 快速计算梯度 | Sobel |
| 精确小核梯度方向 | Scharr |
| 细而连续的轮廓 | Canny |
| 低算力、低噪声 | Roberts、Prewitt |
| 锐化/高频增强 | Laplacian、Sobel |
| 二阶零交叉边缘 | LoG |
| 多尺度 Blob | LoG、DoG |
| SIFT 特征点 | DoG |
| 二值区域边界 | 形态学梯度、轮廓提取 |
| 复杂自然图像语义边界 | HED、RCF、DexiNed 等深度学习 |

形态学梯度 $G_m=(I\oplus B)-(I\ominus B)$ 适合已有可靠二值分割的情况；**灰度边缘不等于语义边界**，草地、毛发、砖墙会产生大量传统梯度边缘，但未必是任务关心的边界。

## 9. OpenCV 示例

```python
import cv2
import numpy as np

image = cv2.imread("input.png", cv2.IMREAD_GRAYSCALE)

# Sobel：保留 float 类型以获得梯度方向
gx = cv2.Sobel(image, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(image, cv2.CV_32F, 0, 1, ksize=3)
magnitude = cv2.magnitude(gx, gy)
direction = cv2.phase(gx, gy, angleInDegrees=True)

# Canny
blurred = cv2.GaussianBlur(image, (5, 5), 1.0)
edges = cv2.Canny(blurred, 50, 150)

# Laplacian
lap = cv2.Laplacian(image, cv2.CV_32F, ksize=3)
```

LoG / DoG 的零交叉实现要点：检查 $3\times3$ 邻域是否 `min<0<max`，且 `max−min>=threshold`。

## 10. 常见误区

1. **Canny 一定比 Sobel 好**：要最终轮廓用 Canny，要完整梯度强度和方向用 Sobel；
2. **边缘越多越好**：边缘过多可能意味着噪声、阈值过低或纹理太多；
3. **阈值越高越准确**：过高丢弱边缘，过低留噪声，要按对比度、噪声、目标尺寸调；
4. **对 LoG/DoG 取绝对值就是边缘**：真正的边缘在正负响应之间的零交叉处；
5. **LoG/DoG 中间结果用 uint8**：会截断负数、丢失零交叉；
6. **模糊越强越好**：过度模糊会抹掉小边缘、降低定位精度。

## 11. 一句话理解

把图像亮度想象成地形：

- Sobel 测量坡度和坡向；
- Canny 从坡度中挑出最可靠的悬崖边界；
- Laplacian 判断坡度是在变陡还是变缓；
- LoG 先抹平噪声再判断坡度变化；
- DoG 用两种模糊尺度观察同一片地形，相减近似 LoG。

$$\boxed{\text{Sobel：描述变化}}\quad\boxed{\text{Canny：筛选边缘}}\quad\boxed{\text{Laplacian：描述变化的变化}}$$

**系列文章**：[图像通道与颜色空间](/2026/08/12/image-channels-rgb-hsv-lab/) ｜ [线结构光成像原理](/2026/08/12/line-structured-light-principle/) ｜ [OTSU 自动阈值分割](/2026/08/12/otsu-threshold-segmentation/) ｜ [YOLO 系列模型与 YOLO26 核心模块](/2026/08/12/yolo-series-and-yolo26/)
