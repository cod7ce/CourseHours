/** 两个测试文件共用的渲染壳 */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Shell } from '../components/Shell';
import { ConfirmProvider, NewActionProvider, PrivacyProvider, RefreshProvider, ToastProvider } from '../components/ui';
import { routes } from '../routes';

export function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/', element: <Shell />, children: routes }], { initialEntries: [path] });
  return render(
    <ToastProvider>
      <PrivacyProvider>
        <RefreshProvider>
          <ConfirmProvider>
            <NewActionProvider>
              <RouterProvider router={router} />
            </NewActionProvider>
          </ConfirmProvider>
        </RefreshProvider>
      </PrivacyProvider>
    </ToastProvider>,
  );
}

/** 收集 React 渲染错误：它只打到 console.error，不会让测试失败 */
export function collectRenderErrors(vi: { spyOn: typeof import('vitest')['vi']['spyOn'] }) {
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(String(args[0])); });
  return errors;
}
