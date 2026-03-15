import './styles/main.css';
import { attachRouter } from './router';
import { initTheme } from './services/themeService';
import { runProjectDateNotifications } from './services/notificationService';

initTheme();

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root #app not found');
}

attachRouter(appRoot);
runProjectDateNotifications();
