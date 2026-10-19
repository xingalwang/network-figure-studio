export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    convolution: (
      <>
        <rect x="3" y="5" width="12" height="14" />
        <path d="M7 5v14m4-14v14M3 10h12M3 14h12m3-6 3 4-3 4" />
      </>
    ),
    pool: (
      <>
        <path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" />
      </>
    ),
    activation: <path d="M3 18h8l9-13M4 3v18h18" />,
    upsample: (
      <>
        <path d="M12 20V4m-6 6 6-6 6 6M4 20h16" />
      </>
    ),
    concat: (
      <>
        <path d="M3 4h5v16H3zm8 0h5v16h-5zm8 0h2v16h-2z" />
      </>
    ),
    logo: (
      <>
        <path d="M12 5 5 18m7-13 7 13M5 18h14" />
        <circle cx="12" cy="4" r="3" />
        <circle cx="4" cy="19" r="3" />
        <circle cx="20" cy="19" r="3" />
      </>
    ),
    undo: (
      <>
        <path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14" />
      </>
    ),
    redo: (
      <>
        <path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14" />
      </>
    ),
    cube: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5m-9 5L3 7m9 5v10" />
      </>
    ),
    flat: <rect x="4" y="5" width="16" height="14" rx="1" />,
    arrow: (
      <>
        <path d="M5 19 19 5m-8 0h8v8" />
        <circle cx="5" cy="19" r="2" />
      </>
    ),
    cursor: <path d="m5 3 15 11-8 1-4 7Z" />,
    plus: <path d="M12 4v16M4 12h16" />,
    minus: <path d="M4 12h16" />,
    fit: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    folder: <path d="M3 5h7l2 3h9v12H3Z" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    plugin: <path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5Z" />,
    close: <path d="m5 5 14 14M5 19 19 5" />,
    save: (
      <>
        <path d="M3 3h15l3 3v15H3Z" />
        <path d="M7 3v6h10V3M7 21v-8h10v8" />
      </>
    ),
    align: (
      <>
        <path d="M3 4v16m18-16v16M8 7v10m8-10v10M3 12h18" />
      </>
    ),
    panel: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M15 3v18" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.cube}
    </svg>
  );
}
