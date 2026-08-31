/** 统一的图标集：全部 24×24 线性风格，粗细一致，跟着父级颜色走。 */

type Props = { size?: number; className?: string };

function base(size: number, className: string | undefined, path: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {path}
    </svg>
  );
}

export const IconBoard = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M9 9v11" />
    </>
  ));

export const IconBell = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ));

export const IconDevice = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ));

export const IconChart = ({ size = 20, className }: Props) =>
  base(size, className, <path d="M5 19V11M12 19V5M19 19v-6" />);

export const IconTrophy = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <path d="M8 4h8v4.5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5.5H5.5A1.5 1.5 0 0 0 4 7c0 2 1.5 3.6 3.6 3.9" />
      <path d="M16 5.5h2.5A1.5 1.5 0 0 1 20 7c0 2-1.5 3.6-3.6 3.9" />
      <path d="M12 12.5V16M9 20h6M10 16.5h4V20h-4z" />
    </>
  ));

export const IconUpload = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ));

export const IconUsers = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3.2 2.5-5.5 5.5-5.5s5.5 2.3 5.5 5.5" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.3c2.2.5 3.8 2.4 3.8 5.2" />
    </>
  ));

export const IconMinusCircle = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12h7" />
    </>
  ));

export const IconRoute = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 6H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h5.5" />
    </>
  ));

export const IconCheck = ({ size = 20, className }: Props) =>
  base(size, className, <path d="M5 12.5 9.5 17 19 7" />);

export const IconPlus = ({ size = 20, className }: Props) =>
  base(size, className, <path d="M12 5v14M5 12h14" />);

export const IconMinus = ({ size = 20, className }: Props) =>
  base(size, className, <path d="M5 12h14" />);

export const IconArrowRight = ({ size = 20, className }: Props) =>
  base(size, className, <path d="M4 12h14M13 6l6 6-6 6" />);

export const IconClock = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ));

export const IconAlert = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ));

export const IconSearch = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ));

export const IconInbox = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <path d="M4 13h4l2 3h4l2-3h4" />
      <path d="M4 13 5.7 5.8A2 2 0 0 1 7.6 4.3h8.8a2 2 0 0 1 1.9 1.5L20 13" />
      <path d="M4 13v4.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V13" />
    </>
  ));

export const IconLock = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ));

export const IconChevronDown = ({ size = 20, className }: Props) =>
  base(size, className, <path d="m6 9 6 6 6-6" />);

export const IconKey = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 12.5 18 5M15.5 7.5 18 5M17 9l2.5-2.5" />
    </>
  ));

export const IconLogout = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <path d="M15 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8" />
      <path d="M10 12h11M17.5 8.5 21 12l-3.5 3.5" />
    </>
  ));

export const IconStar = ({ size = 20, className }: Props) =>
  base(size, className, (
    <path d="M12 3.5 14.9 9.4 21.5 10.4 16.7 15 17.9 21.5 12 18.4 6.1 21.5 7.3 15 2.5 10.4 9.1 9.4Z" />
  ));

export const IconEdit = ({ size = 20, className }: Props) =>
  base(size, className, (
    <>
      <path d="M4 20.5 4.9 16 16 4.9a2 2 0 0 1 2.8 0l.3.3a2 2 0 0 1 0 2.8L8 19.1l-4 1.4Z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ));
