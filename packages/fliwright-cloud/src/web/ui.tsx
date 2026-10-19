import React from 'react';

const paths: Record<string, React.ReactNode> = {
  gauge: (
    <>
      <path d="M3 18a9 9 0 1 1 18 0" />
      <path d="m12 13 5-5M7 18h10" />
      <circle cx="12" cy="13" r="1" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  device: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M10 18h4" />
    </>
  ),
  cpu: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4M19 9h4m-4 6h4" />
    </>
  ),
  doc: (
    <>
      <path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8m-8 4h6" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </>
  ),
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7V2l-4 4M4 17v5l4-4" />
      <path d="M20 7A9 9 0 0 0 4 6m0 11a9 9 0 0 0 16 1" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  x: <path d="m6 6 12 12M6 18 18 6" />,
  alert: (
    <>
      <path d="m12 3 10 18H2Z M12 9v4m0 4h.01" />
    </>
  ),
  camera: (
    <>
      <path d="M8 6 10 3h4l2 3h5v15H3V6Z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8Z" />,
  pause: <path d="M8 4v16M16 4v16" />,
  prev: <path d="M5 5v14m14-14L7 12l12 7Z" />,
  next: <path d="M19 5v14M5 5l12 7-12 7Z" />,
  chevron: <path d="m8 5 7 7-7 7" />,
  code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />,
  link: (
    <>
      <path
        d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 0-6-6L6 5"
        transform="translate(3 3)"
      />
    </>
  ),
  box: (
    <>
      <path d="m12 2 10 5v10l-10 5-10-5V7Z M2 7l10 5 10-5M12 12v10" />
    </>
  ),
  log: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3m7 0h5" />
    </>
  ),
};

export function Icon({
  name,
  className = '',
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg className={`ico ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name] ?? paths.doc}
    </svg>
  );
}

export const stages = [
  ['checkout', '拉取代码', 'code'],
  ['install', '安装依赖', 'box'],
  ['reset_before', '重置设备', 'device'],
  ['launch', '启动 Flutter', 'play'],
  ['running', '执行测试', 'list'],
  ['export', '导出产物', 'doc'],
  ['finalizing', '归档与清理', 'check'],
];

export function StageStrip({
  stage,
  completed = false,
  failed = false,
  stopped = false,
}: {
  stage?: string;
  completed?: boolean;
  failed?: boolean;
  stopped?: boolean;
}) {
  const current = stages.findIndex(([id]) => id === stage);
  return (
    <div className="strip" aria-label="运行阶段">
      {stages.map(([id, name, icon], i) => {
        const done = completed || (current >= 0 && i < current);
        const active = !completed && i === current;
        const testFailed = completed && failed && id === 'running';
        return (
          <div
            key={id}
            className={`stg ${testFailed ? 'is-fail' : done ? 'is-pass' : active && !stopped ? 'is-run' : 'is-idle'}`}
          >
            <span className="nm">
              <Icon name={icon} />
              {name}
            </span>
            <span className="tm">
              {testFailed
                ? '测试失败'
                : done
                  ? '已完成'
                  : active
                    ? stopped
                      ? '已结束'
                      : '进行中'
                    : '未开始'}
            </span>
            <span className="bar">
              <i style={{ width: done ? '100%' : active ? '50%' : '0%' }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
