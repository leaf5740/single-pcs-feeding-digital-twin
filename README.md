# 单 PCS 自动检测补料设备 · Three.js 数字孪生

一个可离线运行的工业设备 3D 交互单页应用。设备、料盘、产品、相机、伺服模组、真空吸嘴、电气元件与 HMI 全部由 Three.js 几何体实时生成，不使用 GLB、GLTF、FBX、OBJ、Blender 或外部 3D 模型。

## 运行

需要 Node.js 18 或更高版本。

```powershell
cd outputs
node serve.mjs
```

浏览器打开：

```text
http://127.0.0.1:4173
```

项目使用 ES Modules。请通过本地 HTTP 服务访问，不要直接用 `file://` 打开 `index.html`。

本项目可直接部署到 GitHub Pages。仓库根目录已包含 `.nojekyll`，在 GitHub Pages 中选择 `Deploy from a branch`、分支 `main`、目录 `/ (root)` 即可。

如需修改端口：

```powershell
$env:PORT=8080
node serve.mjs
```

## 项目结构

```text
outputs/
├─ index.html                 页面结构、控制台 UI、视觉检测面板
├─ styles.css                 深色工业科技风、响应式布局与动效
├─ serve.mjs                  零依赖静态服务器
├─ src/
│  ├─ main.js                 Three.js 场景、灯光、相机、渲染循环
│  ├─ machine.js              整机与全部机械/电气部件代码建模
│  ├─ parts.js                部件名称、功能、参数、结构树数据
│  ├─ interactions.js         射线点击、选择、高亮、聚焦与悬停
│  ├─ simulation.js           X/Y/XYZ 补料流程状态机
│  ├─ tweens.js               可暂停、按通道隔离的补间动画引擎
│  └─ ui.js                   控制面板、视觉矩阵、拆解和参数交互
└─ vendor/
   ├─ three.module.js
   ├─ three.core.js
   ├─ OrbitControls.js
   ├─ RoomEnvironment.js
   ├─ RoundedBoxGeometry.js
   └─ lucide.min.js
```

## 交互

- 鼠标左键拖拽：360° 旋转视角
- 鼠标右键拖拽：平移视图
- 鼠标滚轮：缩放
- 点击三维部件：蓝色选择框、材质高亮、相机聚焦
- 点击空白区域：取消选择
- 左侧结构树：按系统定位并选择部件
- 右侧部件详情：查看功能、机械参数、安装位置和运动方向
- 部件操作：隐藏/显示、聚焦、按预设方向拆解
- 视角工具：ISO、正视、侧视、俯视、默认视角恢复
- `Space`：播放或暂停
- `Esc`：取消选择并关闭移动端面板

## 运行模拟

底部控制区提供：

- 播放、暂停、单步执行、复位
- 正常、单缺料、多缺料三种模拟模式
- `0.5×–2.5×` 运行速度
- 整机拆解、复原、外壳透明/隐藏/实心切换

完整流程为：

```text
X 轴上料
→ 料盘定位
→ 背光点亮
→ 第一次拍照
→ Y 轴转移
→ 第二次拍照
→ 双图缺料对比
→ 无缺料：直接放行
→ 有缺料：XYZ 前往独立供料盘
→ Z 轴下降
→ 真空吸取
→ XYZ 移至缺料坐标
→ Z 轴下降
→ 真空释放放料
→ 循环处理全部缺料
→ 自动放行
```

所有位置变化均通过插值动画完成。暂停、单步、复位和速度变化由独立状态机管理。

## 视觉检测

右侧 `AOI` 面板支持：

- 第一次拍照结果
- 第二次拍照结果
- 缺料对比结果
- 绿色有料、红色缺料、蓝色补料中、灰色未检测
- 点击产品单元手动切换有料/缺料
- 自定义行数、列数、X 间距和 Y 间距

默认料盘为 `300 × 200 mm`、`8 × 8`、共 `64 PCS`。阵列过大或间距超过料盘时，系统自动压缩到可用范围。

## 代码扩展

- 修改设备材质：`src/machine.js` 中的 `_createMaterials()`
- 修改各机构结构：`_buildFrame()`、`_buildConveyor()`、`_buildVisionSystem()`、`_buildXYZSystem()` 等
- 修改部件信息：`src/parts.js`
- 修改补料流程与步骤：`src/simulation.js` 的 `_buildSequence()`
- 修改拆解方向：`src/machine.js` 的 `_getExplodeTargets()` 与 `togglePartExplode()`
- 修改 UI 配色与断点：`styles.css` 顶部变量和媒体查询

调试入口：

```js
window.digitalTwin.machine
window.digitalTwin.simulation
window.digitalTwin.selection
```

## 性能

- 三维单位：`1 unit = 1 m`
- 产品与小型零件使用共享材质并关闭非必要投影
- 透明防护罩使用轻量透明材质，避免 Three.js 透射通道造成整场景重复绘制
- 静态边缘采用 `EdgesGeometry`
- 相机、动画和选择管理器按通道更新
- 桌面端网格约 660 个、约 6 万可见三角形；实测初始绘制调用约 900 次

## 第三方许可

Three.js 使用 MIT License，Lucide 使用 ISC License。许可文件位于 `vendor/`。
