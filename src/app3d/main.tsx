import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '../styles/app.css';
import { createRoot } from 'react-dom/client';
import { App3D } from './App3D';

createRoot(document.getElementById('root')!).render(<App3D />);
