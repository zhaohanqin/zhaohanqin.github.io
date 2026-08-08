const modes = {
  calibration: {
    image: './assets/真实界面-双目标定.png',
    alt: '结构光三维重建系统的双目标定界面',
    title: '双目标定',
    caption: '左侧配置输入与标定板，右侧查看角点或重投影误差。',
    stages: [
      { title:'准备左右标定图', purpose:'让两台相机观察同一块标定板，并保持图像一一对应。', inputs:['左相机图像文件夹','右相机图像文件夹','一致的文件数量和顺序'], actions:['扫描图像文件','检查左右配对','读取图像尺寸'], outputs:['可用于联合检测的左右图像对'], check:'检查重点：左右目录必须来自同一组姿态，不能把不同拍摄批次混在一起。' },
      { title:'配置标定板', purpose:'把图像中的特征点与真实毫米尺度联系起来。', inputs:['圆形或棋盘格类型','行列数量','圆心距或方格尺寸'], actions:['检测亚像素特征点','建立平面物点坐标'], outputs:['每一幅图的二维—三维对应'], check:'检查重点：行列数和间距必须与实物一致，否则重投影误差可能看似正常但尺度错误。' },
      { title:'估计双目参数', purpose:'恢复两台相机的内参、畸变以及相对旋转和平移。', inputs:['有效图像对','特征点对应','图像尺寸'], actions:['单目标定','双目标定','计算每幅重投影误差'], outputs:['双目标定结果文本','角点与误差可视化'], check:'检查重点：不要只看平均误差，还要检查是否有个别姿态显著偏离。' },
      { title:'保存并复核', purpose:'把标定结果交给重建页，并在重建前确认参数有效。', inputs:['内外参和畸变','误差诊断'], actions:['写出标定文本','切换左右误差视图'], outputs:['可被重建流程读取的标定文件'], check:'完成标志：标定文件成功写出，左右重投影误差没有明显异常视图。' }
    ]
  },
  reconstruction: {
    image: './assets/真实界面-三维重建.png',
    alt: '结构光三维重建系统的三维重建界面',
    title: '三维重建',
    caption: '加载标定与左右条纹序列，配置质量阈值、频率和点云过滤。',
    stages: [
      { title:'加载标定和条纹', purpose:'把几何参数与左右相机采集的相移序列放入同一任务。', inputs:['双目标定结果','左右条纹目录','h1/h2…、v1/v2… 命名序列'], actions:['读取参数','按方向/频率/相移步排序'], outputs:['左右水平/垂直图像栈'], check:'检查重点：左右目录内不要再加 left/right 文件名前缀，图像序列必须完整。' },
      { title:'恢复绝对相位', purpose:'先计算周期内相位，再利用多频关系找回周期编号。', inputs:['N 步相移图','频率列表','调制度和强度阈值'], actions:['正余弦累积','三频外差展开','构造质量掩码'], outputs:['左右水平/垂直绝对相位','有效点掩码'], check:'可视化重点：相位应连续，低调制度、过曝和遮挡区域应被掩码排除。' },
      { title:'建立对应并三角化', purpose:'通过左右相机观测到的相位值匹配同一表面点。', inputs:['左右绝对相位','双目标定几何','深度范围'], actions:['相位对应','射线三角化','深度范围裁剪'], outputs:['深度图','初始三维点集'], check:'检查重点：错误标定、方向错配或频率配置不一致会直接造成深度异常。' },
      { title:'过滤并保存点云', purpose:'去除孤立噪声，形成可交付的 PLY。', inputs:['初始点云','统计邻域/标准差','半径与最少邻点'], actions:['统计离群点过滤','半径离群点过滤','写出 PLY'], outputs:['过滤后 pointCloud.ply','深度和点云诊断'], check:'证据边界：仓库固定提交未附真实 PLY，本页只解释输出路径，不展示虚构点云。' }
    ]
  }
};

let activeMode = 'calibration';
let activeStage = 0;
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const stageNav = document.querySelector('.stage-nav');

function listInto(selector, values) {
  document.querySelector(selector).innerHTML = values.map(value => `<li>${value}</li>`).join('');
}

function renderStage() {
  const mode = modes[activeMode];
  const stage = mode.stages[activeStage];
  stageNav.innerHTML = mode.stages.map((item, index) => `
    <button type="button" data-stage="${index}" ${index === activeStage ? 'aria-current="step"' : ''}>
      <b>${String(index + 1).padStart(2, '0')}</b><span>${item.title}</span>
    </button>`).join('');
  document.querySelector('.stage-number').textContent = `阶段 ${String(activeStage + 1).padStart(2, '0')} / ${String(mode.stages.length).padStart(2, '0')}`;
  document.querySelector('.stage-title').textContent = stage.title;
  document.querySelector('.stage-purpose').textContent = stage.purpose;
  listInto('.stage-inputs', stage.inputs);
  listInto('.stage-actions', stage.actions);
  listInto('.stage-outputs', stage.outputs);
  document.querySelector('.stage-check').textContent = stage.check;
  document.querySelector('.ui-image').src = mode.image;
  document.querySelector('.ui-image').alt = mode.alt;
  document.querySelector('.figure-title').textContent = mode.title;
  document.querySelector('.figure-caption').textContent = mode.caption;
}

modeButtons.forEach(button => button.addEventListener('click', () => {
  activeMode = button.dataset.mode;
  activeStage = 0;
  modeButtons.forEach(item => item.setAttribute('aria-selected', String(item === button)));
  renderStage();
}));

stageNav.addEventListener('click', event => {
  const button = event.target.closest('[data-stage]');
  if (!button) return;
  activeStage = Number(button.dataset.stage);
  renderStage();
});

renderStage();
