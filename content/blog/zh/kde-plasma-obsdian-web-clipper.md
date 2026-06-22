---
title: 解决Linux KDE Plasma wayland 下 Obsidian Web Clipper无法使用的问题
date: 2026-05-10
summary:
categories: ['折腾']
tags: ['Linux', 'Obsidian']
language: zh
translationKey: kde-plasma-obsdian-web-clipper
authors: ['default']
image: /static/images/obsidian.png
---

我在使用Obsidian的时候，发现在 Plasma Wayland上，Obsidian 已经打开时，Chrome 的 **Obsidian Web Clipper** 点击“添加到 Obsidian”后，创建的页面是空的。

只有先完全关闭 Obsidian，再从 Web Clipper 添加，内容才会正常出现。

## 原因

这不是 Web Clipper 没抓到网页内容，而是 **KDE 阻止了已经运行中的 Obsidian 正确获得焦点**。

Web Clipper 把网页内容传给 Obsidian 时，需要 Obsidian 被正确唤起并读取传入的数据。  
但在 KDE 的窗口管理规则下，Obsidian 处于后台运行时，可能无法正常获得焦点，所以内容没有被正确写入，结果就变成空页面。

## 分析

现象的关键点是：

Obsidian 关闭时添加内容正常；
Obsidian 已打开时添加内容为空；
说明浏览器插件本身大概率是正常的；
问题出在 Obsidian 已运行时，KDE 没有让它正确响应 Web Clipper 的调用。

所以问题属于 KDE 窗口焦点/激活权限问题，不是 Obsidian 笔记库、模板或 Chrome 插件配置错误。

## 解决方案

在 KDE 里给 Obsidian 添加窗口规则：打开KDE设置`系统设置 → 窗口管理 → 窗口规则`,按我下面的方法设置即可

![](/static/images/obsdian-kde-settings.png)
