import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createHashRouter } from 'react-router-dom';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/content.css';
import App from './App';
import { ProgressProvider } from './lib/progress';
import Home from './routes/Home';
import ModuleOverview from './routes/ModuleOverview';
import SectionReader from './routes/SectionReader';
import QuizView from './routes/QuizView';
import ExerciseView from './routes/ExerciseView';

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'module/:id', element: <ModuleOverview /> },
      { path: 'module/:id/s/:sectionId', element: <SectionReader /> },
      { path: 'module/:id/quiz', element: <QuizView /> },
      { path: 'module/:id/ex/:exerciseId', element: <ExerciseView /> },
    ],
  },
]);

if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline mode unavailable (e.g. file:// or http) — app still works */
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProgressProvider>
      <RouterProvider router={router} />
    </ProgressProvider>
  </React.StrictMode>,
);
