import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import '../design-system/globals.css';
createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);
