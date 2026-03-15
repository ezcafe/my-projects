import './styles/main.css';
import { attachRouter } from './router';
import { initTheme } from './services/themeService';

initTheme();

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root #app not found');
}

attachRouter(appRoot);
