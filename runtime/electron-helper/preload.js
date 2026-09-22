// preload 桥：只暴露窗口控制原语——
//   - setBounds：宠物窗口逐帧跟随（renderer 上报包围盒的屏幕坐标，主进程 setContentBounds）。
//     x/y/width/height = 窗口内容区坐标（用于移动窗口）；boxX/boxY = 宠物包围盒左上角
//     （工作区坐标）——碰撞站场必须用包围盒坐标，不能用窗口坐标（窗口 = 包围盒 + 四周外扩 margin，
//     差半只宠物宽，会让跨窗碰撞检测整体错位）。
//   - setInteractive：点击穿透翻转——窗口默认整窗穿透（透明像素不挡下层应用），
//     renderer 在光标进/出宠物身体命中区时上报，主进程 setIgnoreMouseEvents 翻转。
//   - setInputBusy：上报「渲染端正拿着这个窗口的鼠标输入」（拖拽中 / 任意面板开着）。
//     主进程 60ms 兜底轮询（pointer-target.js）据此**否决**位置判定——否则拖拽甩快时
//     宠物滞后于光标、光标落到窗口外，兜底通道会翻回穿透并切断正在拖拽的输入链。
//   - 宠物间碰撞（跨窗，主进程 broker）：
//       reportFlight：飞行中每 ~30ms 上报自己的状态（位置/速度/尺寸）→ 主进程汇聚并广播；
//       onFlightStates：订阅主进程广播的全量宠物状态（碰撞检测用其它宠物的最新位置/速度）；
//       reportCollide：本窗飞行方检测到撞到 targetId → 主进程把动量结果转发给目标窗；
//       onPetHit：订阅「你被撞了」→ 用新初速 startThrow 抛出去（与浏览器 onHit 同语义）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  setBounds(x, y, width, height, boxX, boxY) {
    ipcRenderer.send('pet:set-bounds', { x, y, width, height, boxX, boxY });
  },
  setInteractive(interactive) {
    ipcRenderer.send('pet:set-interactive', !!interactive);
  },
  // 渲染端正拿着鼠标输入（拖拽中 / 菜单或弹窗开着）：兜底轮询期间绝不翻回穿透
  setInputBusy(busy) {
    ipcRenderer.send('pet:input-busy', !!busy);
  },
  // ---- 宠物间碰撞（跨窗 broker）----
  reportFlight(state) {
    ipcRenderer.send('pet:report-flight', state);
  },
  onFlightStates(cb) {
    ipcRenderer.on('pet:flight-states', (e, states) => cb(states));
  },
  reportCollide(targetId, vx, vy) {
    ipcRenderer.send('pet:collide-result', { targetId, vx, vy });
  },
  onPetHit(cb) {
    ipcRenderer.on('pet:hit', (e, payload) => cb(payload));
  },
  // ---- 托盘命令（主进程 → 渲染端）----
  // 托盘菜单的「对话 / 设置 / 回到初始位置」复用右键菜单的同一批动作，避免两套实现分叉。
  onHostCommand(cb) {
    ipcRenderer.on('pet:host-command', (e, payload) => cb(payload));
  },
  // 右键菜单「退出桌宠」：交给主进程走托盘同一条退出路径（先请宿主 dispose，再 app.quit）
  quitPet() {
    ipcRenderer.send('pet:quit-app');
  },
});
