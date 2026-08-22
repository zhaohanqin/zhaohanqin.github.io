---
title: 双目视觉深度图与三维重建超详细说明文档：从像素对应、BM、SGM 到 Depth Map 与 Point Cloud
date: 2026-08-22 22:30:00
permalink: /2026/08/22/binocular-vision-depth-3d-reconstruction/
tags: [双目视觉, 立体匹配, 视差, Cost Volume, BM, SGM, StereoSGBM, 深度图, 三维重建, 点云, 视觉原理系列]
categories: [原理说明类]
mathjax: true
---


> 本文档围绕一个核心问题展开：
>
> **在左右双目相机的内参、畸变参数以及相对位姿已经标定好的情况下，怎样从左右两张图像中找到“同一个空间点”的像素对应关系，并进一步得到视差图、深度图以及三维点云？**
>
> 重点不是只会调用 `StereoBM` / `StereoSGBM`，而是把它们内部到底在解决什么问题、数据如何流动、每一步为什么存在讲清楚。
>
> 本文的讲解顺序是：
>
> **先讲整体数据流 → 再讲极线约束 → 再讲对应点搜索 → 再讲 Matching Cost / Cost Volume → 再讲 BM → 再讲 SGM / SGBM → 再讲视差后处理 → 最后讲深度图和三维重建。**

<!-- more -->
---

## 目录

