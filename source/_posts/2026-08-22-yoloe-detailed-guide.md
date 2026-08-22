---
title: YOLOE 超详细说明文档：从普通 YOLO 到开放词汇检测、文本提示、视觉提示与 Prompt-Free
date: 2026-08-22 09:00:00
permalink: /2026/08/22/yoloe-detailed-guide/
tags: [YOLO, YOLOE, 目标检测, 开放词汇检测, 实例分割, Text Prompt, Visual Prompt, Prompt-Free, 视觉原理系列]
categories: [原理说明类]
mathjax: true
---


> 本文档基于用户提供的《[YOLO 系列模型与 YOLO26 核心模块超详细说明文档](/2026/08/12/yolo-series-and-yolo26/)》的知识体系继续扩展。  
> 目标是保持原文档的讲解风格：**先讲整体数据流，再讲张量形状，再讲模块内部逻辑，最后讲训练、推理、使用方法和常见混淆点。**
>
> 本文重点回答：
>
> - YOLOE 到底是什么？
> - YOLOE 和普通 YOLO、YOLO26 是什么关系？
> - 普通 YOLO 的分类 Head 到底在做什么？
> - `P3=[B,C,80,80]`、`80×80=6400` 到底是什么意思？
> - “6400 个预测位置”怎样描述才不容易产生歧义？
> - YOLOE 的 Object Embedding 到底是什么？
> - Object Embedding 和 Prompt Embedding 如何得到最终类别？
> - RepRTA、SAVPE、LRPC 分别解决什么问题？
> - YOLOE 的 Text Prompt、Visual Prompt、Prompt-Free 三种模式分别怎么工作？
> - YOLOE 如何训练、推理、迁移和部署？
> - YOLOE-26 与原始 YOLOE 论文是什么关系？

<!-- more -->
---

## 目录

