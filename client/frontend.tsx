import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
const element = document.getElementById('root')!;
const hot = import.meta.hot;
const root: Root = hot ? ((hot.data.root as Root | undefined) ??= createRoot(element)) : createRoot(element);
root.render(<StrictMode><App /></StrictMode>);