1. [阅读本文前需要掌握什么](#1-阅读本文前需要掌握什么)
2. [双目相机最终到底要算什么](#2-双目相机最终到底要算什么)
3. [整个双目深度流程先看一遍](#3-整个双目深度流程先看一遍)
4. [为什么已知相对位姿以后还不能直接得到深度](#4-为什么已知相对位姿以后还不能直接得到深度)
5. [双目三角测量最核心的几何关系](#5-双目三角测量最核心的几何关系)
6. [为什么最难的是“找对应点”](#6-为什么最难的是“找对应点”)
7. [Stereo Rectification 到底解决什么](#7-Stereo-Rectification-到底解决什么)
8. [校正后为什么只需要沿水平方向搜索](#8-校正后为什么只需要沿水平方向搜索)
9. [Disparity 到底是什么](#9-Disparity-到底是什么)
10. [从“对应点”到“视差”的完整逻辑](#10-从“对应点”到“视差”的完整逻辑)
11. [怎样判断两个候选位置“像不像”](#11-怎样判断两个候选位置“像不像”)
12. [为什么通常不比较单个像素而比较一个窗口](#12-为什么通常不比较单个像素而比较一个窗口)
13. [SAD、SSD、NCC、Census 分别是什么](#13-SAD、SSD、NCC、Census-分别是什么)
14. [Cost Volume 到底是什么](#14-Cost-Volume-到底是什么)
15. [Cost Volume 的张量尺寸怎样理解](#15-Cost-Volume-的张量尺寸怎样理解)
16. [Block Matching BM 的完整过程](#16-Block-Matching-BM-的完整过程)
17. [BM 的逐像素数值例子](#17-BM-的逐像素数值例子)
18. [Winner-Takes-All 是什么](#18-Winner-Takes-All-是什么)
19. [为什么 BM 很容易出错](#19-为什么-BM-很容易出错)
20. [纹理弱、重复纹理和遮挡为什么困难](#20-纹理弱、重复纹理和遮挡为什么困难)
21. [SGM 为什么比 BM 更稳定](#21-SGM-为什么比-BM-更稳定)
22. [SGM 的能量函数怎样理解](#22-SGM-的能量函数怎样理解)
23. [P1 和 P2 到底在惩罚什么](#23-P1-和-P2-到底在惩罚什么)
24. [SGM 的动态规划递推公式](#24-SGM-的动态规划递推公式)
25. [为什么叫 Semi-Global Matching](#25-为什么叫-Semi-Global-Matching)
26. [多方向路径聚合怎样得到最终视差](#26-多方向路径聚合怎样得到最终视差)
27. [SGM 与 OpenCV StereoSGBM 的关系](#27-SGM-与-OpenCV-StereoSGBM-的关系)
28. [StereoBM 与 StereoSGBM 参数怎么理解](#28-StereoBM-与-StereoSGBM-参数怎么理解)
29. [OpenCV 视差乘 16 是什么意思](#29-OpenCV-视差乘-16-是什么意思)
30. [亚像素视差为什么重要](#30-亚像素视差为什么重要)
31. [左右一致性检查是什么](#31-左右一致性检查是什么)
32. [Speckle、孔洞和错误视差怎么处理](#32-Speckle、孔洞和错误视差怎么处理)
33. [从视差图计算深度图](#33-从视差图计算深度图)
34. [深度误差为什么会随距离迅速增大](#34-深度误差为什么会随距离迅速增大)
35. [从 Depth Map 反投影得到三维点](#35-从-Depth-Map-反投影得到三维点)
36. [Q 矩阵与 reprojectImageTo3D](#36-Q-矩阵与-reprojectImageTo3D)
37. [点云为什么还需要颜色](#37-点云为什么还需要颜色)
38. [完整 OpenCV C++ 工程流程](#38-完整-OpenCV-C-工程流程)
39. [从零实现简化版 BM](#39-从零实现简化版-BM)
40. [从零理解简化版 SGM 伪代码](#40-从零理解简化版-SGM-伪代码)
41. [完整数据结构和尺寸变化](#41-完整数据结构和尺寸变化)
42. [BM 与 SGM 对比](#42-BM-与-SGM-对比)
43. [常见混淆点](#43-常见混淆点)
44. [推荐的术语体系](#44-推荐的术语体系)
45. [完整知识地图](#45-完整知识地图)
46. [推荐学习路线](#46-推荐学习路线)
47. [最后总结](#47-最后总结)
48. [一句话速记](#48-一句话速记)

---

## 1. 阅读本文前需要掌握什么

为了真正理解双目深度，最好已经知道以下几个概念：

```text
相机内参 K
畸变参数 D
旋转矩阵 R
平移向量 T
针孔相机模型
像素坐标 (u,v)
相机坐标 (X,Y,Z)
焦距 fx, fy
主点 cx, cy
```

假设左右相机已经完成标定，我们已经知道：

```text
Left Camera:
K1
D1

Right Camera:
K2
D2

Left → Right:
R
T
```

其中：

```text
K1 / K2
=
相机内参

D1 / D2
=
畸变参数

R
=
左右相机之间的旋转

T
=
左右相机之间的平移
```

如果双目相机是典型水平安装，那么：

```text
|T|
```

对应的量级就是双目基线：

```text
Baseline B
```

---

## 2. 双目相机最终到底要算什么

双目深度的输入是：

```text
Left Image
+
Right Image
```

最终希望输出：

```text
Depth Map
```

也就是：

> **对于左图中的每一个有效像素，估计这个像素所看到的空间点距离相机有多远。**

例如：

```text
Left Image Pixel

(u=320, v=240)
```

经过双目深度计算以后得到：

```text
Depth(320,240) = 2.37 m
```

也就是说：

> 左相机图像中 `(320,240)` 这个像素看到的三维空间点，沿相机 Z 轴方向的深度大约为 2.37 m。

整张图像都这样计算：

```text
Z(0,0)    Z(1,0)    Z(2,0)    ...
Z(0,1)    Z(1,1)    Z(2,1)    ...
...
```

于是得到：

```text
Depth Map
=
H × W
```

---

## 3. 整个双目深度流程先看一遍

完整流程可以先压缩成：

```text
Left Raw Image
Right Raw Image
       │
       ↓
相机去畸变
       │
       ↓
Stereo Rectification
       │
       ↓
Left Rectified
Right Rectified
       │
       ↓
构造像素匹配代价
C(x,y,d)
       │
       ↓
BM / SGM / SGBM
       │
       ↓
Disparity Map
d(x,y)
       │
       ↓
Z = fB / d
       │
       ↓
Depth Map
Z(x,y)
       │
       ↓
像素反投影
       │
       ↓
(X,Y,Z)
       │
       ↓
3D Point Cloud
```

需要特别注意：

```text
BM / SGM
```

直接输出的本质上不是：

```text
Depth
```

而是：

```text
Disparity
```

然后才通过几何关系：

\[
Z=\frac{fB}{d}
\]

把视差转换成深度。

---

## 4. 为什么已知相对位姿以后还不能直接得到深度

这是一个非常关键的理解点。

已经知道：

```text
R
T
K1
K2
```

只说明：

> 两台相机之间的几何关系已经知道。

但是对于左图某一个像素：

```text
pL = (xL,yL)
```

还不知道：

> 右图中哪一个像素 `pR` 是同一个三维空间点的投影。

例如左图中的：

```text
(320, 200)
```

右图中可能候选有：

```text
(318,200)
(310,200)
(295,200)
(270,200)
...
```

如果不知道哪一个才是真正对应点，就无法形成三角测量。

所以：

```text
相机标定
```

解决的是：

```text
两台相机之间怎么摆
```

而：

```text
Stereo Matching
```

解决的是：

```text
左图这个点
到底对应右图哪个点
```

这两件事完全不同。

---

## 5. 双目三角测量最核心的几何关系

先考虑最理想的水平双目模型。

```text
          P(X,Y,Z)
             *
            / \
           /   \
          /     \
         /       \
       OL---------OR
            B
```

其中：

```text
OL
=
左相机光心

OR
=
右相机光心

B
=
Baseline
```

假设经过立体校正以后，两台相机：

```text
光轴平行
成像平面共面
基线沿 X 方向
```

对于同一个空间点：

左相机投影：

\[
x_L=\frac{fX}{Z}
\]

右相机投影：

\[
x_R=\frac{f(X-B)}{Z}
\]

两式相减：

\[
x_L-x_R
=
\frac{fX}{Z}
-
\frac{f(X-B)}{Z}
\]

得到：

\[
x_L-x_R
=
\frac{fB}{Z}
\]

定义：

\[
d=x_L-x_R
\]

于是：

\[
\boxed{
d=\frac{fB}{Z}
}
\]

最终：

\[
\boxed{
Z=\frac{fB}{d}
}
\]

这就是双目深度最核心的公式。

---

## 6. 为什么最难的是“找对应点”

从公式：

\[
Z=\frac{fB}{d}
\]

可以看到：

```text
f
```

来自相机内参。

```text
B
```

来自双目标定。

真正未知的是：

```text
d
```

而：

\[
d=x_L-x_R
\]

所以问题最终变成：

> **给定左图像素 `(xL,yL)`，怎样知道右图中同一个空间点的位置 `(xR,yR)`？**

这就是：

```text
Correspondence Problem
```

也叫：

```text
Stereo Matching
```

因此双目深度的核心难题并不是：

```text
Z = fB / d
```

这个公式。

真正难的是：

```text
Left Pixel
     ↓
找到
     ↓
Right Corresponding Pixel
```

---

## 7. Stereo Rectification 到底解决什么

如果不做立体校正，左图中的一个像素：

```text
pL
```

在右图中的对应点一般不会简单地出现在同一行。

根据双目几何，对应点应该位于：

```text
Epipolar Line
```

即极线上。

原始情况下可能是：

```text
Left Image

        *
       pL
```

对应右图的搜索范围可能是一条倾斜极线：

```text
Right Image

  ----------------
       /
      /
     /
    /
```

这样搜索比较复杂。

Stereo Rectification 的目标就是：

> 通过重新投影，让左右图中的极线都变成水平线。

校正后：

```text
Left Image

-------------------------
           ● pL
-------------------------


Right Image

-------------------------
       ? ? ? ? ? ? ?
-------------------------
```

于是对应点满足近似：

\[
\boxed{
y_L=y_R
}
\]

这样二维对应搜索就被简化成了一维搜索。

---

## 8. 校正后为什么只需要沿水平方向搜索

假设左图：

```text
pL = (300,200)
```

校正后，它在右图中的对应点应该满足：

```text
yR = 200
```

所以不需要搜索：

```text
整个 H × W 图像
```

而只需要在：

```text
Right Image Row = 200
```

这一条线上搜索：

```text
xR
```

例如：

```text
Left:
xL = 300

Right candidates:

xR = 300
xR = 299
xR = 298
...
xR = 250
...
```

如果假设最大视差：

```text
Dmax = 128
```

那么一般只需要枚举：

\[
d=0,1,2,\dots,127
\]

对应：

\[
x_R=x_L-d
\]

所以：

```text
2D Correspondence Search
```

变成：

```text
1D Disparity Search
```

这就是立体校正对工程实现如此重要的原因。

---

## 9. Disparity 到底是什么

视差定义为：

\[
\boxed{
d=x_L-x_R
}
\]

例如：

```text
Left:
xL = 300

Right:
xR = 260
```

那么：

\[
d=300-260=40
\]

这意味着：

```text
该三维空间点
在左右图像之间
产生了 40 pixel 的水平位移
```

对于图像中的每一个有效像素：

```text
(x,y)
```

都会得到一个：

```text
d(x,y)
```

于是整张图形成：

```text
Disparity Map
```

例如：

```text
20 20 21 22 40 41
20 20 21 23 40 41
19 20 21 23 39 40
...
```

---

## 10. 从“对应点”到“视差”的完整逻辑

对于左图像素：

\[
p=(x,y)
\]

枚举候选视差：

\[
d
\]

那么对应的右图候选位置为：

\[
p_d=(x-d,y)
\]

算法要解决：

```text
d = 0  →  像不像？
d = 1  →  像不像？
d = 2  →  像不像？
...
d = Dmax → 像不像？
```

最后选择最像的那个：

\[
d^*
\]

于是：

```text
Left:
(x,y)

Right:
(x-d*, y)
```

被认为是对应点。

因此：

\[
\boxed{
Stereo Matching
=
在候选 disparity 中寻找最佳 d
}
\]

---

## 11. 怎样判断两个候选位置“像不像”

最直接的办法是比较灰度值。

假设：

```text
Left Pixel  = 120
Right Pixel = 118
```

差异：

\[
|120-118|=2
\]

很小。

可能是对应点。

如果：

```text
Left Pixel  = 120
Right Pixel = 35
```

差异：

\[
|120-35|=85
\]

明显不太像。

所以可以定义：

\[
C(x,y,d)
\]

表示：

> 左图 `(x,y)` 和右图 `(x-d,y)` 在视差 `d` 下的匹配代价。

一般：

```text
Cost 越小
=
越相似
```

---

## 12. 为什么通常不比较单个像素而比较一个窗口

单个像素非常不稳定。

例如某个灰色区域：

```text
Left pixel = 100
```

右图可能很多位置也是：

```text
100
```

无法确定哪个是真正对应点。

所以更常见的是取：

```text
3×3
5×5
7×7
...
```

图像窗口。

例如左图：

```text
┌───────────┐
│  52 51 50 │
│  78 80 79 │
│ 118120119 │
└───────────┘
```

右图候选位置也取相同大小：

```text
┌───────────┐
│  51 50 50 │
│  77 79 80 │
│ 117119120 │
└───────────┘
```

比较两个 patch 的整体相似程度。

这就是：

```text
Block Matching
```

名字中：

```text
Block
```

的来源。

---

## 13. SAD、SSD、NCC、Census 分别是什么

Stereo Matching 中可以采用很多 Matching Cost。

---

### 13.1 SAD

SAD：

```text
Sum of Absolute Differences
```

公式：

\[
C(x,y,d)
=
\sum_{(i,j)\in W}
\left|
I_L(x+i,y+j)
-
I_R(x-d+i,y+j)
\right|
\]

其中：

```text
W
=
窗口
```

例如：

```text
5 × 5
```

SAD 的特点：

```text
简单
速度快
容易实现
```

---

### 13.2 SSD

SSD：

```text
Sum of Squared Differences
```

公式：

\[
C(x,y,d)
=
\sum_{(i,j)\in W}
\left(
I_L(x+i,y+j)
-
I_R(x-d+i,y+j)
\right)^2
\]

相比 SAD：

```text
大误差被平方放大
```

---

### 13.3 NCC

NCC：

```text
Normalized Cross Correlation
```

核心思想：

> 比较两个 patch 的相关性，而不只是直接比较像素绝对值。

对一定程度的亮度变化通常比简单 SAD 更稳定，但计算量也更高。

---

### 13.4 Census Transform

Census 不直接依赖灰度绝对值，而是描述：

```text
中心像素
和周围邻居
之间的相对大小关系
```

例如：

```text
Neighbor < Center → 0
Neighbor > Center → 1
```

形成一串 bit pattern。

左右 patch 通过：

```text
Hamming Distance
```

比较。

Census 对：

```text
曝光差异
亮度变化
一定程度的光照变化
```

通常更加鲁棒。

现代工程 Stereo Matching 中，Census 是非常经典的 Matching Cost 之一。

---

## 14. Cost Volume 到底是什么

这是理解 BM、SGM 以及很多深度学习 Stereo 网络最重要的数据结构之一。

对于每个：

```text
(x,y)
```

不是只算一个 cost。

而是：

```text
d=0  算一次
d=1  算一次
d=2  算一次
...
d=D-1 算一次
```

所以：

\[
C(x,y,d)
\]

实际上是一个三维数组。

可以理解为：

```text
Image Position:
(x,y)

每个位置下面
都有一整排 disparity 候选：

d=0   → cost
d=1   → cost
d=2   → cost
...
d=D-1 → cost
```

这个三维结构就是：

```text
Cost Volume
```

---

## 15. Cost Volume 的张量尺寸怎样理解

假设图像：

```text
Width  = W
Height = H
```

最大搜索视差数量：

```text
D
```

那么 Cost Volume 可以表示为：

\[
C\in\mathbb{R}^{H\times W\times D}
\]

例如：

```text
Image:
640 × 480

Disparity candidates:
128
```

那么：

```text
Cost Volume
=
[480, 640, 128]
```

含义：

```text
480 × 640
=
图像空间位置数量

128
=
每个像素考虑 128 个候选视差
```

对于：

```text
C[200][300][40]
```

含义：

> 左图 `(300,200)` 和右图 `(300-40,200)` 在 `d=40` 时的 Matching Cost。

---

## 16. Block Matching BM 的完整过程

BM 可以概括为：

> **对左图每一个像素，在右图同一行上滑动一个窗口，把每个候选位置都比较一遍，最后选择代价最小的位置。**

完整过程：

```text
Left Rectified Image
Right Rectified Image
       │
       ↓
选择左图像素 p=(x,y)
       │
       ↓
取左图局部窗口 WL
       │
       ↓
枚举 disparity d
       │
       ├── d=0
       ├── d=1
       ├── d=2
       ├── ...
       └── d=Dmax
       │
       ↓
在右图取 WR(x-d,y)
       │
       ↓
计算 Matching Cost
C(x,y,d)
       │
       ↓
找到最小 cost
       │
       ↓
best disparity
d*(x,y)
```

数学上：

\[
\boxed{
d^*(x,y)
=
\arg\min_d C(x,y,d)
}
\]

---

## 17. BM 的逐像素数值例子

为了简单，先用一维 5-pixel patch。

左图窗口：

```text
[50, 80, 120, 81, 49]
```

候选 A：

```text
[20, 30, 35, 29, 21]
```

SAD：

\[
|50-20|
+
|80-30|
+
|120-35|
+
|81-29|
+
|49-21|
\]

得到：

\[
30+50+85+52+28=245
\]

候选 B：

```text
[49, 79, 118, 83, 50]
```

SAD：

\[
1+1+2+2+1=7
\]

所以：

```text
Cost(A) = 245
Cost(B) = 7
```

显然：

```text
B
```

更加可能是真正对应位置。

假设：

```text
Candidate B
对应 disparity = 25
```

那么：

\[
d=25
\]

---

## 18. Winner-Takes-All 是什么

假设某个像素得到：

| disparity d | Cost |
|---:|---:|
| 0 | 450 |
| 1 | 420 |
| 2 | 370 |
| 3 | 300 |
| 4 | 180 |
| 5 | 75 |
| 6 | 12 |
| 7 | 65 |
| 8 | 140 |

最低代价：

```text
12
```

对应：

```text
d = 6
```

所以选择：

\[
d^*=6
\]

这种：

```text
哪个 cost 最小
就选哪个 disparity
```

叫：

```text
Winner-Takes-All
```

简称：

```text
WTA
```

因此最简单的 BM：

\[
\boxed{
D(p)=\arg\min_d C(p,d)
}
\]

---

## 19. 为什么 BM 很容易出错

BM 最大的问题是：

> **每个像素主要根据自己的局部窗口独立做决定。**

它几乎没有显式考虑：

```text
邻居像素的 disparity
```

但是现实世界表面通常具有连续性。

例如一面平整墙壁，真实 disparity 可能是：

```text
20 20 20 20 20 20
20 20 20 20 20 20
20 20 20 20 20 20
```

BM 受到噪声影响后可能得到：

```text
20 21 18 24 20 19
19 20 27 18 20 22
20 20 19 31 20 20
```

单个局部窗口偶尔匹配错误时，没有强约束把它“拉回来”。

这就是 SGM 要解决的问题。

---

## 20. 纹理弱、重复纹理和遮挡为什么困难

---

### 20.1 纹理弱区域

例如白墙：

```text
██████████████████
██████████████████
██████████████████
```

左图 patch：

```text
100 100 100
100 100 100
100 100 100
```

右图很多位置都差不多。

于是：

\[
C(d=10)
\approx
C(d=20)
\approx
C(d=30)
\]

无法确定真正对应点。

---

### 20.2 重复纹理

例如栅栏：

```text
| | | | | | | | | |
```

左图一个窗口：

```text
| | |
```

右图多个位置都可能找到：

```text
| | |
```

会出现多个局部最优解。

---

### 20.3 遮挡

某个空间区域可能：

```text
左相机可见
右相机不可见
```

例如：

```text
       foreground
          ███
         /   \
 Left ●       ● Right
```

物体边缘后面的区域可能只在一只相机里出现。

这时：

> 左图像素在右图根本没有真实对应点。

所以不是所有像素都一定可以获得合法 disparity。

---

### 20.4 反光 / 透明区域

例如：

```text
玻璃
镜面金属
水面
```

左右相机看到的亮度和纹理可能并不满足简单的亮度一致性假设。

因此传统 Stereo Matching 会比较困难。

---

## 21. SGM 为什么比 BM 更稳定

BM 主要优化：

\[
C(p,d)
\]

即：

```text
当前像素
选哪个 disparity
匹配得最像
```

SGM 不仅希望：

```text
左右图像匹配得像
```

还希望：

```text
邻居像素的 disparity
不要无缘无故剧烈跳变
```

所以 SGM 解决的是：

```text
Data Term
+
Smoothness Term
```

可以直观理解：

```text
图像证据告诉我：
d=20 比较像

邻域结构告诉我：
周围全部都是 d=20

那么：
d=20 更可信
```

---

## 22. SGM 的能量函数怎样理解

经典 SGM 的思想可以写成：

\[
E(D)
=
\sum_p C(p,D_p)
+
\sum_{q\in N_p}
P_1[|D_p-D_q|=1]
+
\sum_{q\in N_p}
P_2[|D_p-D_q|>1]
\]

不需要一开始死记公式。

它其实只有三部分。

---

### 22.1 Matching Cost

\[
C(p,D_p)
\]

回答：

```text
左图这个像素
选择 disparity Dp
和右图匹配得像不像？
```

---

### 22.2 小视差变化惩罚

如果：

\[
|D_p-D_q|=1
\]

增加：

\[
P_1
\]

含义：

> 邻居之间小幅度深度变化是允许的，但仍然付一点代价。

---

### 22.3 大视差变化惩罚

如果：

\[
|D_p-D_q|>1
\]

增加：

\[
P_2
\]

并且：

\[
P_2>P_1
\]

意味着：

> 大幅 disparity 跳变一般不应该随意发生。

当然物体边缘确实可以出现深度突变，所以不能把大跳变完全禁止，只是让它更加昂贵。

---

## 23. P1 和 P2 到底在惩罚什么

假设前一个像素 disparity：

```text
20
```

当前像素候选：

### 情况 A

```text
20 → 20
```

不惩罚：

\[
0
\]

### 情况 B

```text
20 → 21
```

小变化：

\[
P_1
\]

### 情况 C

```text
20 → 35
```

大变化：

\[
P_2
\]

并且：

\[
P_2>P_1
\]

因此算法倾向于：

```text
20 20 20 21 21 22 22
```

而不是：

```text
20 3 41 8 27 20 55
```

---

## 24. SGM 的动态规划递推公式

沿某个路径方向：

\[
r
\]

从前一个像素：

\[
p-r
\]

走到当前像素：

\[
p
\]

定义：

\[
L_r(p,d)
\]

表示：

> 沿方向 `r` 到达像素 `p`，并且让当前像素选择 disparity `d` 时的累计路径代价。

经典递推形式：

\[
L_r(p,d)
=
C(p,d)
+
\min
\begin{cases}
L_r(p-r,d)\\
L_r(p-r,d-1)+P_1\\
L_r(p-r,d+1)+P_1\\
\min_kL_r(p-r,k)+P_2
\end{cases}
-
\min_kL_r(p-r,k)
\]

最后减去：

\[
\min_kL_r(p-r,k)
\]

主要用于防止数值沿路径不断增长。

真正重要的是中间四个候选项。

---

### 24.1 第一项

\[
L_r(p-r,d)
\]

表示：

```text
前一个像素也是 disparity d
```

即：

```text
20 → 20
```

不额外惩罚。

---

### 24.2 第二项

\[
L_r(p-r,d-1)+P_1
\]

表示：

```text
前一个像素是 d-1
```

例如：

```text
19 → 20
```

小变化。

---

### 24.3 第三项

\[
L_r(p-r,d+1)+P_1
\]

表示：

```text
21 → 20
```

也是小变化。

---

### 24.4 第四项

\[
\min_kL_r(p-r,k)+P_2
\]

表示：

```text
前一个像素选择了其他任意 disparity
并且和当前 d 差距较大
```

例如：

```text
8 → 20
```

因此付出更大的：

\[
P_2
\]

---

## 25. 为什么叫 Semi-Global Matching

理论上希望直接优化整张二维图像：

```text
所有像素 disparity
彼此一起决定
```

这属于：

```text
Global Optimization
```

但真正对整张二维网格进行全局优化，计算量很大。

SGM 的折中方式是：

> 把二维全局问题拆成多条一维路径，在多个方向上做动态规划，再把路径结果聚合起来。

常见路径方向可以理解为：

```text
→
←
↓
↑
↘
↖
↙
↗
```

所以它不是：

```text
纯 Local
```

也不是：

```text
严格 2D Global Optimization
```

而是：

```text
Semi-Global
```

---

## 26. 多方向路径聚合怎样得到最终视差

每个方向：

```text
r
```

都会得到：

\[
L_r(p,d)
\]

然后累加：

\[
\boxed{
S(p,d)
=
\sum_r L_r(p,d)
}
\]

这可以理解为：

```text
从左边看这个 disparity 是否合理
+
从右边看是否合理
+
从上面看是否合理
+
从下面看是否合理
+
从斜方向看是否合理
...
```

聚合以后：

\[
S(p,d)
\]

是更稳定的综合代价。

最后：

\[
\boxed{
D(p)=\arg\min_d S(p,d)
}
\]

得到最终 disparity。

完整流程：

```text
Initial Cost Volume
C(x,y,d)
       │
       ├────→ Path 1 DP
       ├────→ Path 2 DP
       ├────→ Path 3 DP
       ├────→ Path 4 DP
       ├────→ ...
       │
       ↓
Path Costs
Lr(x,y,d)
       │
       ↓
Sum / Aggregate
       │
       ↓
S(x,y,d)
       │
       ↓
argmin over d
       │
       ↓
Disparity Map
```

---

## 27. SGM 与 OpenCV StereoSGBM 的关系

OpenCV 中常用的是：

```cpp
cv::StereoSGBM
```

这里叫：

```text
SGBM
=
Semi-Global Block Matching
```

可以把它理解成：

```text
局部块 / 像素匹配代价
+
Semi-Global 路径代价聚合
```

它不是最简单的：

```text
Block Matching + WTA
```

而是在局部匹配基础上加入了：

```text
多方向平滑约束
动态规划
P1/P2
```

所以通常比：

```cpp
StereoBM
```

得到的 disparity 更连续、更稳定。

---

## 28. StereoBM 与 StereoSGBM 参数怎么理解

---

### 28.1 minDisparity

表示：

```text
开始搜索的最小 disparity
```

典型水平双目：

```cpp
minDisparity = 0;
```

但根据校正和相机布局，也可能不是 0。

---

### 28.2 numDisparities

表示：

```text
搜索多少个 disparity 候选
```

例如：

```cpp
numDisparities = 128;
```

大致表示：

```text
0 ~ 127 pixel
```

需要结合 OpenCV API 的要求设置，工程上经常取：

```text
16 的倍数
```

例如：

```text
64
96
128
160
...
```

---

### 28.3 blockSize

表示局部匹配窗口尺寸。

例如：

```cpp
blockSize = 5;
```

概念上类似：

```text
5 × 5
```

窗口。

窗口大：

```text
更稳定
纹理弱区域可能更好
```

但：

```text
细节被抹平
物体边界变差
```

窗口小：

```text
边缘细节较好
```

但：

```text
容易受噪声影响
```

---

### 28.4 P1

小 disparity 变化惩罚。

例如：

```text
20 → 21
```

---

### 28.5 P2

大 disparity 变化惩罚。

例如：

```text
20 → 35
```

一般：

\[
P_2>P_1
\]

OpenCV 工程里常见经验形式：

```cpp
P1 = 8  * channels * blockSize * blockSize;
P2 = 32 * channels * blockSize * blockSize;
```

这只是常见经验初始化，不意味着所有场景都应该固定使用这组值。

---

### 28.6 uniquenessRatio

用于判断：

> 最佳匹配是不是明显优于其他候选。

如果：

```text
best cost
```

和：

```text
second best cost
```

差得太少，说明：

```text
匹配存在歧义
```

这种点可以被判为不可靠。

---

### 28.7 speckleWindowSize

用于过滤：

```text
很小的孤立 disparity 区域
```

---

### 28.8 speckleRange

用于判断小连通区域内：

```text
允许多大的 disparity 波动
```

---

### 28.9 disp12MaxDiff

用于左右一致性相关检查的阈值。

---

## 29. OpenCV 视差乘 16 是什么意思

这是非常常见的坑。

OpenCV StereoSGBM / StereoBM 的输出常使用：

```text
fixed-point disparity
```

即：

```text
实际 disparity × 16
```

保存为整数。

例如输出：

```text
640
```

不代表：

```text
640 pixel
```

真正 disparity：

\[
d=\frac{640}{16}=40
\]

所以：

```cpp
cv::Mat disparity16S;
sgbm->compute(leftRect, rightRect, disparity16S);

cv::Mat disparity32F;
disparity16S.convertTo(
    disparity32F,
    CV_32F,
    1.0 / 16.0
);
```

之后：

```text
disparity32F
```

才适合直接用于：

\[
Z=\frac{fB}{d}
\]

---

## 30. 亚像素视差为什么重要

如果 disparity 只能取整数：

```text
20
21
22
```

深度量化会比较粗。

真实最优位置可能是：

```text
20.375 pixel
```

因为图像中的对应关系并不要求刚好落在整数像素中心。

亚像素视差可以利用最优 cost 附近的曲线形状进一步拟合。

例如：

```text
d=19  cost=20
d=20  cost=10
d=21  cost=12
```

虽然整数最优是：

```text
20
```

但通过二次拟合，最小点可能落在：

```text
20.3
```

于是深度：

\[
Z=\frac{fB}{20.3}
\]

通常比：

\[
Z=\frac{fB}{20}
\]

更加准确。

---

## 31. 左右一致性检查是什么

可以进行两次 Stereo Matching。

第一次：

```text
Left → Right
```

得到：

\[
d_L(x,y)
\]

第二次：

```text
Right → Left
```

得到：

\[
d_R(x,y)
\]

假设左图：

```text
xL = 300
dL = 40
```

那么预测右图对应位置：

\[
x_R=300-40=260
\]

然后从右图的：

```text
xR = 260
```

再反向检查是否能够回到：

```text
xL ≈ 300
```

如果：

```text
Left says:
300 → 260

Right says:
260 → 299
```

基本一致。

如果：

```text
Left says:
300 → 260

Right says:
260 → 280
```

明显矛盾。

这种 disparity 应该标记为：

```text
Invalid
```

左右一致性检查对于：

```text
遮挡区域
错误匹配
重复纹理
```

很重要。

---

## 32. Speckle、孔洞和错误视差怎么处理

初始 disparity map 常常不是干净的。

可能出现：

```text
随机小斑点
孤立错误值
物体边缘孔洞
大片 invalid 区域
```

常用处理包括：

---

### 32.1 Speckle Filtering

去掉很小的孤立连通区域。

例如：

```text
背景 disparity = 20

突然出现：
55
56
54

只占几个像素
```

很可能是假匹配。

---

### 32.2 Median Filter

中值滤波可以去掉一定程度的：

```text
椒盐型错误 disparity
```

但不要过度使用，否则物体边界会被抹平。

---

### 32.3 Edge-Aware Filter

希望：

```text
同一个物体内部平滑
```

同时：

```text
不要跨越物体边缘乱平滑
```

可以使用边缘保持滤波思想。

---

### 32.4 Invalid Mask

不要把：

```text
d <= 0
```

强行转换成深度。

应该建立：

```text
valid mask
```

例如：

```cpp
if (d > 0.0f) {
    Z = fx * B / d;
} else {
    Z = invalid;
}
```

---

## 33. 从视差图计算深度图

一旦得到：

\[
d(x,y)
\]

深度：

\[
\boxed{
Z(x,y)
=
\frac{f_xB}{d(x,y)}
}
\]

其中：

```text
fx
=
校正后左相机水平焦距，单位 pixel

B
=
baseline

d
=
disparity，单位 pixel
```

如果：

```text
B 使用 meter
```

那么：

```text
Z 输出 meter
```

如果：

```text
B 使用 millimeter
```

那么：

```text
Z 输出 millimeter
```

---

### 33.1 数值例子

假设：

```text
fx = 800 pixel
B  = 0.10 m
d  = 40 pixel
```

则：

\[
Z
=
\frac{800\times0.10}{40}
\]

得到：

\[
Z=2m
\]

如果：

```text
d = 20
```

则：

\[
Z=4m
\]

如果：

```text
d = 10
```

则：

\[
Z=8m
\]

所以：

```text
disparity 大
→ 近

disparity 小
→ 远
```

---

## 34. 深度误差为什么会随距离迅速增大

由：

\[
Z=\frac{fB}{d}
\]

对 disparity 求导：

\[
\frac{\partial Z}{\partial d}
=
-\frac{fB}{d^2}
\]

利用：

\[
d=\frac{fB}{Z}
\]

可以近似得到深度误差：

\[
\boxed{
\sigma_Z
\approx
\frac{Z^2}{fB}\sigma_d
}
\]

非常关键：

\[
\sigma_Z\propto Z^2
\]

也就是：

> 距离增加以后，深度误差大致按平方增长。

因此同一套双目系统：

```text
1 m
```

可能非常准。

但：

```text
20 m
```

的误差会明显放大。

提高远距离深度能力可以考虑：

```text
增大焦距 f
增大基线 B
提高 disparity 亚像素精度
提高图像分辨率与匹配质量
```

---

## 35. 从 Depth Map 反投影得到三维点

Depth Map 只给出：

```text
Z
```

如果希望得到：

```text
(X,Y,Z)
```

需要结合相机内参。

针孔模型：

\[
u=f_x\frac{X}{Z}+c_x
\]

\[
v=f_y\frac{Y}{Z}+c_y
\]

反解：

\[
\boxed{
X=(u-c_x)\frac{Z}{f_x}
}
\]

\[
\boxed{
Y=(v-c_y)\frac{Z}{f_y}
}
\]

\[
\boxed{
Z=Z
}
\]

所以每个有效像素：

```text
(u,v)
+
Depth Z
```

可以得到：

```text
(X,Y,Z)
```

这就是：

```text
Camera Coordinate 3D Point
```

整张图的有效像素全部反投影：

```text
P1 = (X1,Y1,Z1)
P2 = (X2,Y2,Z2)
P3 = (X3,Y3,Z3)
...
```

就形成：

```text
Point Cloud
```

---

## 36. Q 矩阵与 reprojectImageTo3D

OpenCV：

```cpp
cv::stereoRectify(...)
```

会输出：

```text
R1
R2
P1
P2
Q
```

其中：

```text
Q
```

是：

```text
Disparity-to-Depth Mapping Matrix
```

它把：

```text
(x,y,d,1)
```

映射到齐次三维坐标。

形式上：

\[
\begin{bmatrix}
X'\\
Y'\\
Z'\\
W'
\end{bmatrix}
=
Q
\begin{bmatrix}
x\\
y\\
d\\
1
\end{bmatrix}
\]

最终：

\[
X=\frac{X'}{W'}
\]

\[
Y=\frac{Y'}{W'}
\]

\[
Z=\frac{Z'}{W'}
\]

OpenCV 可以直接：

```cpp
cv::reprojectImageTo3D(
    disparity32F,
    points3D,
    Q
);
```

输出：

```text
points3D
```

类型类似：

```text
CV_32FC3
```

也就是每个像素位置存：

```text
(X,Y,Z)
```

---

## 37. 点云为什么还需要颜色

只有：

```text
(X,Y,Z)
```

会得到纯几何点云。

为了更直观，通常使用左图颜色：

```text
Left Rectified Image
```

为点云着色。

像素：

```text
(u,v)
```

对应：

```text
3D:
(X,Y,Z)

Color:
BGR / RGB from left image
```

最终保存：

```text
X Y Z R G B
```

形成彩色点云。

因为三维点是以左相机坐标系反投影得到的，所以使用左图颜色最自然。

---

## 38. 完整 OpenCV C++ 工程流程

下面给出一套比较完整的结构。

---

### 38.1 已知标定参数

```cpp
cv::Mat K1, D1;
cv::Mat K2, D2;
cv::Mat R, T;
```

---

### 38.2 Stereo Rectification

```cpp
cv::Mat R1, R2;
cv::Mat P1, P2;
cv::Mat Q;

cv::stereoRectify(
    K1,
    D1,
    K2,
    D2,
    imageSize,
    R,
    T,
    R1,
    R2,
    P1,
    P2,
    Q,
    cv::CALIB_ZERO_DISPARITY,
    0,
    imageSize
);
```

---

### 38.3 构造 Remap

```cpp
cv::Mat map1x, map1y;
cv::Mat map2x, map2y;

cv::initUndistortRectifyMap(
    K1,
    D1,
    R1,
    P1,
    imageSize,
    CV_32FC1,
    map1x,
    map1y
);

cv::initUndistortRectifyMap(
    K2,
    D2,
    R2,
    P2,
    imageSize,
    CV_32FC1,
    map2x,
    map2y
);
```

---

### 38.4 校正左右图

```cpp
cv::Mat leftRect, rightRect;

cv::remap(
    leftRaw,
    leftRect,
    map1x,
    map1y,
    cv::INTER_LINEAR
);

cv::remap(
    rightRaw,
    rightRect,
    map2x,
    map2y,
    cv::INTER_LINEAR
);
```

---

### 38.5 创建 StereoSGBM

```cpp
int minDisparity = 0;
int numDisparities = 128;
int blockSize = 5;

int channels = 1;

int P1_sgm =
    8 * channels * blockSize * blockSize;

int P2_sgm =
    32 * channels * blockSize * blockSize;

auto sgbm = cv::StereoSGBM::create(
    minDisparity,
    numDisparities,
    blockSize
);

sgbm->setP1(P1_sgm);
sgbm->setP2(P2_sgm);

sgbm->setUniquenessRatio(10);
sgbm->setSpeckleWindowSize(100);
sgbm->setSpeckleRange(2);
sgbm->setDisp12MaxDiff(1);
```

---

### 38.6 计算视差

```cpp
cv::Mat leftGray;
cv::Mat rightGray;

cv::cvtColor(
    leftRect,
    leftGray,
    cv::COLOR_BGR2GRAY
);

cv::cvtColor(
    rightRect,
    rightGray,
    cv::COLOR_BGR2GRAY
);

cv::Mat disparity16S;

sgbm->compute(
    leftGray,
    rightGray,
    disparity16S
);
```

---

### 38.7 转换真实 disparity

```cpp
cv::Mat disparity32F;

disparity16S.convertTo(
    disparity32F,
    CV_32F,
    1.0 / 16.0
);
```

---

### 38.8 手动得到 Depth Map

如果已知校正后的：

```text
fx
```

以及：

```text
baseline B
```

可以：

```cpp
cv::Mat depth(
    disparity32F.size(),
    CV_32F,
    cv::Scalar(0)
);

double fx = P1.at<double>(0, 0);

// 如果 T 使用 meter，则 B 是 meter。
// 注意：根据坐标定义和 stereoRectify 结果，
// 工程里通常取 baseline 的正长度。
double B = cv::norm(T);

for (int y = 0; y < disparity32F.rows; ++y)
{
    for (int x = 0; x < disparity32F.cols; ++x)
    {
        float d =
            disparity32F.at<float>(y, x);

        if (d > 0.0f)
        {
            depth.at<float>(y, x)
                =
                static_cast<float>(
                    fx * B / d
                );
        }
    }
}
```

---

### 38.9 使用 Q 直接得到三维坐标

```cpp
cv::Mat points3D;

cv::reprojectImageTo3D(
    disparity32F,
    points3D,
    Q
);
```

访问某个三维点：

```cpp
cv::Vec3f p =
    points3D.at<cv::Vec3f>(y, x);

float X = p[0];
float Y = p[1];
float Z = p[2];
```

---

### 38.10 过滤非法点

```cpp
if (!std::isfinite(Z))
    continue;

if (Z <= 0.0f)
    continue;

if (Z > maxDepth)
    continue;
```

同时也可以检查：

```cpp
if (disparity32F.at<float>(y, x) <= 0)
    continue;
```

---

## 39. 从零实现简化版 BM

下面是不依赖 `StereoBM` 的最简化 BM 思路。

它主要用于理解，不建议直接用于高质量工程部署。

```cpp
cv::Mat computeBM(
    const cv::Mat& left,
    const cv::Mat& right,
    int maxDisparity,
    int blockRadius)
{
    CV_Assert(left.type() == CV_8UC1);
    CV_Assert(right.type() == CV_8UC1);

    cv::Mat disparity(
        left.size(),
        CV_32F,
        cv::Scalar(0)
    );

    for (int y = blockRadius;
         y < left.rows - blockRadius;
         ++y)
    {
        for (int x = blockRadius + maxDisparity;
             x < left.cols - blockRadius;
             ++x)
        {
            int bestCost =
                std::numeric_limits<int>::max();

            int bestDisp = 0;

            for (int d = 0;
                 d < maxDisparity;
                 ++d)
            {
                int xr = x - d;

                if (xr - blockRadius < 0)
                    continue;

                int cost = 0;

                for (int dy = -blockRadius;
                     dy <= blockRadius;
                     ++dy)
                {
                    for (int dx = -blockRadius;
                         dx <= blockRadius;
                         ++dx)
                    {
                        int L =
                            left.at<uchar>(
                                y + dy,
                                x + dx
                            );

                        int R =
                            right.at<uchar>(
                                y + dy,
                                xr + dx
                            );

                        cost += std::abs(L - R);
                    }
                }

                if (cost < bestCost)
                {
                    bestCost = cost;
                    bestDisp = d;
                }
            }

            disparity.at<float>(y, x)
                =
                static_cast<float>(bestDisp);
        }
    }

    return disparity;
}
```

这段代码的核心就是：

```text
for each pixel (x,y):

    for each disparity d:

        right_x = x - d

        compare:
        left patch
        right patch

        get cost

    choose d with minimum cost
```

也就是：

\[
d(x,y)=\arg\min_d C(x,y,d)
\]

---

## 40. 从零理解简化版 SGM 伪代码

SGM 比 BM 多了：

```text
Cost Aggregation
```

一个简化理解版本：

```text
1. 构造 Cost Volume

for y
    for x
        for d
            C[y][x][d]
            =
            matching_cost(
                Left(x,y),
                Right(x-d,y)
            )
```

然后对每个路径方向：

```text
r ∈ {
    left→right,
    right→left,
    top→bottom,
    bottom→top,
    ...
}
```

动态规划：

```text
for pixel p along direction r:

    for disparity d:

        same =
            L(prev, d)

        minus1 =
            L(prev, d-1) + P1

        plus1 =
            L(prev, d+1) + P1

        jump =
            min_k L(prev,k) + P2

        L(p,d)
            =
            C(p,d)
            +
            min(
                same,
                minus1,
                plus1,
                jump
            )
            -
            min_k L(prev,k)
```

所有方向聚合：

```text
S(p,d)
=
sum_r Lr(p,d)
```

最终：

```text
D(p)
=
argmin_d S(p,d)
```

所以 SGM 可以记成：

```text
BM:
C
↓
argmin
↓
D

SGM:
C
↓
多方向 DP
↓
S
↓
argmin
↓
D
```

---

## 41. 完整数据结构和尺寸变化

假设：

```text
Input Image:
640 × 480
```

搜索：

```text
D = 128
```

那么整个过程可以写成：

```text
Left Image:
[480,640]

Right Image:
[480,640]
```

构造 Cost Volume：

```text
C:
[480,640,128]
```

其中：

```text
C[y,x,d]
```

表示：

```text
Left(x,y)
↔
Right(x-d,y)
```

的匹配代价。

SGM 路径聚合后：

```text
S:
[480,640,128]
```

然后：

```text
argmin over disparity dimension
```

得到：

```text
Disparity:
[480,640]
```

然后：

```text
Z = fx * B / d
```

得到：

```text
Depth:
[480,640]
```

再反投影：

```text
Points3D:
[480,640,3]
```

其中最后一维：

```text
3
=
X
Y
Z
```

所以完整尺寸变化：

```text
Left / Right
[H,W]
    ↓

Cost Volume
[H,W,D]
    ↓

Aggregated Cost
[H,W,D]
    ↓

argmin over D
    ↓

Disparity
[H,W]
    ↓

fB / d
    ↓

Depth
[H,W]
    ↓

Back Projection
    ↓

Point Cloud Map
[H,W,3]
```

---

## 42. BM 与 SGM 对比

| 项目 | BM | SGM / SGBM |
|---|---|---|
| 输入 | 校正后的左右图 | 校正后的左右图 |
| 是否搜索 disparity | 是 | 是 |
| 是否构造匹配代价 | 是 | 是 |
| 是否可以理解为 Cost Volume | 可以 | 可以 |
| 是否考虑邻居 disparity | 很弱 / 基本没有显式全局约束 | 是 |
| 是否使用 P1 / P2 | 否 | 是 |
| 是否多方向动态规划 | 否 | 是 |
| 局部错误是否容易扩散 | 较容易 | 通常更稳定 |
| 纹理弱区域 | 较差 | 通常比 BM 好 |
| 边缘效果 | 依赖 block size | 通常更好 |
| 速度 | 通常更快 | 通常更慢 |
| 工程效果 | 基础 | 常用 |
| 核心公式 | `argmin C` | `argmin ΣLr` |

最值得记住：

```text
BM
=
局部匹配后
每个像素基本独立选最优 disparity
```

而：

```text
SGM
=
局部匹配
+
邻域平滑约束
+
多方向动态规划
```

---

## 43. 常见混淆点

---

### 43.1 BM / SGM 直接输出的是深度吗

不是。

更准确：

```text
BM / SGM
↓
Disparity
↓
Geometry
↓
Depth
```

---

### 43.2 相机已经标定好了，为什么还需要 Stereo Matching

因为标定只告诉你：

```text
两台相机之间的几何关系
```

没有告诉你：

```text
左图这个像素
具体对应右图哪个像素
```

---

### 43.3 “同一个像素”是什么意思

严格地说，不应该说：

```text
同一个像素
```

更加准确是：

> **同一个三维空间点在左右两幅图像中的两个投影像素。**

因为：

```text
Left Pixel
```

和：

```text
Right Pixel
```

本身是两个不同图像中的像素位置。

---

### 43.4 Stereo Rectification 会直接产生 disparity 吗

不会。

Rectification 只是让：

\[
y_L\approx y_R
\]

从而把对应点搜索简化成水平方向。

---

### 43.5 disparity 越大是不是越远

不是。

恰好相反：

\[
Z=\frac{fB}{d}
\]

所以：

```text
d 越大
→ 越近

d 越小
→ 越远
```

---

### 43.6 d=0 怎么办

理论上：

\[
Z=\frac{fB}{0}
\]

发散。

工程上：

```text
d <= 0
```

一般作为：

```text
Invalid disparity
```

而不是计算深度。

---

### 43.7 Cost 最小一定是真实对应点吗

不一定。

在：

```text
重复纹理
无纹理
遮挡
反光
```

情况下，最低 cost 也可能是假匹配。

所以需要：

```text
SGM smoothness
uniqueness check
left-right consistency
speckle filtering
```

等机制提高可靠性。

---

### 43.8 SGM 是不是简单对 disparity 做平滑滤波

不是。

SGM 不是先得到 disparity，再做普通 blur。

它是在：

```text
选择 disparity 之前
```

就把：

```text
matching cost
+
spatial smoothness
```

一起考虑。

这是本质区别。

---

### 43.9 P1/P2 越大越好吗

不是。

如果太大：

```text
不同物体之间真正的深度边缘
也会被强行抹平
```

所以需要平衡：

```text
平滑
vs
保留深度边缘
```

---

### 43.10 blockSize 越大越好吗

不是。

大窗口：

```text
稳定
```

但：

```text
边界模糊
小物体消失
前景背景容易混合
```

小窗口：

```text
细节好
```

但：

```text
更容易受噪声影响
```

---

### 43.11 Q 和 Z=fB/d 是两种不同原理吗

不是。

它们来自同一个双目几何。

```text
Z=fB/d
```

是最直观的深度公式。

```text
Q
```

则把：

```text
x
y
d
```

一起转换成：

```text
X
Y
Z
```

更加方便。

---

### 43.12 Depth Map 和 Point Cloud 是一个东西吗

不是。

Depth Map：

```text
[H,W]
```

每个像素：

```text
Z
```

Point Cloud：

```text
N × 3
```

每个点：

```text
X,Y,Z
```

Depth Map 可以反投影得到 Point Cloud。

---

### 43.13 视差图显示得很漂亮就一定深度准确吗

不一定。

可视化常常把 disparity：

```text
归一化到 0~255
```

只是为了看起来方便。

真正计算深度必须使用：

```text
原始物理 disparity
```

而不能使用归一化后的彩色图或 8-bit 显示图。

---

## 44. 推荐的术语体系

为了以后讨论时避免歧义，建议使用下面的术语。

| 概念 | 推荐术语 | 含义 |
|---|---|---|
| `(xL,yL)` | 左图像素 / left image point | 三维点在左图投影 |
| `(xR,yR)` | 右图对应像素 / correspondence | 同一三维点在右图投影 |
| `d=xL-xR` | 视差 / disparity | 左右水平坐标差 |
| `C(x,y,d)` | 匹配代价 / matching cost | disparity 候选的相似度代价 |
| `[H,W,D]` | Cost Volume | 所有像素和所有 disparity 的匹配代价 |
| `argmin C` | Winner-Takes-All | 选择最小代价 disparity |
| `P1` | 小跳变惩罚 | 相邻 disparity 差 1 |
| `P2` | 大跳变惩罚 | 相邻 disparity 差较大 |
| `Lr(p,d)` | Path Cost | SGM 某方向累计代价 |
| `S(p,d)` | Aggregated Cost | 多方向路径代价总和 |
| `Z=fB/d` | 深度计算 | disparity 转 Z |
| `Depth Map` | 深度图 | 每个像素一个 Z |
| `Point Cloud` | 点云 | 一组 `(X,Y,Z)` |

推荐以后不要把：

```text
“找到同一个像素”
```

作为最终严谨表述。

更准确：

> **找到同一个三维空间点在左右图像中的对应投影位置。**

---

## 45. 完整知识地图

```text
                         Stereo Vision
                              │
                ┌─────────────┴─────────────┐
                │                           │
          Camera Geometry              Stereo Matching
                │                           │
        K1,D1,K2,D2,R,T                      │
                │                           │
                ↓                           ↓
        Stereo Rectification         Correspondence Search
                │                           │
                ↓                           ↓
        Horizontal Epipolar        Matching Cost C(x,y,d)
              Lines                         │
                │                           ↓
                │                     Cost Volume
                │                       [H,W,D]
                │                           │
                │              ┌────────────┴────────────┐
                │              │                         │
                │             BM                        SGM
                │              │                         │
                │        Local Matching            Path DP
                │              │               P1 / P2 Smoothness
                │              │                         │
                │         argmin C                Σ Path Cost
                │              │                         │
                │              └────────────┬────────────┘
                │                           ↓
                │                    Disparity Map
                │                        d(x,y)
                │                           │
                └──────────────┬────────────┘
                               ↓
                           Z = fB / d
                               │
                               ↓
                           Depth Map
                               │
                               ↓
                       Back Projection
                               │
                               ↓
                           X,Y,Z
                               │
                               ↓
                         Point Cloud
```

---

## 46. 推荐学习路线

---

### 第一阶段：完全理解双目几何

必须能够回答：

```text
为什么 Z = fB/d？
什么是 baseline？
为什么 disparity 越大越近？
```

---

### 第二阶段：理解 Rectification

必须能够回答：

```text
为什么原始左右图不能只沿同一行搜索？
什么是 epipolar line？
Rectification 为什么把问题变成 1D？
```

---

### 第三阶段：自己写最简单 BM

不要直接调用：

```cpp
StereoBM
```

先自己实现：

```text
for pixel
    for disparity
        compare patch
    choose minimum cost
```

如果这一步真正写出来，就已经掌握 Stereo Matching 最核心的骨架。

---

### 第四阶段：理解 Cost Volume

必须能够解释：

```text
C ∈ R^(H×W×D)
```

三个维度分别是什么。

还要能够解释：

```text
C[y,x,d]
```

具体表示什么。

---

### 第五阶段：理解 SGM 的四项递推

重点掌握：

```text
same disparity
d-1 + P1
d+1 + P1
other disparity + P2
```

不用一开始背全部公式。

先理解：

> **SGM 在比较图像相似度的同时，也在奖励空间上连续的 disparity。**

---

### 第六阶段：掌握后处理

包括：

```text
Sub-pixel
Uniqueness
Left-Right Check
Speckle Filtering
Invalid Mask
```

---

### 第七阶段：Depth 与 3D

能够自己写：

\[
Z=\frac{fB}{d}
\]

以及：

\[
X=(u-c_x)\frac{Z}{f_x}
\]

\[
Y=(v-c_y)\frac{Z}{f_y}
\]

然后输出：

```text
PLY / PCD
```

点云。

---

## 47. 最后总结

双目深度最本质的问题可以压缩成：

> **给左图中的每个像素，在右图同一极线上找到同一个三维空间点的投影位置。**

经过 Stereo Rectification 后：

\[
y_L\approx y_R
\]

因此对应搜索简化成：

\[
x_R=x_L-d
\]

对于每个左图像素：

```text
(x,y)
```

枚举：

```text
d = 0,1,2,...,D-1
```

并计算：

\[
C(x,y,d)
\]

形成：

\[
C\in\mathbb{R}^{H\times W\times D}
\]

也就是：

```text
Cost Volume
```

BM 做的是：

\[
\boxed{
D(p)=\arg\min_dC(p,d)
}
\]

也就是：

```text
哪个 disparity 的局部匹配代价最小
就选哪个
```

SGM 则进一步加入：

```text
邻域 disparity 连续性
```

沿多个方向进行动态规划：

\[
L_r(p,d)
\]

然后：

\[
S(p,d)=\sum_rL_r(p,d)
\]

最终：

\[
\boxed{
D(p)=\arg\min_dS(p,d)
}
\]

得到：

```text
Disparity Map
```

随后：

\[
\boxed{
Z(x,y)=\frac{f_xB}{d(x,y)}
}
\]

得到：

```text
Depth Map
```

最后通过：

\[
X=(u-c_x)\frac{Z}{f_x}
\]

\[
Y=(v-c_y)\frac{Z}{f_y}
\]

得到：

```text
(X,Y,Z)
```

形成：

```text
3D Point Cloud
```

所以从输入到最终输出的主线可以压缩成：

```text
Left / Right Images
        ↓
Stereo Rectification
        ↓
Horizontal Correspondence Search
        ↓
Matching Cost C(x,y,d)
        ↓
Cost Volume [H,W,D]
        ↓
BM / SGM / SGBM
        ↓
Disparity Map d(x,y)
        ↓
Z = fB / d
        ↓
Depth Map
        ↓
Back Projection
        ↓
(X,Y,Z)
        ↓
Point Cloud
```

真正最需要掌握的是：

```text
Stereo Matching
```

因为：

```text
标定参数
→ 已知

Z = fB / d
→ 公式简单

真正困难的未知量
→ disparity d
```

而 disparity 的来源就是：

> **找到同一个三维空间点在左右图像中的对应投影。**

---

## 48. 一句话速记

```text
双目标定：
告诉你两台相机之间怎么摆。

Stereo Rectification：
把对应点搜索限制到同一水平行。

Matching Cost：
衡量某个 disparity 候选到底像不像。

Cost Volume：
保存每个像素对所有 disparity 候选的匹配代价。

BM：
每个像素局部搜索，直接选择最小 cost 的 disparity。

SGM：
在 Matching Cost 基础上加入邻域平滑约束，
沿多个方向动态规划后再选择 disparity。

Disparity：
左右对应投影的水平坐标差。

Depth：
Z = fB / d。

3D Reconstruction：
利用 Depth + Camera Intrinsics
把每个像素反投影成 (X,Y,Z)。
```

---

## 最核心的四条公式

对应关系：

\[
\boxed{
p_L=(x,y)
\quad\leftrightarrow\quad
p_R=(x-d,y)
}
\]

BM：

\[
\boxed{
D(p)=\arg\min_d C(p,d)
}
\]

SGM：

\[
\boxed{
D(p)
=
\arg\min_d
\sum_rL_r(p,d)
}
\]

深度：

\[
\boxed{
Z=\frac{fB}{d}
}
\]

如果这四条公式背后的含义都真正理解了，那么从传统双目匹配到深度图、三维点云的主线就已经完整打通。

