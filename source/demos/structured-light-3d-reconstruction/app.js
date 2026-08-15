const modes = {
  single: {
    title: '单目系统（相机-投影仪）',
    stages: [
      {
        title: '采集与图像准备',
        purpose: '让相机看到标定板，同时让投影仪把条纹投射到标定板上；每个姿态同时保存标定板图与水平/垂直条纹图。',
        inputs: ['多组标定板图（13 个位姿）', '每组 3 频率 × 4 步的水平/垂直条纹（h1..h12、v1..v12）', '图像尺寸 2448×2048、DLP 分辨率 1920×1080'],
        actions: ['按位姿分组', '按方向与频率排序', '读取图像尺寸'],
        outputs: ['可用于联合检测的标定板图 + 条纹图组'],
        check: '检查重点：每个姿态的条纹顺序必须一致，水平和垂直不能混组。'
      },
      {
        title: '相机-投影仪联合标定',
        purpose: '相机角点提供几何尺度，绝对相位把同一点映射到 DLP 像素——投影仪不能拍照，只能靠相位“反算”出它的像素坐标。',
        inputs: ['标定板物点', '相机角点', '角点处水平/垂直绝对相位'],
        actions: ['张正友单目标定', 'N 步相移 + 三频外差求绝对相位', '角点相位插值映射到 DLP 像素', '把投影仪当逆相机做 stereoCalibrate', '按投影仪重投影误差过滤坏点'],
        outputs: ['Kc、Kp、畸变、R、t、F', '相机/DLP 反投影误差', '标定结果.txt'],
        check: '检查重点：投影仪不能直接检测角点，绝对相位质量直接决定 DLP 点的可信度。'
      },
      {
        title: '相位解码',
        purpose: '把物体表面每个相机像素转换成投影仪平面坐标。',
        inputs: ['h1..h12、v1..v12 条纹图', '相移步数 N=4', '频率 81/72/64'],
        actions: ['四步相移求包裹相位', '9/8/1 差频外差展开', '生成调制度与强度质量掩码'],
        outputs: ['水平/垂直绝对相位', '投影仪坐标 up、vp', '有效点掩码'],
        check: '可视化重点：包裹相位在 2π 处跳变，绝对相位应沿条纹方向连续。'
      },
      {
        title: '三维重建（与双目共用核心）',
        purpose: '用相机射线和投影仪射线的交会恢复三维坐标。',
        inputs: ['相机像素', '投影仪像素', 'Kc、Kp、R、t'],
        actions: ['去畸变', '构造投影矩阵', '批量三角化', '深度裁剪 + 统计/半径/体素过滤'],
        outputs: ['深度图', '有效掩码', 'pointCloud.ply'],
        check: '完成标志：深度图、相位诊断图和点云文件同时写出。'
      }
    ]
  },
  stereo: {
    title: '双目系统（左右双相机）',
    stages: [
      {
        title: '左右同步采集',
        purpose: '两台相机同步观察同一块标定板，左右目录内图像一一对应。',
        inputs: ['左相机图像文件夹', '右相机图像文件夹', '一致的文件数量和顺序'],
        actions: ['扫描图像文件', '检查左右配对', '读取图像尺寸'],
        outputs: ['可用于联合检测的左右图像对'],
        check: '检查重点：左右目录必须来自同一组姿态，不能把不同拍摄批次混在一起。'
      },
      {
        title: '双目相机标定',
        purpose: '两个相机都能直接看到标定板，各自检测角点后求相对位姿，不需要条纹和相位。',
        inputs: ['左右标定板图', '圆形/棋盘格参数（行列、间距）', '图像尺寸 2448×2048'],
        actions: ['灰度翻转 + 归一化预处理', '左右分别检测圆点/棋盘格角点', '单应性估计左右内参', 'stereoCalibrate 求 R、t'],
        outputs: ['左右内参与畸变', '相对位姿 R、t 与基线距离', '基础矩阵 F', '双目标定结果.txt'],
        check: '检查重点：行列数与间距必须和实物一致，否则重投影误差看似正常但尺度错误。'
      },
      {
        title: '左右相位解码',
        purpose: '左右两路各自从条纹恢复绝对相位，为同一表面点提供左右像素观测。',
        inputs: ['左右条纹目录（h1..h12、v1..v12，无前缀）', '相移步数 N=4', '频率 81/72/64'],
        actions: ['四步相移求包裹相位', '三频外差展开绝对相位', '构造左右质量掩码'],
        outputs: ['左右水平/垂直绝对相位', '左右有效点掩码'],
        check: '检查重点：左右目录内不要再加 left/right 文件名前缀，图像序列必须完整。'
      },
      {
        title: '三维重建（与单目共用核心）',
        purpose: '通过左右相机观测到的相位值匹配同一表面点，再用双目标定几何三角化。',
        inputs: ['左右绝对相位', '双目标定结果（R、t、内参）', '深度范围'],
        actions: ['相位对应建立左右匹配', '射线三角化', '深度裁剪 + 统计/半径/体素过滤'],
        outputs: ['深度图', '有效掩码', 'pointCloud.ply'],
        check: '完成标志：错误标定、方向错配或频率配置不一致会直接造成深度异常。'
      }
    ]
  }
};

let activeMode = 'single';
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
