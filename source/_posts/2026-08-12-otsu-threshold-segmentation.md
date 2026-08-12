---
title: OTSU 自动阈值分割：最大类间方差的原理与工程实践
date: 2026-08-12 12:00:00
permalink: /2026/08/12/otsu-threshold-segmentation/
tags: [Otsu, 大津法, 阈值分割, 二值化, 图像处理, 视觉原理系列]
categories: [视觉原理]
mathjax: true
---

把灰度图变成二值图，最简单的方法是设一个固定阈值，比如"大于 128 是前景"。但固定阈值怕光照、怕批次差异。Otsu（大津法）不要求人工指定阈值，它根据当前图像的灰度直方图，自动选出一个让"两类内部尽量一致、两类之间差异尽量大"的全局阈值。

> 名称说明：Otsu 不是英文缩写，而是提出者日本学者大津展之（Nobuyuki Otsu）的姓氏；"OUST"是常见误写。

<!-- more -->

## 1. 要解决的问题

设灰度图像 $I(x,y)\in[0,L-1]$，8 位图 $L=256$。希望找到阈值 $t$ 把像素分成两类：

$$C_0=\{I\le t\},\qquad C_1=\{I>t\}$$

关键问题是：$t$ 取多少，两类分离得最好？Otsu 遍历所有候选阈值，选择使**类间方差最大**的那个。

## 2. 数学原理

设灰度值 $i$ 的像素数为 $n_i$，总像素 $N$，则概率 $p_i=n_i/N$。

对候选阈值 $t$，定义：

$$\omega_0(t)=\sum_{i=0}^{t}p_i,\qquad \omega_1(t)=1-\omega_0(t)$$

$$\mu_0(t)=\frac{\sum_{i=0}^{t}i\,p_i}{\omega_0(t)},\qquad
\mu_1(t)=\frac{\mu_T-\mu(t)}{1-\omega_0(t)}$$

其中 $\mu_T$ 是全局均值，$\mu(t)=\sum_{i=0}^{t}i\,p_i$ 是累计均值。

**类间方差**：

$$\boxed{\sigma_B^2(t)=\omega_0(t)\,\omega_1(t)\,[\mu_0(t)-\mu_1(t)]^2}$$

最优阈值：

$$t^*=\arg\max_t \sigma_B^2(t)$$

$\omega_0\omega_1$ 反映类别规模（避免把 99.9% vs 0.1% 的失衡分割当成最优），$(\mu_0-\mu_1)^2$ 反映两类均值距离。

### 为什么"最大类间方差"等于"最小类内方差"

图像总方差可分解为：

$$\sigma_T^2=\sigma_W^2(t)+\sigma_B^2(t)$$

总方差固定，所以最大化 $\sigma_B^2$ 与最小化类内方差 $\sigma_W^2$ 等价。

### 高效累计计算

程序实现用累计直方图和累计灰度和：

$$\sigma_B^2(t)=\frac{[\mu_T\,\omega_0(t)-\mu(t)]^2}{\omega_0(t)[1-\omega_0(t)]}$$

复杂度为 $O(N+L)$，8 位图 $L=256$，非常快。

## 3. 算法流程与伪代码

```text
1. 统计直方图 histogram
2. total = 总像素数；total_sum = 全局灰度和
3. 初始化 background_weight=0, background_sum=0
4. 对 threshold 从 0 到 255：
     background_weight += histogram[threshold]
     if background_weight == 0: continue
     foreground_weight = total - background_weight
     if foreground_weight == 0: break
     background_sum += threshold * histogram[threshold]
     计算两类均值 → between_variance
     记录最大 between_variance 对应的 threshold
5. 用最优阈值生成二值图
```

标准二值化 $B=I>t^*$ 为白，反向 $B=I\le t^*$ 为白。

## 4. 代码示例

### OpenCV

```python
import cv2

gray = cv2.imread("input.png", cv2.IMREAD_GRAYSCALE)
blurred = cv2.GaussianBlur(gray, (5, 5), 0)

thr, binary = cv2.threshold(blurred, 0, 255,
                            cv2.THRESH_BINARY + cv2.THRESH_OTSU)
print("Otsu threshold:", thr)
```

启用 `THRESH_OTSU` 后传入的阈值参数写 0，返回值第一个数才是实际阈值；目标比背景暗时用 `THRESH_BINARY_INV`。

### scikit-image（含 Multi-Otsu）

```python
from skimage.filters import threshold_otsu, threshold_multiotsu
import numpy as np

thr = threshold_otsu(gray)
mask = gray > thr

thresholds = threshold_multiotsu(gray, classes=3)
regions = np.digitize(gray, bins=thresholds)
```

### MATLAB

```matlab
T = graythresh(I);          % 归一化阈值 [0,1]
BW = imbinarize(I, T);
BW_clean = bwareaopen(BW, 100);   % 删除面积小于 100 的区域
```

### 手动实现（NumPy）

