import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import './styles/global.css';
import { Shell } from './components/Shell';
import { ConfirmProvider, PrivacyProvider, RefreshProvider, ToastProvider } from './components/ui';
import { routes } from './routes';

const router = createHashRouter([{ path: '/', element: <Shell />, children: routes }]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <PrivacyProvider>
        <RefreshProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </RefreshProvider>
      </PrivacyProvider>
    </ToastProvider>
  </React.StrictMode>,
);
