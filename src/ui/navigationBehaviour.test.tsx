import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FunctionalNavigation from '../components/FunctionalNavigation';
import FunctionalReportNavigation from '../components/FunctionalReportNavigation';

const findButton = (node: ReactNode, text: string): ReactElement<{ children?: ReactNode; onClick?: () => void }> | null => {
  if (!node || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, text);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (typeof element.type === 'function') {
    const expanded = (element.type as (props: typeof element.props) => ReactNode)(element.props);
    return findButton(expanded, text);
  }
  const label = renderToStaticMarkup(element).replace(/<[^>]+>/g, '');
  if (element.type === 'button' && label.includes(text)) return element;
  return findButton(element.props.children, text);
};

describe('functional navigation behaviour', () => {
  it('routes Bank, Treasury and Risk & Regulatory to distinct destinations', () => {
    const onBoardroom = vi.fn();
    const onDepartment = vi.fn();
    const onReport = vi.fn();
    const tree = FunctionalNavigation({
      activeTab: 'Boardroom',
      activeDepartment: null,
      onBoardroom,
      onDepartment,
      onReport,
    });

    findButton(tree, 'Bank')!.props.onClick?.();
    findButton(tree, 'Treasury & Funding')!.props.onClick?.();
    findButton(tree, 'Risk & Regulatory')!.props.onClick?.();

    expect(onBoardroom).toHaveBeenCalledTimes(1);
    expect(onDepartment).toHaveBeenCalledWith('Treasury');
    expect(onReport).toHaveBeenCalledWith('Regulatory');
  });

  it('routes finance reports back to the Capital workspace and between reports', () => {
    const onReport = vi.fn();
    const onManage = vi.fn();
    const tree = FunctionalReportNavigation({ activeTab: 'Performance', onReport, onManage });
    expect(tree).not.toBeNull();
    findButton(tree, 'Manage capital')!.props.onClick?.();
    findButton(tree, 'Accounts')!.props.onClick?.();
    expect(onManage).toHaveBeenCalledWith('Capital');
    expect(onReport).toHaveBeenCalledWith('Accounts');
  });
});
