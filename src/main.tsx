import { createRoot } from 'react-dom/client';
import '@maxgraph/core/css/common.css';
import './app/styles.css';
import { initializeTypography } from './graphics/typography.ts';
import { Startup } from './app/Startup.tsx';

initializeTypography();
document.documentElement.dataset.startup = 'preparing';
createRoot(document.getElementById('root')!).render(<Startup />);