```python
import numpy as np

def otsu_threshold(gray):
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = gray.size
    levels = np.arange(256, dtype=np.float64)
    total_sum = np.dot(levels, hist)
    bg_w = 0.0
    bg_sum = 0.0
    best_t, best_v = 0, -1.0
    for t in range(256):
        bg_w += hist[t]
        if bg_w == 0:
            continue
        fg_w = total - bg_w
        if fg_w == 0:
            break
        bg_sum += t * hist[t]
        mu0 = bg_sum / bg_w
        mu1 = (total_sum - bg_sum) / fg_w
        v = bg_w * fg_w * (mu0 - mu1) ** 2
        if v > best_v:
            best_v, best_t = v, t
    return best_t
```

## 5. 典型应用

- **文档二值化与 OCR**：发票、票据、车牌字符、二维码预处理；
- **工业缺陷检测**：划痕、黑点、污渍、焊点缺陷、零件缺失；
- **医学图像**：细胞与背景的初步分割、候选区域生成（通常只作预处理）；
- **遥感**：对 NDVI/NDWI 指数图做水体、植被、建筑粗分割；
- **目标候选提取**：二值掩膜 → 轮廓 → 外接矩形 → 面积/长宽比筛选；
- **变化检测**：对两幅配准图差分 $D=|I_1-I_2|$ 再做 Otsu；
- **边缘检测辅助**：对梯度幅值图做阈值分割，或估计 Canny 高低阈值。

## 6. 优点

自动确定阈值、无需训练数据、速度快（$O(N+L)$）、可解释性强、主流库都有现成实现，是非常好的传统视觉基线和预处理工具。

## 7. 局限性

1. **全局阈值**：整幅图一个阈值，光照不均、阴影、渐变背景下会失败；
2. **依赖灰度可分性**：目标与背景灰度重叠时，"最优"也只是类间方差准则下的最优，不等于语义最优；
3. **不用空间信息**：不看形状、边界、邻域，无法理解纹理和语义；
4. **对噪声敏感**：椒盐噪声、纹理会改变直方图；
5. **类别极度不平衡**：小目标占比极低时可能被忽略；
6. **单通道**：彩色图要先转灰度或选通道；
7. **只能分两类**：三类以上需要 Multi-Otsu 等方法。

## 8. 工程改进方法

| 问题 | 改进 |
|---|---|
| 背景亮度缓慢变化 | 背景估计 → 光照校正（减背景或除背景）→ Otsu |
| 阴影/局部明暗差异 | 自适应阈值、Sauvola、局部 Otsu |
| 需要三类以上 | Multi-Otsu、K-means、GMM |
| 小目标比例低 | 先裁 ROI、有效掩膜内统计、Weighted/Valley-emphasis Otsu |
| 噪声 | 适度滤波（高斯/中值/双边） |
| 彩色目标亮度接近但颜色不同 | 转 HSV/Lab/YCbCr 选最可分的通道 |

典型稳健流程：

```text
采集 → 光照校正 → 选通道/灰度化 → 滤波 → Otsu → 形态学开闭
→ 连通域过滤 → 面积/形状统计
```

二维 Otsu（同时用当前像素灰度和邻域均值构造二维直方图）可以引入部分空间信息，但计算量更大。

## 9. 与其他方法对比

| 方法 | 形式 | 优点 | 局限 |
|---|---|---|---|
| 固定阈值 | 人工全局值 | 最简单 | 怕光照变化 |
| Otsu | 自动全局阈值 | 参数少、快、可解释 | 怕光照不均和灰度重叠 |
| 自适应阈值 | 局部阈值 | 适合不均匀背景 | 参数多、放大噪声 |
| Niblack/Sauvola | 局部统计阈值 | 文档二值化稳 | 需调窗口参数 |
| Multi-Otsu | 多个全局阈值 | 可分多类 | 类别数增多计算量上升 |
| 深度学习分割 | 学习语义特征 | 复杂场景强 | 需要数据、训练、算力 |

## 10. 工程选型建议

- 光照均匀、对比明显、直方图接近双峰 → 灰度化 → 轻微去噪 → Otsu → 形态学；
- 背景渐变 → 先光照校正再 Otsu；
- 阴影明显 → 自适应阈值 / Sauvola / 局部 Otsu；
- 需要识别具体类别 → Otsu 只能做前处理或候选生成，交给检测/分割模型。

## 11. 小结

Otsu 的核心是：遍历候选阈值，最大化类间方差 $\sigma_B^2=\omega_0\omega_1(\mu_0-\mu_1)^2$。它自动、快速、可解释、无需训练，适合光照均匀、对比明显的二值分割；在复杂条件下应结合光照校正、滤波、ROI、局部阈值、Multi-Otsu 和形态学后处理。

**系列文章**：[图像通道与颜色空间](/2026/08/12/image-channels-rgb-hsv-lab/) ｜ [线结构光成像原理](/2026/08/12/line-structured-light-principle/) ｜ [图像边缘检测](/2026/08/12/image-edge-detection/) ｜ [YOLO 系列模型与 YOLO26 核心模块](/2026/08/12/yolo-series-and-yolo26/)