1. [阅读这篇文档前需要掌握什么](#1-阅读这篇文档前需要掌握什么)
2. [YOLOE 是什么](#2-YOLOE-是什么)
3. [为什么普通 YOLO 需要扩展成 YOLOE](#3-为什么普通-YOLO-需要扩展成-YOLOE)
4. [Closed-Set、Open-Vocabulary 与 Promptable Detection](#4-Closed-Set、Open-Vocabulary-与-Promptable-Detection)
5. [YOLOE 与普通 YOLO、YOLOv8、YOLO11、YOLO26 的关系](#5-YOLOE-与普通-YOLO、YOLOv8、YOLO11、YOLO26-的关系)
6. [先重新理解 P3/P4/P5 与特征图空间位置](#6-先重新理解-P3-P4-P5-与特征图空间位置)
7. [为什么不建议说“6400 个预测位置”](#7-为什么不建议说“6400-个预测位置”)
8. [普通 YOLO 分类 Head 到底做了什么](#8-普通-YOLO-分类-Head-到底做了什么)
9. [`[B,80,80,80]` 到底是什么意思](#9-B-80-80-80-到底是什么意思)
10. [YOLO 的定位和分类不是严格的“先后两步”](#10-YOLO-的定位和分类不是严格的“先后两步”)
11. [YOLOE 最核心的变化：Object Embedding Head](#11-YOLOE-最核心的变化：Object-Embedding-Head)
12. [Object Embedding 到底是什么](#12-Object-Embedding-到底是什么)
13. [Prompt Embedding 到底是什么](#13-Prompt-Embedding-到底是什么)
14. [Object Embedding 与 Prompt Embedding 如何得到类别](#14-Object-Embedding-与-Prompt-Embedding-如何得到类别)
15. [普通 YOLO 与 YOLOE 的分类方式对比](#15-普通-YOLO-与-YOLOE-的分类方式对比)
16. [YOLOE 总体网络结构](#16-YOLOE-总体网络结构)
17. [Text Prompt：RepRTA 详解](#17-Text-Prompt：RepRTA-详解)
18. [为什么 RepRTA 可以 Re-parameterize](#18-为什么-RepRTA-可以-Re-parameterize)
19. [Visual Prompt：SAVPE 详解](#19-Visual-Prompt：SAVPE-详解)
20. [SAVPE 的 Semantic Branch](#20-SAVPE-的-Semantic-Branch)
21. [SAVPE 的 Activation Branch](#21-SAVPE-的-Activation-Branch)
22. [SAVPE 如何得到 Visual Prompt Embedding](#22-SAVPE-如何得到-Visual-Prompt-Embedding)
23. [Prompt-Free：LRPC 详解](#23-Prompt-Free：LRPC-详解)
24. [为什么 LRPC 要做“Lazy”匹配](#24-为什么-LRPC-要做“Lazy”匹配)
25. [YOLOE 的实例分割机制](#25-YOLOE-的实例分割机制)
26. [YOLOE 的训练目标](#26-YOLOE-的训练目标)
27. [YOLOE 原始论文的训练阶段](#27-YOLOE-原始论文的训练阶段)
28. [YOLOE 三种推理模式完整流程](#28-YOLOE-三种推理模式完整流程)
29. [YOLOE 与 YOLO26 端到端检测怎样结合理解](#29-YOLOE-与-YOLO26-端到端检测怎样结合理解)
30. [YOLOE 实际使用：Text Prompt](#30-YOLOE-实际使用：Text-Prompt)
31. [YOLOE 实际使用：Visual Prompt](#31-YOLOE-实际使用：Visual-Prompt)
32. [YOLOE 实际使用：Prompt-Free](#32-YOLOE-实际使用：Prompt-Free)
33. [YOLOE 微调与自定义数据集](#33-YOLOE-微调与自定义数据集)
34. [YOLOE 导出和部署为什么很特殊](#34-YOLOE-导出和部署为什么很特殊)
35. [YOLOE 与“YOLO + CLIP 暴力组合”的区别](#35-YOLOE-与“YOLO-CLIP-暴力组合”的区别)
36. [YOLOE 与 YOLO-World 的关系](#36-YOLOE-与-YOLO-World-的关系)
37. [常见混淆点](#37-常见混淆点)
38. [推荐的术语体系](#38-推荐的术语体系)
39. [完整知识地图](#39-完整知识地图)
40. [学习路线建议](#40-学习路线建议)
41. [最后总结](#41-最后总结)
42. [参考资料](#42-参考资料)

---

## 1. 阅读这篇文档前需要掌握什么

理解 YOLOE 之前，最好已经掌握普通现代 YOLO 的基本框架：

```text
Input
  ↓
Backbone
  ↓
Neck / PAN-FPN
  ↓
P3 / P4 / P5
  ↓
Detection Head
  ↓
Box + Class
```

至少需要理解：

```text
[B, C, H, W]
stride
P3 / P4 / P5
Anchor-free
Decoupled Head
Dense Prediction
Box Regression
Classification
NMS / End-to-End
```

这篇文档不会把普通 YOLO 的全部基础重新讲一遍，而是重点解释：

```text
普通 YOLO
        ↓
为什么类别空间是固定的
        ↓
YOLOE 如何把“固定分类器”
变成“Prompt 驱动的开放分类器”
```

---

## 2. YOLOE 是什么

YOLOE 的论文题目是：

```text
YOLOE: Real-Time Seeing Anything
```

它是一套建立在 YOLO 检测框架上的：

```text
Open-Vocabulary Detection
+
Open-Vocabulary Instance Segmentation
+
Promptable Detection / Segmentation
```

方法。

最核心的目标是：

> **保留 YOLO 的高效、实时检测能力，同时让模型不再只能识别训练时预先固定的类别。**

普通 YOLO 的典型问题是：

```text
训练类别：

person
car
dog
cat

训练结束
   ↓

推理阶段主要仍然只能在：

person
car
dog
cat

这些固定类别中进行判断。
```

而 YOLOE 希望：

```text
今天：
["person", "dog"]

明天：
["helmet", "forklift"]

后天：
["red cup", "excavator"]

模型本体不重新训练，
仅改变 Prompt，
类别空间就可以随之改变。
```

因此 YOLOE 的核心不是：

```text
“把 YOLO Backbone 全部推倒重做”
```

而是：

```text
YOLO 高效视觉特征
+
开放语义表示
+
Prompt Encoder
+
视觉-语言对齐
```

---

## 3. 为什么普通 YOLO 需要扩展成 YOLOE

普通 YOLO 的优点非常明显：

```text
速度快
结构简单
部署方便
多尺度检测成熟
工程生态完善
```

但是普通闭集目标检测存在一个天然限制：

```text
分类 Head 的输出维度
=
训练时预先定义好的类别数 C
```

例如 COCO：

```text
C = 80
```

那么分类 Head 最终就是围绕这 80 个类别训练出来的。

模型学到的是：

```text
这个位置像不像 person
这个位置像不像 bicycle
这个位置像不像 car
...
这个位置像不像 toothbrush
```

但是现实世界类别数量远远不止 80。

工业场景可能需要：

```text
M6 hex bolt
broken bearing
red capacitor
special connector
specific logo
```

机器人场景可能需要：

```text
blue bottle
charging cable
black backpack
coffee mug
```

这些类别不一定包含在原模型训练标签里。

因此问题变成：

> 能不能保留 YOLO 的定位能力，但让“这是什么类别”变得更加开放？

YOLOE 就是在解决这个问题。

---

## 4. Closed-Set、Open-Vocabulary 与 Promptable Detection

### 4.1 Closed-Set Detection

Closed-Set 可以理解成：

```text
训练时定义类别集合

C = {
    person,
    car,
    dog,
    cat
}
```

推理时：

```text
模型主要只能从 C 中选择类别。
```

普通 YOLO 基本属于这种范式。

---

### 4.2 Open-Vocabulary Detection

Open-Vocabulary Detection 的目标是：

```text
训练类别集合
≠
推理时允许查询的类别集合
```

例如模型训练过程中没有明确以：

```text
yellow construction helmet
```

作为传统固定类别训练，

但推理时用户可以把：

```text
"yellow construction helmet"
```

作为文本 Prompt。

模型通过视觉-语言语义空间完成匹配。

---

### 4.3 Promptable Detection

Promptable Detection 表示：

```text
模型检测什么
可以由用户提供的 Prompt 决定
```

Prompt 可以是：

```text
Text Prompt
Visual Prompt
Prompt-Free Internal Vocabulary
```

YOLOE 的重要特点是：

> **在一个统一 YOLO 框架中支持文本提示、视觉提示和无提示开放识别。**

---

## 5. YOLOE 与普通 YOLO、YOLOv8、YOLO11、YOLO26 的关系

这是非常容易混淆的地方。

不要把：

```text
YOLOE
```

理解成：

```text
YOLOvE
```

也不要理解成：

```text
YOLO 的一个简单版本号。
```

更合适的理解是：

> **YOLOE 是一套开放词汇 / Promptable 的 YOLO 方法。**

原始 YOLOE 论文实验主要基于：

```text
YOLOv8
YOLO11
```

进行验证。

因此可以看到：

```text
YOLOE-v8-S
YOLOE-v8-M
YOLOE-v8-L

YOLOE-11-S
YOLOE-11-M
YOLOE-11-L
```

而当前 Ultralytics 工程中进一步提供：

```text
YOLOE-26n
YOLOE-26s
YOLOE-26m
YOLOE-26l
YOLOE-26x
```

所以更准确的关系是：

```text
YOLOE
=
开放词汇与 Prompt 方法

YOLOE-v8
=
YOLOv8 检测骨架
+
YOLOE 开放提示机制

YOLOE-11
=
YOLO11 检测骨架
+
YOLOE 开放提示机制

YOLOE-26
=
YOLO26 检测骨架
+
YOLOE 开放提示机制
```

因此：

```text
YOLO26
```

主要讨论：

```text
Backbone / Neck / Head
端到端检测
标签分配
推理效率
部署
```

而：

```text
YOLOE
```

重点讨论：

```text
固定类别如何变成开放类别
文本 Prompt
视觉 Prompt
Prompt-Free
Object Embedding
Prompt Embedding
```

---

## 6. 先重新理解 P3/P4/P5 与特征图空间位置

在继续 YOLOE 之前，必须彻底理解：

```text
P3 = [B, C3, 80, 80]
```

到底是什么意思。

假设：

```text
P3 = [B, 256, 80, 80]
```

四维分别表示：

```text
B：
batch size

256：
通道数 C

80：
特征图高度 H

80：
特征图宽度 W
```

因此：

```text
80 × 80
```

首先表示：

> **P3 特征图的空间尺寸。**

---

### 6.1 80×80 中的一个位置是什么

例如：

```text
(row=25, col=37)
```

它是：

> **P3 特征图上的一个空间位置。**

但这个位置不是一个数字。

因为：

```text
C = 256
```

所以这个位置实际上存放：

```text
256 个特征值
```

也就是：

```text
f(25,37)
=
[0.23,
 -0.14,
 0.72,
 ...
]

一共 256 个数
```

数学上：

```text
f(25,37) ∈ R^256
```

因此：

```text
P3 = [B,256,80,80]
```

可以在脑中换一种理解：

```text
每张图
↓
80×80 = 6400 个特征图空间位置
↓
每个空间位置
↓
256 维视觉特征
```

概念上可以 reshape 成：

```text
[B,6400,256]
```

---

## 7. 为什么不建议说“6400 个预测位置”

“预测位置”很容易产生两个完全不同的理解：

```text
含义 1：
模型在哪里进行预测？

含义 2：
模型最终预测物体在哪里？
```

这两者不是同一个概念。

因此建议使用更加准确的术语：

```text
P3 的 80×80
=
6400 个特征图空间位置
```

当强调 Detection Head 会在这些位置上产生预测时，可以说：

```text
6400 个预测点
prediction sites
```

而真正模型预测出来的：

```text
[x1,y1,x2,y2]
```

应该称为：

```text
预测框
bounding box
```

所以：

```text
特征图空间位置
≠
最终目标框位置
```

更准确的一句话：

> **P3 的空间尺寸是 80×80，因此包含 6400 个特征图空间位置；检测 Head 会在这些空间位置上执行密集预测，所以这些空间位置在检测语境中也常被称为预测点。**

---

## 8. 普通 YOLO 分类 Head 到底做了什么

假设：

```text
P3 = [B,256,80,80]
```

普通 YOLO 的分类 Head 需要回答：

```text
P3 的每个空间位置：

像 person 吗？
像 bicycle 吗？
像 car 吗？
...
像 dog 吗？
...
```

如果类别数量：

```text
C_cls = 80
```

那么每个空间位置需要输出：

```text
80 个类别 logits
```

即：

```text
256维 Feature
        ↓
Classification Head
        ↓
80维 Class Logits
```

数学上：

```text
f_i ∈ R^256
        ↓
g_cls
        ↓
c_i ∈ R^80
```

---

### 8.1 整张 P3 怎么变化

输入：

```text
[B,256,80,80]
```

经过分类 Head，最终输出：

```text
[B,80,80,80]
```

这里千万不要被三个 `80` 搞混。

真正含义是：

```text
[B, C_cls, H, W]
```

恰好：

```text
C_cls = 80
H = 80
W = 80
```

所以才写成：

```text
[B,80,80,80]
```

---

## 9. `[B,80,80,80]` 到底是什么意思

最好的理解方法不是盯着四维张量，而是 reshape。

原始：

```text
[B,80,80,80]
```

先把：

```text
H × W
=
80 × 80
=
6400
```

展开：

```text
[B,80,6400]
```

再转置：

```text
[B,6400,80]
```

这时含义非常清楚：

```text
每张图片
↓
6400 个特征图空间位置
↓
每个空间位置
↓
80 个类别分数
```

也就是：

```text
point_1    → 80 class logits
point_2    → 80 class logits
...
point_6400 → 80 class logits
```

P4 同理：

```text
[B,80,40,40]
↓
[B,1600,80]
```

P5：

```text
[B,80,20,20]
↓
[B,400,80]
```

最终：

```text
P3: [B,6400,80]
P4: [B,1600,80]
P5: [B, 400,80]
```

合并：

```text
[B,8400,80]
```

意思：

> **每张 640×640 输入图像对应 8400 个多尺度特征图预测点，每个预测点输出 80 个固定类别分数。**

注意：

```text
8400 个预测点
≠
8400 个真实物体
```

只是：

```text
模型在 8400 个特征图空间位置上尝试进行检测。
```

---

## 10. YOLO 的定位和分类不是严格的“先后两步”

很容易把 YOLO 理解成：

```text
先找到物体
↓
再把物体裁出来
↓
再分类
```

这更接近某些 Two-Stage Detector 的思维。

现代 YOLO 更准确的结构是：

```text
Feature_i
   │
   ├───────────────┐
   ↓               ↓
Box Branch      Cls Branch
   ↓               ↓
在哪里？          是什么？
```

也就是说：

> **定位和分类通常从同一个或相关的多尺度视觉特征出发，并行完成。**

因此对于某个 P3 空间位置：

```text
f_i ∈ R^256
```

Head 同时产生：

```text
box_i
class_i
```

不是：

```text
box_i
↓
再把 box_i 输入分类器
```

---

## 11. YOLOE 最核心的变化：Object Embedding Head

普通 YOLO：

```text
Feature_i
↓
Cls Head
↓
80 个固定类别 logits
```

YOLOE 改成：

```text
Feature_i
↓
Object Embedding Head
↓
D 维 Object Embedding
```

论文明确说明：

> Object Embedding Head 的主体结构与普通 YOLO Classification Head 类似，但最后一个 `1×1 Conv` 的输出通道，从闭集场景的类别数 `C` 改成 embedding 维度 `D`。

例如普通 YOLO：

```text
P3 Feature
[B,256,80,80]
        ↓
Cls Head
        ↓
[B,80,80,80]
```

YOLOE：

```text
P3 Feature
[B,256,80,80]
        ↓
Object Embedding Head
        ↓
[B,D,80,80]
```

如果：

```text
D = 512
```

那么：

```text
[B,512,80,80]
```

reshape：

```text
[B,6400,512]
```

意思：

> **P3 的 6400 个特征图空间位置，每一个位置不再直接输出 80 个固定类别，而是输出一个 512 维 Object Embedding。**

---

## 12. Object Embedding 到底是什么

Object Embedding 不是：

```text
dog
```

也不是：

```text
car
```

更不是一个人类可以直接阅读的文字描述。

它是一个向量：

```text
O_i =
[
 0.23,
-0.31,
 0.76,
 ...
]
```

数学上：

```text
O_i ∈ R^D
```

它的作用是：

> **把该特征图空间位置的视觉内容映射到一个语义空间中。**

可以直观理解为：

```text
视觉内容
↓
网络编码
↓
语义空间坐标
```

如果两个对象视觉语义比较接近：

```text
dog
wolf
```

它们的 embedding 往往希望在语义空间中具有更高相似性。

但不要误解成：

```text
embedding 第1维 = 毛发
第2维 = 耳朵
第3维 = 四条腿
```

神经网络的维度通常没有这种简单人工解释。

---

## 13. Prompt Embedding 到底是什么

Object Embedding 表示：

```text
“这个位置的视觉内容在语义空间中是什么样”
```

Prompt Embedding 表示：

```text
“用户想找的概念在同一个语义空间中是什么样”
```

例如用户提供：

```text
["dog", "cat", "car"]
```

经过 Text Prompt Encoder 后：

```text
P_dog ∈ R^D
P_cat ∈ R^D
P_car ∈ R^D
```

组合成：

```text
P ∈ R^(C×D)
```

这里：

```text
C = Prompt 数量
D = embedding 维度
```

注意这里的：

```text
C
```

已经不是“训练时固定类别数”这个意义，

而是：

```text
当前 Prompt 中有多少个类别概念
```

例如：

```text
["dog","cat","car"]

C = 3
```

---

## 14. Object Embedding 与 Prompt Embedding 如何得到类别

YOLOE 的核心公式是：

```text
Label = O · P^T
```

如果：

```text
O ∈ R^(N×D)
P ∈ R^(C×D)
```

那么：

```text
P^T ∈ R^(D×C)
```

因此：

```text
O · P^T
=
[N,D] × [D,C]
=
[N,C]
```

其中：

```text
N：
所有 anchor point / prediction site 数量

D：
Embedding 维度

C：
当前 Prompt 数量
```

例如：

```text
N = 8400
D = 512
C = 3
```

那么：

```text
Object Embeddings:
[8400,512]

Prompt Embeddings:
[3,512]

匹配以后:

[8400,3]
```

最终每个预测点得到：

```text
dog score
cat score
car score
```

---

### 14.1 单个位置例子

某个特征图空间位置：

```text
O_i
```

与：

```text
P_dog
P_cat
P_car
```

匹配：

```text
sim(O_i, P_dog) = 0.93
sim(O_i, P_cat) = 0.28
sim(O_i, P_car) = 0.03
```

最终：

```text
dog
```

所以：

```text
Object Embedding
```

可以理解成：

```text
“我在语义空间中的位置”
```

Prompt Embedding：

```text
“dog 在语义空间中的位置”
```

两者越相似：

```text
这个位置属于 dog 的分数越高
```

---

## 15. 普通 YOLO 与 YOLOE 的分类方式对比

### 15.1 普通 YOLO

```text
Feature_i
↓
固定分类 Head
↓
C 个固定类别 logits
```

例如：

```text
256维 Feature
↓
Linear / Conv
↓
80类
```

本质：

```text
类别知识
被固化在 Classification Head 参数中
```

---

### 15.2 YOLOE

```text
Feature_i
↓
Object Embedding Head
↓
Object Embedding O_i
↓
与 Prompt Embedding P 匹配
↓
当前 Prompt 类别分数
```

本质：

```text
类别空间
由 Prompt 动态提供
```

因此最值得记住的一句话是：

> **普通 YOLO 使用固定分类器；YOLOE 把固定分类器改造成由 Prompt Embedding 定义的动态语义分类器。**

---

## 16. YOLOE 总体网络结构

原始 YOLOE 论文采用典型 YOLO 架构：

```text
Input Image
    ↓
Backbone
    ↓
PAN
    ↓
P3 / P4 / P5
    ↓
Multi-scale Features
```

然后进入多个 Head：

```text
                  Multi-scale Features
                         │
          ┌──────────────┼───────────────┐
          ↓              ↓               ↓
   Regression Head  Segmentation Head  Object Embedding Head
          ↓              ↓               ↓
        Boxes           Masks             O
                                           │
                                           │
                                      Prompt P
                                           │
                                           ↓
                                        O·P^T
                                           ↓
                                      Class Scores
```

论文中明确包括：

```text
Backbone
PAN
Regression Head
Segmentation Head
Object Embedding Head
```

因此 YOLOE 并没有抛弃 YOLO 的定位能力。

真正重点修改的是：

```text
“类别语义如何表达”
```

这一部分。

---

## 17. Text Prompt：RepRTA 详解

RepRTA：

```text
Re-parameterizable Region-Text Alignment
```

可以翻译为：

```text
可重参数化的区域-文本对齐
```

它解决的问题是：

> **怎样让文字 Prompt 的 embedding 与 YOLO 的 Object Embedding 更好地对齐，同时又不让推理变得很重？**

---

### 17.1 最基础的 Text Prompt 方案

假设用户输入：

```text
dog
cat
car
```

首先经过 Text Encoder：

```text
dog
 ↓
Text Encoder
 ↓
P_dog
```

论文使用预训练文本编码器获得初始 textual embedding。

形式：

```text
P = TextEncoder(T)
```

其中：

```text
T：
文本 Prompt

P：
预训练 textual embedding
```

---

### 17.2 为什么不能直接拿 Text Embedding 就结束

因为：

```text
通用语言-图像语义空间
```

和：

```text
YOLO 区域检测特征空间
```

并不一定天然完美对齐。

所以论文加入轻量辅助网络：

```text
fθ
```

得到：

```text
P_enhanced = fθ(P)
```

论文中的辅助网络只包含一个轻量 FFN / SwiGLU 风格块。

于是：

```text
Text
↓
Text Encoder
↓
Pretrained Text Embedding P
↓
Lightweight fθ
↓
Enhanced Prompt Embedding 𝓟
```

再：

```text
Object Embedding O
        ×
Enhanced Prompt Embedding 𝓟
        ↓
Class Score
```

---

### 17.3 为什么训练时开销不大

论文在训练前可以：

```text
预先计算数据集所有文本 embedding
```

也就是：

```text
Text Encoder
只需要离线运行
```

训练阶段直接缓存：

```text
P
```

所以训练时主要额外计算：

```text
轻量 fθ
```

而不是每个 iteration 都重新运行大型文本编码器。

---

## 18. 为什么 RepRTA 可以 Re-parameterize

这是 YOLOE 最重要的效率设计之一。

训练阶段：

```text
Feature I
↓
Object Embedding Head
↓
Object Embedding O
      ×
Enhanced Prompt P
↓
Class Score
```

假设 Object Embedding Head 最后：

```text
1×1 Conv
```

卷积核：

```text
K
```

那么：

```text
I
↓
Conv(K)
↓
O
↓
× P
↓
Class
```

由于：

```text
1×1 Conv
+
后面的线性 Prompt 匹配
```

本质都是线性映射，

因此可以合并成新的卷积核：

```text
K'
```

最终部署时：

```text
Feature
↓
Conv(K')
↓
Class
```

也就是重新变回普通 YOLO 分类 Head 的形式。

论文给出的核心思想可以表示：

```text
Prompt transformation
+
Embedding projection
+
1×1 Conv

        ↓ 合并

新的 1×1 Conv 权重 K'
```

因此：

```text
训练：
Object Embedding + Prompt Matching

部署到固定类别：
直接 Conv → Class
```

这就是：

```text
Re-parameterizable
```

的意义。

---

### 18.1 一个直观类比

训练时：

```text
学生先学会：

视觉对象
↔
语言概念
```

部署时如果已经确定只识别：

```text
person
helmet
forklift
```

那么可以把这三个 Prompt：

```text
“烘焙进分类器权重”
```

于是推理模型重新像普通 YOLO 一样：

```text
Feature
↓
Cls Conv
↓
3 classes
```

这对实时部署非常重要。

---

## 19. Visual Prompt：SAVPE 详解

有些东西很难用语言准确描述。

例如：

```text
特殊工业零件
陌生 Logo
特定产品
稀有物种
特殊损伤形态
```

用户可能不知道它叫什么。

但用户可以说：

```text
“就是图片里这个东西。”
```

然后框出：

```text
Bounding Box
```

或者提供：

```text
Mask
```

YOLOE 使用：

```text
SAVPE
=
Semantic-Activated Visual Prompt Encoder
```

把视觉提示转换成 Prompt Embedding。

---

## 20. SAVPE 的 Semantic Branch

Semantic Branch 的目标是：

```text
从 YOLO 已经计算好的多尺度视觉特征中
提取高质量语义表示
```

输入：

```text
P3
P4
P5
```

论文中每个尺度经过：

```text
3×3 Conv
3×3 Conv
```

然后：

```text
Upsample
Concat
Projection
```

得到：

```text
S ∈ R^(D×H×W)
```

这里：

```text
S
=
Prompt-Agnostic Semantic Feature
```

意思是：

> **这一分支先提取图像的语义特征，并不知道用户具体框的是哪一个区域。**

---

## 21. SAVPE 的 Activation Branch

第二个分支负责：

```text
用户到底指的是哪里？
```

视觉 Prompt：

```text
Bounding Box
或
Mask
```

先被转换为 mask：

```text
目标区域 = 1
其他区域 = 0
```

然后经过：

```text
Downsample
3×3 Conv
```

得到 Prompt Feature：

```text
F_V
```

与此同时，从：

```text
P3/P4/P5
```

获得：

```text
F_I
```

也就是 image feature。

然后：

```text
Concat(F_V, F_I)
↓
Conv
↓
Prompt-aware Weight W
```

因此：

```text
Semantic Branch：
回答“这里有什么语义？”

Activation Branch：
回答“用户关心哪些空间区域？”
```

---

## 22. SAVPE 如何得到 Visual Prompt Embedding

Semantic Branch：

```text
S
```

Activation Branch：

```text
W
```

然后：

```text
Prompt Embedding
=
对 S 按 W 加权聚合
```

直觉上：

```text
整幅图中有很多语义特征

但用户画了一个框
        ↓
Activation Weight 告诉模型
“重点看这里”
        ↓
从 Semantic Feature 中
聚合这个区域的语义
        ↓
Visual Prompt Embedding
```

最后这个 Visual Prompt Embedding 与：

```text
Object Embeddings O
```

进行相似度比较：

```text
O · P_visual^T
```

于是：

```text
找到与参考目标视觉语义相似的对象
```

---

### 22.1 为什么不直接 Crop 后跑另一个 CLIP Image Encoder

一种简单方案：

```text
Reference Region
↓
Crop
↓
CLIP Vision Encoder
↓
Visual Embedding
```

但这样意味着：

```text
YOLO Backbone 已经计算了一次图像
+
Visual Prompt 又需要额外视觉模型
```

带来：

```text
更多参数
更多显存
更多推理延迟
更复杂部署
```

SAVPE 的思路是：

> **尽量复用 YOLO 已经存在的 P3/P4/P5 特征。**

所以：

```text
已有 YOLO Feature
+
Visual Prompt Mask
↓
轻量 SAVPE
↓
Visual Prompt Embedding
```

更加适合实时检测和边缘部署。

---

## 23. Prompt-Free：LRPC 详解

Prompt-Free 的问题是：

```text
用户既没有输入文字，
也没有提供参考图片。

模型要自己告诉用户：
画面里有什么。
```

传统开放世界方法可能采用：

```text
Region
↓
Language Model
↓
生成类别名称
```

问题：

```text
慢
模型大
内存开销大
不适合 YOLO 的实时目标
```

YOLOE 提出：

```text
LRPC
=
Lazy Region-Prompt Contrast
```

核心思想：

> **把“生成名称”改成“从大型词汇表中检索名称”。**

---

## 24. 为什么 LRPC 要做“Lazy”匹配

假设：

```text
N = 8400 个 anchor points
```

内部词汇表：

```text
K = 数千个类别
```

如果暴力计算：

```text
8400 × K
```

所有匹配，

会非常浪费。

因为：

```text
8400 个位置中
大多数是背景
```

所以 LRPC 先训练一个：

```text
Specialized Prompt Embedding P_s
```

专门判断：

```text
“这个位置有没有物体？”
```

形式：

```text
O' =
{ o ∈ O | o · P_s^T > δ }
```

也就是：

```text
所有 Object Embeddings
↓
Special Object Prompt
↓
筛选出疑似真实物体的 anchor points
```

例如：

```text
8400
↓
150
```

然后：

```text
仅这 150 个位置
↓
和大型词汇表匹配
```

这就是：

```text
Lazy
```

的含义。

不是模型真的“懒”，而是：

> **只在值得分类的候选区域上执行昂贵的大词汇匹配。**

---

## 25. YOLOE 的实例分割机制

YOLOE 不只做 Detection。

原始论文把：

```text
Detection
+
Instance Segmentation
```

统一在一个框架中。

网络具有：

```text
Regression Head
Segmentation Head
Object Embedding Head
```

Segmentation Head 延续实时实例分割常见思路：

```text
Prototype Masks
+
Mask Coefficients
↓
Instance Mask
```

因此 YOLOE 可以输出：

```text
Class
Confidence
Bounding Box
Instance Mask
```

例如 Text Prompt：

```text
"dog"
```

可以得到：

```text
dog
score = 0.94
box = [...]
mask = ...
```

当前 Ultralytics 的大量 YOLOE 预训练权重使用：

```text
*-seg.pt
```

也是因为官方预训练模型默认提供实例分割能力。

---

## 26. YOLOE 的训练目标

原始 YOLOE 论文中：

```text
Task-Aligned Label Assignment
```

用于匹配预测和 Ground Truth。

损失主要包括：

```text
Classification:
Binary Cross Entropy

Bounding Box:
IoU Loss
+
Distribution Focal Loss

Segmentation:
Binary Cross Entropy
```

需要注意：

> **这里描述的是原始 YOLOE 论文基于 YOLOv8/YOLO11 的训练设置，不应该直接等价成 YOLOE-26 的所有训练细节。**

因为 YOLO26 本身在边界框回归、端到端 Head 等方面存在进一步变化。

---

## 27. YOLOE 原始论文的训练阶段

原始论文训练主要分为三个阶段。

---

### 27.1 Text Prompt 训练

论文首先进行：

```text
Text Prompt Training
```

训练：

```text
Object Embedding
↔
Text Embedding
```

的语义对齐。

训练约：

```text
30 epochs
```

论文使用：

```text
Objects365
GoldG / GQA
Flickr30k
```

等 detection / grounding 数据。

---

### 27.2 Visual Prompt 训练

在已经训练好的 Text Prompt 模型基础上：

```text
主要训练 SAVPE
```

论文中只进行较短时间：

```text
约 2 epochs
```

目的：

```text
让 Visual Prompt Encoder
学习把 box/mask reference
编码到与 Object Embedding 兼容的空间
```

---

### 27.3 Prompt-Free 训练

最后：

```text
训练 Specialized Prompt Embedding
```

让它能够：

```text
find all objects
```

论文中这一阶段约：

```text
1 epoch
```

本质：

```text
所有物体
→
统一视为 object category
→
训练一个“有物体”的特殊语义 Prompt
```

然后 LRPC 再用大词汇进行检索。

---

## 28. YOLOE 三种推理模式完整流程

### 28.1 Text Prompt

```text
Image
↓
Backbone
↓
PAN
↓
P3/P4/P5
↓
Object Embedding Head
↓
Object Embeddings O
          ↑
          │
Text Prompt
↓
Text Encoder / RepRTA
↓
Prompt Embeddings P
          │
          ↓
       O · P^T
          ↓
Class Scores
          ↓
Box + Class + Mask
```

---

### 28.2 Visual Prompt

```text
Reference Image / Current Image
+
Bounding Box / Mask
↓
SAVPE
↓
Visual Prompt Embedding P_visual

Target Image
↓
Backbone
↓
PAN
↓
Object Embeddings O

O · P_visual^T
↓
找到与参考目标相似的对象
↓
Box + Class ID + Mask
```

---

### 28.3 Prompt-Free

```text
Image
↓
Backbone
↓
PAN
↓
Object Embeddings O
↓
Specialized Object Prompt
↓
筛选疑似物体位置 O'
↓
Built-in Vocabulary
↓
Lazy Matching
↓
Category Retrieval
↓
Box + Class + Mask
```

---

## 29. YOLOE 与 YOLO26 端到端检测怎样结合理解

YOLO26 的核心主线可以抽象为：

```text
Image
↓
Backbone
↓
Neck
↓
P3/P4/P5
↓
Detection Head
↓
One-to-Many / One-to-One
↓
End-to-End Detection
```

它重点解决：

```text
如何检测得更高效
如何减少重复框
如何减少 NMS 依赖
如何优化推理路径
```

而 YOLOE 解决：

```text
这个目标“是什么”
如何从固定类别
变成开放 Prompt 类别
```

所以概念上：

```text
                         Multi-scale Feature
                                  │
                      ┌───────────┴───────────┐
                      ↓                       ↓
                 Box / Detection          Semantic
                      ↓                       ↓
                YOLO26 端到端逻辑       YOLOE Embedding
                                              ↓
                                         Prompt Match
```

因此：

> **YOLO26 更偏向“如何高效而干净地得到目标”；YOLOE 更偏向“怎样让目标类别不再固定”。**

YOLOE-26 就是在这两个方向上的组合。

---

## 30. YOLOE 实际使用：Text Prompt

当前 Ultralytics 可以直接：

```bash
pip install -U ultralytics
```

Python：

```python
from ultralytics import YOLOE

model = YOLOE("yoloe-26s-seg.pt")

model.set_classes([
    "person",
    "bus",
    "dog",
])

results = model.predict("test.jpg")

results[0].show()
```

核心：

```python
model.set_classes(...)
```

它负责配置当前要检测的文本类别。

---

### 30.1 Prompt 可以动态切换

第一次：

```python
model.set_classes(["person", "dog"])
```

第二次：

```python
model.set_classes(["helmet", "forklift"])
```

在原始可提示模型中：

```text
无需为了换类别重新训练完整网络
```

这就是开放 Prompt 模型和普通闭集 YOLO 最明显的使用区别。

---

## 31. YOLOE 实际使用：Visual Prompt

Visual Prompt 的输入通常包括：

```text
bboxes
cls
```

其中：

```text
bboxes：
参考目标的边界框

cls：
给每个参考类别分配的临时类别 ID
```

例如：

```python
import numpy as np

from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe import YOLOEVPSegPredictor

model = YOLOE("yoloe-26l-seg.pt")

visual_prompts = dict(
    bboxes=np.array(
        [
            [221.52, 405.8, 344.98, 857.54],
            [120, 425, 160, 445],
        ],
    ),
    cls=np.array(
        [
            0,
            1,
        ]
    ),
)

results = model.predict(
    "test.jpg",
    visual_prompts=visual_prompts,
    predictor=YOLOEVPSegPredictor,
)

results[0].show()
```

这里：

```text
class 0
class 1
```

不是 COCO 的固定类别 ID，

而是：

```text
用户这一次 Visual Prompt 中定义的临时类别编号
```

官方实现要求它们连续从 0 开始。

---

### 31.1 Visual Prompt 的本质

不是：

```text
告诉模型“这个东西叫 person”
```

而是：

```text
告诉模型：

“这种视觉外观算作 class 0”
“那种视觉外观算作 class 1”

然后去找更多相似对象。
```

因此它特别适合：

```text
不知道对象名称
专业名称难描述
类别极细粒度
特定 Logo
特定零件
```

等场景。

---

## 32. YOLOE 实际使用：Prompt-Free

Prompt-Free 模型通常：

```text
*-pf.pt
```

例如：

```python
from ultralytics import YOLOE

model = YOLOE("yoloe-26s-seg-pf.pt")

results = model.predict("test.jpg")

results[0].show()
```

特点：

```text
不需要 set_classes()
不需要 visual_prompts
```

模型直接使用：

```text
内置大型词汇表
```

进行类别检索。

当前 Ultralytics 工程文档中的 Prompt-Free 权重使用预定义大型词汇集合；具体工程词汇数量和来源属于实现版本细节，应以当前官方文档和权重版本为准。

---

## 33. YOLOE 微调与自定义数据集

当前 Ultralytics 可以对 YOLOE 进行自定义数据微调。

如果训练 detection-only 模型，可以：

```python
from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe import YOLOEPETrainer

model = YOLOE("yoloe-26s.yaml")

model.load("yoloe-26s-seg.pt")

results = model.train(
    data="coco128.yaml",
    epochs=80,
    patience=10,
    trainer=YOLOEPETrainer,
)
```

这里的逻辑是：

```text
Detection YAML
↓
加载相同规模的 YOLOE segmentation checkpoint
↓
使用对应 YOLOE Trainer 微调
```

官方预训练 YOLOE checkpoints 很多是 segmentation 模型，因此 detection-only fine-tuning 需要注意模型 YAML 与 Trainer 的匹配。

---

### 33.1 Linear Probing 的思想

如果数据量比较少，可以考虑：

```text
冻结大部分 Backbone / Neck
↓
只训练与类别适配相关的部分
```

因为 YOLOE 已经具有较丰富的开放语义表示。

这类方法的核心是：

```text
不重新学习“怎么看图”
而主要学习：
“已有视觉语义怎样适配新的任务类别”
```

---

## 34. YOLOE 导出和部署为什么很特殊

这是 YOLOE 工程部署中特别重要的一点。

如果：

```python
model.set_classes([
    "person",
    "helmet",
    "forklift",
])
```

然后：

```python
model.export(format="onnx")
```

当前 Ultralytics 的导出模型是：

```text
Static
```

也就是说：

```text
person
helmet
forklift
```

这些 Prompt 会被固化到导出权重中。

导出后的：

```text
ONNX
TensorRT
OpenVINO
CoreML
RKNN
...
```

通常不能再直接：

```python
set_classes(...)
```

切换成另一批新类别。

如果要换 Prompt：

```text
回到原始 .pt 模型
↓
重新 set_classes()
↓
重新 export
```

这和 RepRTA 的思想高度一致：

```text
开发阶段：
Prompt 可动态改变

最终部署阶段：
Prompt / 类别固定
↓
重参数化 / 固化
↓
模型像普通 YOLO 一样高效执行
```

---

## 35. YOLOE 与“YOLO + CLIP 暴力组合”的区别

一个最简单的开放分类方案可能是：

```text
YOLO
↓
得到很多 Bounding Boxes
↓
每个 Box Crop
↓
CLIP Vision Encoder
↓
和 Text Embedding 匹配
```

问题：

```text
重复视觉编码
额外视觉模型
大量 Crop
部署复杂
延迟较高
```

YOLOE：

```text
Image
↓
YOLO Backbone + PAN
↓
已有 Multi-scale Feature
↓
Object Embedding Head
↓
直接与 Prompt Embedding 对齐
```

也就是说：

> **定位和开放语义识别尽可能共享同一套 YOLO 视觉特征。**

这正是 YOLOE 高效率的来源之一。

---

## 36. YOLOE 与 YOLO-World 的关系

YOLO-World 是较早的重要实时开放词汇 YOLO 工作。

两者共同点：

```text
YOLO 检测框架
+
视觉-语言语义
+
Open Vocabulary
```

YOLOE 进一步重点解决：

```text
Text Prompt
+
Visual Prompt
+
Prompt-Free
```

三种开放提示模式的统一。

特别提出：

```text
RepRTA
SAVPE
LRPC
```

并把：

```text
推理效率
训练成本
边缘部署
```

作为重要目标。

可以简单记：

```text
YOLO-World：
重点证明 YOLO 可以做实时 Open-Vocabulary Detection

YOLOE：
进一步追求一个统一、高效的多 Prompt YOLO 框架
```

---

## 37. 常见混淆点

### 37.1 80×80 是 6400 个物体吗

不是。

```text
80×80
=
P3 特征图空间尺寸
```

意味着：

```text
6400 个特征图空间位置
```

而不是：

```text
6400 个真实目标。
```

---

### 37.2 “预测位置”是什么意思

不推荐单独使用这个词。

建议：

```text
特征图空间位置
prediction site
预测点
anchor point / reference point
```

根据语境区分。

---

### 37.3 一个空间位置是不是一个数字

不是。

例如：

```text
P3=[B,256,80,80]
```

每个：

```text
(row,col)
```

对应：

```text
256 维 Feature Vector
```

---

### 37.4 普通 YOLO 是不是先找出框，再分类框里面的内容

通常不是。

现代 YOLO：

```text
Multi-scale Feature
↓
Box Branch
+
Cls Branch
```

并行预测。

---

### 37.5 Object Embedding 是不是类别名称

不是。

```text
Object Embedding
=
D 维语义向量
```

需要再与：

```text
Prompt Embedding
```

匹配。

---

### 37.6 YOLOE 是不是没有 Classification

不是。

它仍然最终需要得到：

```text
Class Scores
```

只是分类方式从：

```text
固定分类器
```

变成：

```text
Object Embedding × Prompt Embedding
```

---

### 37.7 YOLOE 是不是完全没有固定类别

要分模式。

```text
Text Prompt：
用户动态定义类别

Visual Prompt：
用户用视觉示例定义类别

Prompt-Free：
从内置词汇表中检索
```

Prompt-Free 仍然受到：

```text
内置 vocabulary
```

覆盖范围限制。

---

### 37.8 Anchor-free 是不是没有 anchor point

不是。

Anchor-free 表示：

```text
不使用预设 anchor box 宽高模板
```

但仍然有：

```text
grid point
anchor point
reference point
```

作为密集预测参考。

---

### 37.9 YOLOE 原始论文是不是基于 YOLO26

不是。

原始论文主要验证：

```text
YOLOv8
YOLO11
```

YOLOE-26 是后续当前工程中的 YOLO26 + YOLOE 组合。

---

### 37.10 原始 YOLOE 的 DFL 和 YOLO26 移除 DFL 是否矛盾

不矛盾。

因为：

```text
原始 YOLOE：
基于 YOLOv8 / YOLO11 的论文训练配置

YOLOE-26：
建立在更新的 YOLO26 检测骨架上
```

不能把两代底层检测器的所有训练细节混成一套。

---

## 38. 推荐的术语体系

为了避免以后学习时产生歧义，建议统一使用：

| 概念 | 推荐术语 | 不容易误解的含义 |
|---|---|---|
| P3 的 `(i,j)` | 特征图空间位置 | 特征图上的网格坐标 |
| Head 在 `(i,j)` 做预测 | 预测点 / prediction site | 在该空间位置执行一次 dense prediction |
| `(i,j)` 映射到原图 | reference point / anchor point | Box Regression 的坐标参考 |
| `f_i` | 空间位置特征向量 | C 维视觉特征 |
| `box_i` | 预测框 | 模型真正预测的目标位置 |
| `cls_i` | 类别 logits / scores | 普通 YOLO 固定分类输出 |
| `O_i` | Object Embedding | YOLOE 的 D 维视觉语义表示 |
| `P_c` | Prompt Embedding | 某个 Prompt 的 D 维语义表示 |
| `O·P^T` | Region-Prompt Matching | 得到当前 Prompt 类别分数 |

建议以后尽量避免：

```text
“6400 个预测位置”
```

而改成：

> **P3 有 6400 个特征图空间位置，检测 Head 会在这些空间位置上执行密集预测。**

---

## 39. 完整知识地图

可以把 YOLOE 的全部知识压缩成下面这张图：

```text
                              YOLOE
                                │
             ┌──────────────────┴──────────────────┐
             │                                     │
          YOLO 检测框架                       Open Semantic
             │                                     │
      Backbone + PAN                            Prompt
             │                                     │
       P3 / P4 / P5             ┌──────────────────┼─────────────────┐
             │                  │                  │                 │
   多尺度特征图空间位置       Text              Visual         Prompt-Free
             │                  │                  │                 │
             │               RepRTA              SAVPE              LRPC
             │                  │                  │                 │
             │                  └──────── Prompt Embedding ─────────┘
             │                                  P
             │                                  ↑
             ↓                                  │
    Object Embedding Head                       │
             ↓                                  │
             O ─────────────────────────────────┘
             │
             ↓
          O · P^T
             │
             ↓
       Open Class Scores
             │
       ┌─────┴─────┐
       ↓           ↓
      Box         Mask
```

---

## 40. 学习路线建议

### 第一阶段：先完全理解普通 YOLO 的特征图

必须能回答：

```text
[B,256,80,80]
到底是什么意思？

80×80 是什么？

6400 是什么？

一个空间位置为什么是 256 维？
```

---

### 第二阶段：理解普通 Classification Head

必须能说清楚：

```text
[B,256,80,80]
↓
Cls Head
↓
[B,80,80,80]
```

为什么可以解释成：

```text
6400 个空间位置
×
每个位置 80 个 class logits
```

---

### 第三阶段：理解 Object Embedding

掌握：

```text
普通 YOLO：
Feature → C classes

YOLOE：
Feature → D-dimensional Object Embedding
```

---

### 第四阶段：理解 Prompt Matching

掌握：

```text
O ∈ R^(N×D)
P ∈ R^(C×D)

O·P^T
↓
R^(N×C)
```

这一步理解以后，YOLOE 核心就已经掌握 70% 以上。

---

### 第五阶段：学习三个 Prompt 模块

顺序推荐：

```text
RepRTA
↓
SAVPE
↓
LRPC
```

因为：

```text
Text Prompt
最容易从普通 Classification 理解

Visual Prompt
需要理解 mask / spatial weighting

Prompt-Free
需要理解大词汇检索与候选过滤
```

---

### 第六阶段：再理解 YOLOE-26

最后再把：

```text
YOLOE Open-Vocabulary
```

和：

```text
YOLO26 End-to-End Detection
```

合起来。

这样不会把：

```text
检测器结构升级
```

和：

```text
开放语义分类升级
```

混淆。

---

## 41. 最后总结

YOLOE 最本质的变化可以压缩成一句话：

> **它保留 YOLO 的高效密集检测框架，但把“每个特征图空间位置直接输出固定类别 logits”改成“先输出 Object Embedding，再与 Prompt Embedding 进行语义匹配”，从而把固定类别检测扩展成开放词汇、可提示检测与实例分割。**

普通 YOLO：

```text
Image
↓
Backbone
↓
Neck
↓
P3/P4/P5
↓
每个特征图空间位置产生 Feature
↓
┌─────────────┬─────────────┐
↓             ↓
Box Head    Cls Head
↓             ↓
Box        固定类别
```

YOLOE：

```text
Image
↓
Backbone
↓
PAN
↓
P3/P4/P5
↓
每个特征图空间位置产生 Feature
↓
┌─────────────────┬────────────────────┐
↓                 ↓
Box Head      Object Embedding Head
↓                 ↓
Box                O
                   │
          ┌────────┴─────────┐
          ↓                  ↓
     Prompt Encoder      Prompt-Free
          ↓                  ↓
          P                  P
          └────────┬─────────┘
                   ↓
                O · P^T
                   ↓
              Class Scores
```

三个关键模块分别回答：

```text
RepRTA：
文字怎么变成适合 YOLO 区域检测的 Prompt Embedding？

SAVPE：
用户给一个视觉示例时，怎样高效得到 Visual Prompt Embedding？

LRPC：
用户什么 Prompt 都不给时，怎样高效地从大型词汇表中找出类别？
```

最终形成：

```text
Text Prompt
Visual Prompt
Prompt-Free
```

三种模式统一在一个高效 YOLO 框架中。

如果只记一条公式：

```text
普通 YOLO：
Feature → Class

YOLOE：
Feature → Object Embedding O
Prompt → Prompt Embedding P

Class Score = O · P^T
```

那么这就是 YOLOE 最核心的数学与结构思想。

---

## 42. 参考资料

### 42.1 本文基础学习材料

本文在概念组织、YOLO 基础结构、P3/P4/P5、Dense Prediction、Anchor-free、Decoupled Head、YOLO26 等部分，延续用户提供的：

```text
《[YOLO 系列模型与 YOLO26 核心模块超详细说明文档](/2026/08/12/yolo-series-and-yolo26/)》
```

的术语体系和讲解方式。

---

### 42.2 YOLOE 原始论文

Ao Wang, Lihao Liu, Hui Chen, Zijia Lin, Jungong Han, Guiguang Ding.

**YOLOE: Real-Time Seeing Anything**

arXiv:2503.07465

https://arxiv.org/abs/2503.07465

重点参考内容：

```text
Section 3.1：
Model Architecture

Section 3.2：
Re-parameterizable Region-Text Alignment

Section 3.3：
Semantic-Activated Visual Prompt Encoder

Section 3.4：
Lazy Region-Prompt Contrast

Section 3.5：
Training Objective
```

---

### 42.3 YOLOE 官方代码

THU-MIG / YOLOE：

https://github.com/THU-MIG/yoloe

用于参考：

```text
官方 PyTorch 实现
模型权重
训练设置
导出与 Re-parameterization
```

---

### 42.4 Ultralytics YOLOE 文档

https://docs.ultralytics.com/models/yoloe/

用于参考当前工程接口：

```text
YOLOE-26
Text Prompt
Visual Prompt
Prompt-Free
set_classes()
visual_prompts
YOLOEVPSegPredictor
训练
验证
导出
Prompt Embedding 保存/加载
```

---

### 42.5 YOLO 基础论文

Joseph Redmon, Santosh Divvala, Ross Girshick, Ali Farhadi.

**You Only Look Once: Unified, Real-Time Object Detection**

https://arxiv.org/abs/1506.02640

用于理解：

```text
单阶段检测
统一检测框架
从整图直接预测边界框与类别
```

---

## 一句话速记

```text
YOLO：
在大量特征图空间位置上，
同时预测“在哪里”和“固定类别是什么”。

YOLOE：
仍然在大量特征图空间位置上预测，
但把固定 Classification Head 改成 Object Embedding，
再通过 Text / Visual / Prompt-Free 产生 Prompt Embedding，
最后利用 O·P^T 动态得到类别。
```

